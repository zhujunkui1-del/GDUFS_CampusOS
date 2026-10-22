"""Stage the reviewed v2.3.1 shared-library patch; install only with --install.

No application launch, WeChat request, download or data migration is performed.
"""
import argparse
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
import subprocess
import types
import zlib

HERE = Path(__file__).resolve().parent
BASE_SHA = "01565eeac2918813017a41289a2597e654c4d0cbc2e162f5e198928addf2b8e3"


def sha(blob):
    return hashlib.sha256(blob).hexdigest()


def top_functions(code):
    return {value.co_name: value for value in code.co_consts if isinstance(value, types.CodeType)}


def replace_code(module, replacements):
    changed = set()
    constants = []
    for value in module.co_consts:
        if isinstance(value, types.CodeType) and value.co_name in replacements:
            changed.add(value.co_name)
            value = replacements[value.co_name]
        constants.append(value)
    if changed != set(replacements):
        raise RuntimeError("Reviewed packaged function boundary changed")
    return module.replace(co_consts=tuple(constants))


def compile_function(node, filename):
    node.decorator_list = []
    tree = ast.Module(body=[node], type_ignores=[])
    ast.fix_missing_locations(tree)
    return top_functions(compile(tree, filename, "exec", dont_inherit=True))[node.name]


def history_scanner(history: list) -> bool:
    from backend.campusos_article_library import read_metadata, history_entry, canonical_url
    settings = get_settings()
    root = Path(settings.get("download_dir") or str(OUTPUT_DIR))
    roots = [root]
    if OUTPUT_DIR.resolve() != root.resolve():
        roots.append(OUTPUT_DIR)
    existing_paths = {item.get("path") for item in history if isinstance(item, dict)}
    by_url = {canonical_url(item.get("link")): item for item in history
              if isinstance(item, dict) and canonical_url(item.get("link"))}
    changed = False
    for export in roots:
        if not export.is_dir() or export.is_symlink():
            continue
        for account in export.iterdir():
            if not account.is_dir() or account.is_symlink() or account.name.startswith(".") or account.name in {"channels", "douyin_downloads", "xhs_downloads", "temp_uploads"}:
                continue
            for folder in account.iterdir():
                if not folder.is_dir() or folder.is_symlink():
                    continue
                files = [p for p in folder.glob("*.html") if not p.is_symlink() and not p.name.endswith("_raw.html")]
                if not files:
                    continue
                embedded = next(((path, read_metadata(path)) for path in files if read_metadata(path)), None)
                if embedded:
                    path, meta = embedded
                    row = history_entry(path, meta)
                else:
                    # Retain native legacy exports; never infer missing files as deletions.
                    meta_file = folder / "metadata.json"
                    try:
                        meta = json.loads(meta_file.read_text(encoding="utf-8-sig")) if meta_file.is_file() else {}
                    except (ValueError, OSError):
                        meta = {}
                    row = {"title": meta.get("title") or folder.name, "link": meta.get("url", ""),
                           "account": account.name, "success": True, "error": None, "path": str(folder),
                           "time": folder.stat().st_mtime, "publish_time": meta.get("publish_time"),
                           "cover_url": meta.get("cover_url", ""), "digest": meta.get("digest", ""),
                           "has_markdown": meta.get("has_markdown", any(folder.glob("*.md"))),
                           "has_pdf": meta.get("has_pdf", any(folder.glob("*.pdf")))}
                key = canonical_url(row.get("link"))
                previous = by_url.get(key) if key else None
                if previous:
                    if not previous.get("success") or not previous.get("path"):
                        previous.update(row)
                        changed = True
                    continue
                if str(folder) not in existing_paths:
                    history.append(row)
                    existing_paths.add(str(folder))
                    if key:
                        by_url[key] = row
                    changed = True
    return changed


