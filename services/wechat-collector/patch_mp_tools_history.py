"""Narrow history/cooldown repair for the installed, owner-authorized MP Tools.

Builds offline, preserves the v5 HTML exporter and all non-target modules.
Installing requires the desktop app to be closed. User data stays in data/.
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
OUT = ROOT / "data/patches/history-directory-2026-10-22"
BASE_SHA = "02611609175a1aa1f6b4ec2720004f961f5bbf3c9e420fd572e6d6212f023570"
SOURCE = Path(r"D:\tlydcg\Codex_work\wechat_mp_tools\wechat-mp-tools\backend")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def replace_function(nodes, replacement, name):
    matches = [i for i, n in enumerate(nodes) if isinstance(n, ast.FunctionDef) and n.name == name]
    if len(matches) != 1:
        raise RuntimeError("Reviewed function boundary changed: " + name)
    replacement.name = name
    nodes[matches[0]] = replacement


def main():
    spec = importlib.util.spec_from_file_location("history_archive", ROOT / "data/patches/short-url-2026-10-21/patch_package.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    exe = ROOT / "WeChat MP Tools.exe"
    original = exe.read_bytes()
    installed_sha = sha(original)
    if sha(original) != BASE_SHA:
        previous_report = json.loads((OUT / "report.json").read_text(encoding="utf-8"))
        if not previous_report.get("installed") or previous_report.get("patchedSha256") != installed_sha:
            raise RuntimeError("Installed EXE differs from the reviewed package; stopped")
        original = (OUT / "WeChat MP Tools.before-history.exe").read_bytes()
        if sha(original) != BASE_SHA:
            raise RuntimeError("Reviewed v5 backup changed")
    archive = helper.read_archive(original)
    replacements = ast.parse((Path(__file__).with_name("mp_tools_history.py")).read_text(encoding="utf-8"))
    functions = {n.name: n for n in replacements.body if isinstance(n, ast.FunctionDef)}
    changed = {}
    hashes = {}
    for module, source in [("backend.articles", ROOT / "data/patches/short-url-2026-10-21/articles.patched.py"),
                           ("backend.account_pool", SOURCE / "account_pool.py")]:
        old = marshal.loads(zlib.decompress(archive["modules"][module][1]))
        source_text = source.read_text(encoding="utf-8")
        compiled = compile(source_text, old.co_filename, "exec", dont_inherit=True)
        if helper.code_hash(compiled) != helper.code_hash(old):
            raise RuntimeError("Source does not match installed module: " + module)
        tree = ast.parse(source_text)
        if module == "backend.articles":
            replace_function(tree.body, functions["_fetch_articles_page"], "_fetch_articles_page")
            tree.body.extend(functions[n] for n in ("_history_error_response", "_history_request", "_history_local_articles"))
            route = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "get_articles")
            route_try = next(n for n in route.body if isinstance(n, ast.Try))
            response_assign = next(n for n in route_try.body if isinstance(n, ast.Assign)
                                   and any(isinstance(t, ast.Name) and t.id == "res_data" for t in n.targets))
            response_assign.value.keys.extend([ast.Constant("directory_complete"), ast.Constant("list_origin")])
            response_assign.value.values.extend([ast.Constant(True), ast.Constant("upstream_history")])
            handler = route_try.handlers[-1]
            handler.body = ast.parse("return jsonify(_history_local_articles(fakeid, begin, count, keyword, str(e)))").body
        else:
            cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "AccountPool")
            replace_function(cls.body, functions["history_pool_acquire"], "acquire")
            replace_function(cls.body, functions["history_pool_report"], "report")
            replace_function(tree.body, functions["history_borrow_weread_session"], "borrow_weread_session")
        ast.fix_missing_locations(tree)
        text = ast.unparse(tree) + "\n"
        code = compile(text, old.co_filename, "exec", dont_inherit=True)
        changed[module] = zlib.compress(marshal.dumps(code), level=9)
        hashes[module] = {"before": helper.code_hash(old), "after": helper.code_hash(code)}
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / (module.rsplit(".", 1)[-1] + ".history.py")).write_text(text, encoding="utf-8")
    pyz = bytearray(archive["pyz_header"] + b"\0\0\0\0")
    toc = []
    for name, (kind, _, _) in archive["toc"]:
        payload = changed.get(name, archive["modules"][name][1])
        toc.append((name, (kind, len(pyz), len(payload))))
        pyz.extend(payload)
    struct.pack_into("!i", pyz, 8, len(pyz))
    pyz.extend(marshal.dumps(toc))
    body, table = bytearray(), bytearray()
    for entry in archive["entries"]:
        raw = bytes(pyz) if entry["kind"] == b"z" else None
        payload = (zlib.compress(raw, level=9) if entry["flag"] else raw) if raw is not None else entry["payload"]
        size = len(raw) if raw is not None else entry["size"]
        offset = len(body)
        body.extend(payload)
        table.extend(struct.pack("!iIIIBc", entry["entry_size"], offset, len(payload), size, entry["flag"], entry["kind"]) + entry["name_bytes"])
    cookie = archive["cookie"]
    output = archive["prefix"] + bytes(body) + bytes(table) + struct.pack("!8sIIII64s", helper.MAGIC, len(body)+len(table)+88, len(body), len(table), cookie[4], cookie[5])
    checked = helper.read_archive(output)
    if checked["prefix"] != archive["prefix"] or list(checked["modules"]) != list(archive["modules"]):
        raise RuntimeError("Package identity or module inventory changed")
    for module, old in archive["modules"].items():
        if module not in changed and checked["modules"][module] != old:
            raise RuntimeError("Unrelated module changed: " + module)
    for old, new in zip(archive["entries"], checked["entries"]):
        if old["kind"] != b"z" and old["payload"] != new["payload"]:
            raise RuntimeError("Unrelated outer package entry changed")
    staged = OUT / "WeChat MP Tools.history.exe"
    staged.write_bytes(output)
    report = {"patch": "campusos-history-directory-v6.1-local-visibility", "builtAt": datetime.now(timezone.utc).isoformat(),
              "baseSha256": BASE_SHA, "patchedSha256": sha(output), "changedModules": list(changed),
              "moduleHashes": hashes, "htmlExporterUnchanged": checked["modules"]["backend.downloader"] == archive["modules"]["backend.downloader"],
              "installed": False, "networkRequests": 0}
    if "--install" in sys.argv:
        if helper.running():
            raise RuntimeError("Close MP Tools before installation; staged package is ready")
        if sha(exe.read_bytes()) != installed_sha:
            raise RuntimeError("Installed EXE changed after build")
        protected = ["accounts.json", "account_pool.json", "app_settings.json", "download_history.json", "rss_subscriptions.json", "rss_articles.json", "proxy_config.json"]
        before = {n: sha((ROOT / "data" / n).read_bytes()) for n in protected if (ROOT / "data" / n).is_file()}
        backup = OUT / "WeChat MP Tools.before-history.exe"
        if backup.exists() and sha(backup.read_bytes()) != BASE_SHA:
            raise RuntimeError("Conflicting backup exists")
        if not backup.exists():
            backup.write_bytes(original)
        for name in before:
            if not (OUT / ("before-" + name)).exists():
                shutil.copy2(ROOT / "data" / name, OUT / ("before-" + name))
        pending = ROOT / "WeChat MP Tools.history.pending"
        shutil.copy2(staged, pending)
        os.replace(pending, exe)
        after = {n: sha((ROOT / "data" / n).read_bytes()) for n in before}
        if before != after or sha(exe.read_bytes()) != report["patchedSha256"]:
            raise RuntimeError("Installation readback or protected data check failed")
        report.update(installed=True, applicationDataUnchanged=True)
    (OUT / ("report.json" if report["installed"] else "staged-report.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
