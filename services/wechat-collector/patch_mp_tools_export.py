"""Build an offline, narrowly scoped output patch for the previously reviewed 2.2.4 EXE.

Does not call upstream sites, alter logins, modify fetching fallbacks, or start a task.
Requires the matching short-URL patch files already in the owner's data directory.
"""
import ast
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import shutil
import struct
import sys
import zlib

ROOT = Path(r"D:\WeChat MP Tools")
PREVIOUS = ROOT / "data/patches/short-url-2026-10-21"
OUT = ROOT / "data/patches/campusos-reading-2026-10-21"
EXPECTED = "107b7f37ff53c4d8e59adbec9c628386ebfe8dcbcf1ab1ef97ebbda7a554cd58"


def main():
    spec = importlib.util.spec_from_file_location("archive_helpers", PREVIOUS / "patch_package.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    exe = ROOT / "WeChat MP Tools.exe"
    blob = exe.read_bytes()
    installed_hash = hashlib.sha256(blob).hexdigest()
    if installed_hash != EXPECTED:
        report_file = OUT / "report.json"
        previous_report = json.loads(report_file.read_text(encoding="utf-8")) if report_file.is_file() else {}
        if not previous_report.get("installed") or previous_report.get("patched_sha256") != installed_hash:
            raise RuntimeError("Installation differs from the reviewed URL-patched version")
        blob = (PREVIOUS / "WeChat MP Tools.patched.exe").read_bytes()
        if hashlib.sha256(blob).hexdigest() != EXPECTED:
            raise RuntimeError("Reviewed base package changed")
    archive = helper.read_archive(blob)
    source = (PREVIOUS / "downloader.patched.py").read_text(encoding="utf-8")
    old_code = marshal.loads(zlib.decompress(archive["modules"]["backend.downloader"][1]))
    if helper.code_hash(compile(source, old_code.co_filename, "exec", dont_inherit=True)) != helper.code_hash(old_code):
        raise RuntimeError("Source differs from the installed downloader")
    tree = ast.parse(source)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "download_single_article")
    index = next(i for i, n in enumerate(function.body) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "art_dir" for t in n.targets))
    hook = ast.parse("""
if settings.get('campusos_reading_only', False):
    try:
        return campusos_save_reading(raw_html, clean_url, out_dir, safe_title, extract_article_content(raw_html), publish_time, review_id)
    except (ValueError, OSError):
        return {'success': False, 'title': safe_title, 'error': '阅读HTML保存失败，未发布', 'is_permanent': False}
""").body
    function.body[index:index] = hook
    here = Path(__file__).resolve().parent
    tree.body.extend(ast.parse((here / "reading_html.py").read_text(encoding="utf-8")).body)
    tree.body.extend(ast.parse((here / "mp_tools_reading_export.py").read_text(encoding="utf-8")).body)
    ast.fix_missing_locations(tree)
    patched_source = ast.unparse(tree) + "\n"
    compiled = compile(patched_source, old_code.co_filename, "exec", dont_inherit=True)
    changed = zlib.compress(marshal.dumps(compiled), level=9)
    new_pyz = bytearray(archive["pyz_header"] + b"\0\0\0\0")
    new_toc = []
    for name, (kind, _, _) in archive["toc"]:
        payload = changed if name == "backend.downloader" else archive["modules"][name][1]
        new_toc.append((name, (kind, len(new_pyz), len(payload))))
        new_pyz.extend(payload)
    struct.pack_into("!i", new_pyz, 8, len(new_pyz))
    new_pyz.extend(marshal.dumps(new_toc))
    body, toc = bytearray(), bytearray()
    for entry in archive["entries"]:
        raw = bytes(new_pyz) if entry["kind"] == b"z" else None
        payload = (zlib.compress(raw, level=9) if entry["flag"] else raw) if raw is not None else entry["payload"]
        size = len(raw) if raw is not None else entry["size"]
        offset = len(body)
        body.extend(payload)
        toc.extend(struct.pack("!iIIIBc", entry["entry_size"], offset, len(payload), size, entry["flag"], entry["kind"]) + entry["name_bytes"])
    cookie = archive["cookie"]
    output = archive["prefix"] + bytes(body) + bytes(toc) + struct.pack("!8sIIII64s", helper.MAGIC, len(body) + len(toc) + 88, len(body), len(toc), cookie[4], cookie[5])
    checked = helper.read_archive(output)
    if checked["prefix"] != archive["prefix"]:
        raise RuntimeError("Bootloader changed")
    for name, payload in archive["modules"].items():
        if name != "backend.downloader" and checked["modules"][name] != payload:
            raise RuntimeError("Unrelated module changed")
    OUT.mkdir(parents=True, exist_ok=True)
    staged = OUT / "WeChat MP Tools.reading.exe"
    staged.write_bytes(output)
    (OUT / "downloader.reading.py").write_text(patched_source, encoding="utf-8")
    report = {"patch": "campusos-reading-html-v2-styled", "built_at": datetime.now(timezone.utc).isoformat(),
              "previous_sha256": installed_hash, "base_sha256": EXPECTED, "patched_sha256": hashlib.sha256(output).hexdigest(),
              "changed_modules": ["backend.downloader"], "network_requests": 0, "installed": False}
    if "--install" in sys.argv:
        if helper.running():
            raise RuntimeError("Close MP Tools before installing; staged package is ready")
        if hashlib.sha256(exe.read_bytes()).hexdigest() != installed_hash:
            raise RuntimeError("Installation changed after staging")
        shutil.copy2(exe, OUT / ("WeChat MP Tools.previous-" + installed_hash[:12] + ".exe"))
        pending = ROOT / "WeChat MP Tools.reading.pending"
        shutil.copy2(staged, pending)
        os.replace(pending, exe)
        settings_path = ROOT / "data/app_settings.json"
        settings = json.loads(settings_path.read_text(encoding="utf-8-sig")) if settings_path.exists() else {}
        settings_backup = OUT / ("settings.before-" + installed_hash[:12] + ".json")
        if not settings_backup.exists():
            settings_backup.write_text(json.dumps(settings, ensure_ascii=False), encoding="utf-8")
        settings.update({"campusos_reading_only": True, "auto_save_images": False, "auto_save_videos": False, "save_markdown": False, "save_pdf": False})
        settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
        report["installed"] = True
    (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (OUT / ("report-" + report["patched_sha256"][:12] + ".json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