def repack(helper, archive, changed, added):
    pyz = bytearray(archive["pyz_header"] + b"\0\0\0\0")
    toc = []
    for name, (kind, _, _) in archive["toc"]:
        payload = changed.get(name, archive["modules"][name][1])
        toc.append((name, (kind, len(pyz), len(payload))))
        pyz.extend(payload)
    for name, payload in added.items():
        if name in archive["modules"]:
            raise RuntimeError("Shared helper module already exists")
        toc.append((name, (0, len(pyz), len(payload))))
        pyz.extend(payload)
    struct.pack_into("!i", pyz, 8, len(pyz))
    pyz.extend(marshal.dumps(toc))
    body, table = bytearray(), bytearray()
    for entry in archive["entries"]:
        raw = bytes(pyz) if entry["kind"] == b"z" else None
        payload = (zlib.compress(raw, 9) if entry["flag"] else raw) if raw is not None else entry["payload"]
        size = len(raw) if raw is not None else entry["size"]
        offset = len(body)
        body.extend(payload)
        table.extend(struct.pack("!iIIIBc", entry["entry_size"], offset, len(payload), size, entry["flag"], entry["kind"]) + entry["name_bytes"])
    cookie = archive["cookie"]
    output = archive["prefix"] + bytes(body) + bytes(table) + struct.pack(
        "!8sIIII64s", helper.MAGIC, len(body) + len(table) + 88, len(body), len(table), cookie[4], cookie[5])
    checked = helper.read_archive(output)
    if checked["prefix"] != archive["prefix"]:
        raise RuntimeError("Bootloader changed")
    for name, value in archive["modules"].items():
        if name not in changed and checked["modules"][name] != value:
            raise RuntimeError("Unrelated packaged module changed: " + name)
    for previous, current in zip(archive["entries"], checked["entries"]):
        if previous["kind"] != b"z" and previous["payload"] != current["payload"]:
            raise RuntimeError("Unrelated outer package entry changed")
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(r"D:\WeChat MP Tools_v2.3.1"))
    parser.add_argument("--helper", type=Path, default=Path(r"D:\WeChat MP Tools_v2.2.4\data\patches\short-url-2026-10-21\patch_package.py"))
    parser.add_argument("--source", type=Path, default=Path(r"D:\tlydcg\Codex_work\wechat_mp_tools\wechat-mp-tools\backend"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()
    out = args.output or args.root / "data/patches/shared-article-library-2026-10-22"
    spec = importlib.util.spec_from_file_location("library_archive", args.helper)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    exe = args.root / "WeChat MP Tools.exe"
    original = exe.read_bytes()
    if sha(original) != BASE_SHA:
        raise RuntimeError("Current executable differs from reviewed v2.3.1 HTML-only package")
    archive = helper.read_archive(original)
    changed = {}
    functions_changed = {}
    downloader_source = args.root / "data/patches/html-cdn-title-migration-2026-10-22/downloader.v2.3.1.html-only.py"
    old = marshal.loads(zlib.decompress(archive["modules"]["backend.downloader"][1]))
    source = downloader_source.read_text(encoding="utf-8-sig")
    if helper.code_hash(compile(source, old.co_filename, "exec", dont_inherit=True)) != helper.code_hash(old):
        raise RuntimeError("Downloader source does not match shipped package")
    tree = ast.parse(source)
    additions = {n.name: n for n in ast.parse((HERE / "mp_tools_reading_export.py").read_text(encoding="utf-8")).body if isinstance(n, ast.FunctionDef)}
    for i, node in enumerate(tree.body):
        if isinstance(node, ast.FunctionDef) and node.name in additions:
            tree.body[i] = additions.pop(node.name)
    tree.body.extend(additions.values())
    download = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "download_single_article")
    anchor = next(i for i, n in enumerate(download.body) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "settings" for t in n.targets))
    download.body[anchor+1:anchor+1] = ast.parse('''
existing_reading = campusos_existing_reading(url, out_dir)
if existing_reading:
    return existing_reading
''').body
    ast.fix_missing_locations(tree)
    compiled = compile(tree, old.co_filename, "exec", dont_inherit=True)
    intended = {"download_single_article", "campusos_article_folder", "campusos_save_reading"}
    for name, code in top_functions(old).items():
        if name not in intended and helper.code_hash(code) != helper.code_hash(top_functions(compiled)[name]):
            raise RuntimeError("Unrelated downloader function changed: " + name)
    changed["backend.downloader"] = zlib.compress(marshal.dumps(compiled), 9)
    functions_changed["backend.downloader"] = sorted(intended | {"campusos_existing_reading", "campusos_reading_result"})
    out.mkdir(parents=True, exist_ok=True)
    (out / "downloader.shared-library.py").write_text(ast.unparse(tree) + "\n", encoding="utf-8")
    for module, names in (("config", ["save_json"]), ("articles", ["_sync_history_from_disk", "clear_history", "delete_history_item"])):
        old = marshal.loads(zlib.decompress(archive["modules"]["backend."+module][1]))
        source_text = (args.source / (module+".py")).read_text(encoding="utf-8-sig")
        source_tree = ast.parse(source_text)
        source_functions = top_functions(compile(source_text, old.co_filename, "exec", dont_inherit=True))
        nodes = {n.name: n for n in source_tree.body if isinstance(n, ast.FunctionDef)}
        replacement = {}
        for name in names:
            if helper.code_hash(source_functions[name]) != helper.code_hash(top_functions(old)[name]):
                raise RuntimeError("Source function differs from shipped package: " + module + "." + name)
            node = nodes[name]
            if name == "save_json":
                node.body[:0] = ast.parse('''
if Path(filepath).resolve() == DOWNLOAD_HISTORY_FILE.resolve():
    from backend.campusos_article_library import merge_history
    return merge_history(filepath, data)
''').body
            elif name == "_sync_history_from_disk":
                node = next(n for n in ast.parse(Path(__file__).read_text(encoding="utf-8")).body if isinstance(n, ast.FunctionDef) and n.name == "history_scanner")
                node.name = name
            else:
                class ExactHistory(ast.NodeTransformer):
                    def visit_Call(self, call):
                        self.generic_visit(call)
                        if isinstance(call.func, ast.Name) and call.func.id == "save_json":
                            call.func.id = "write_history_exact"
                        return call
                ExactHistory().visit(node)
                original_body = node.body
                node.body = ast.parse("from backend.campusos_article_library import history_lock, write_history_exact").body + [
                    ast.With(items=[ast.withitem(context_expr=ast.parse("history_lock(DOWNLOAD_HISTORY_FILE)", mode="eval").body)], body=original_body)]
            replacement[name] = compile_function(node, old.co_filename)
        patched = replace_code(old, replacement)
        changed["backend."+module] = zlib.compress(marshal.dumps(patched), 9)
        functions_changed["backend."+module] = names
        # Every other function and all module-level constants/route bindings are retained verbatim.
        for name, code in top_functions(old).items():
            if name not in replacement and helper.code_hash(code) != helper.code_hash(top_functions(patched)[name]):
                raise RuntimeError("Unrelated packaged function changed")
    added = {}
    helper_hashes = {}
    for module, filename in (("backend.campusos_article_library", "article_library.py"), ("backend.campusos_reading_html", "reading_html.py")):
        payload = (HERE / filename).read_bytes()
        helper_hashes[filename] = sha(payload)
        code = compile(payload.decode("utf-8"), module.replace(".", "/")+".py", "exec", dont_inherit=True)
        added[module] = zlib.compress(marshal.dumps(code), 9)
    output = repack(helper, archive, changed, added)
    staged = out / "WeChat MP Tools.shared-library.exe"
    staged.write_bytes(output)
    report = {"patch": "v2.3.1-shared-article-library", "builtAt": datetime.now(timezone.utc).isoformat(),
              "previousSha256": sha(original), "patchedSha256": sha(output), "changedModules": list(changed),
              "addedModules": list(added), "changedFunctions": functions_changed, "helperSourceHashes": helper_hashes,
              "installed": False, "applicationRestarted": False, "upstreamRequests": 0}
    if args.install:
        command = "@(Get-CimInstance Win32_Process -Filter \"Name = 'WeChat MP Tools.exe'\").Count"
        running = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True, timeout=20)
        if running.returncode or int(running.stdout.strip() or "0"):
            raise RuntimeError("Close MP Tools before installation; staged patch is ready")
        if sha(exe.read_bytes()) != BASE_SHA:
            raise RuntimeError("Executable changed after staging")
        backup = out / "WeChat MP Tools.before-shared-library.exe"
        if backup.exists() and sha(backup.read_bytes()) != BASE_SHA:
            raise RuntimeError("Conflicting backup")
        if not backup.exists():
            shutil.copy2(exe, backup)
        pending = exe.with_name("WeChat MP Tools.shared-library.pending")
        pending.write_bytes(output)
        os.replace(pending, exe)
        if sha(exe.read_bytes()) != sha(output):
            raise RuntimeError("Installed executable readback differs")
        report["installed"] = True
    (out / ("report.json" if args.install else "staged-report.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
