"""Build/install the narrowly scoped directory + title-HTML repair from v5.

No download task, login, upstream request or article migration is started here.
Only reviewed package modules and the article-list UI are changed.
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
OUT = ROOT / "data/patches/history-browse-2026-10-22"
BASE_SHA = "02611609175a1aa1f6b4ec2720004f961f5bbf3c9e420fd572e6d6212f023570"
SOURCE = Path(r"D:\tlydcg\Codex_work\wechat_mp_tools\wechat-mp-tools\backend")
HERE = Path(__file__).resolve().parent


def sha(blob):
    return hashlib.sha256(blob).hexdigest()


def replace_function(nodes, replacement, name):
    matches = [i for i, node in enumerate(nodes) if isinstance(node, ast.FunctionDef) and node.name == name]
    if len(matches) != 1:
        raise RuntimeError("Reviewed function boundary changed: " + name)
    replacement.name = name
    nodes[matches[0]] = replacement


def pack(helper, archive, changed):
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
        payload = (zlib.compress(raw, 9) if entry["flag"] else raw) if raw is not None else entry["payload"]
        size = len(raw) if raw is not None else entry["size"]
        offset = len(body)
        body.extend(payload)
        table.extend(struct.pack("!iIIIBc", entry["entry_size"], offset, len(payload), size,
                                 entry["flag"], entry["kind"]) + entry["name_bytes"])
    cookie = archive["cookie"]
    output = archive["prefix"] + bytes(body) + bytes(table) + struct.pack(
        "!8sIIII64s", helper.MAGIC, len(body) + len(table) + 88, len(body), len(table), cookie[4], cookie[5])
    checked = helper.read_archive(output)
    if checked["prefix"] != archive["prefix"] or list(checked["modules"]) != list(archive["modules"]):
        raise RuntimeError("Package identity changed")
    for name, value in archive["modules"].items():
        if name not in changed and checked["modules"][name] != value:
            raise RuntimeError("Unrelated module changed: " + name)
    for old, new in zip(archive["entries"], checked["entries"]):
        if old["kind"] != b"z" and old["payload"] != new["payload"]:
            raise RuntimeError("Unrelated outer package payload changed")
    return output


def patch_ui(text):
    text = text.replace("\r\n", "\n")
    start_anchor = "    async loadArticles() {\n"
    if text.count(start_anchor) != 1:
        raise RuntimeError("Reviewed article-list loader changed")
    text = text.replace(start_anchor, start_anchor + "        const requestId = this._directoryRequestId = (this._directoryRequestId || 0) + 1;\n")
    expected = "            this.articles = data.articles || [];"
    if text.count(expected) != 1:
        raise RuntimeError("Reviewed article-list assignment changed")
    text = text.replace(expected, "            if (requestId !== this._directoryRequestId) return;\n            if (data.error) throw new Error(data.error);\n" + expected)
    start = text.index("        } catch (err) {", text.index("    async loadArticles()"))
    end = text.index("    async syncTargetAccount", start)
    text = text[:start] + '''        } catch (err) {
            if (requestId !== this._directoryRequestId) return;
            document.getElementById('articles-pagination').style.display = 'none';
            container.innerHTML = `<div class="empty-state" style="padding:40px 20px">
                <h3 class="empty-state-title">历史文章列表加载失败</h3>
                <p class="empty-state-desc" id="article-directory-error"></p>
                <button class="btn btn-secondary" onclick="ArticlesPage.loadArticles()">重试</button>
                <a class="btn btn-secondary" href="#login">账号池</a>
            </div>`;
            document.getElementById('article-directory-error').textContent = err.message || '网络请求失败';
        }
    },

''' + text[end:]
    return text


def main():
    spec = importlib.util.spec_from_file_location("browse_archive", ROOT / "data/patches/short-url-2026-10-21/patch_package.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    exe = ROOT / "WeChat MP Tools.exe"
    original = exe.read_bytes()
    installed_sha = sha(original)
    if installed_sha != BASE_SHA:
        raise RuntimeError("Current EXE differs from the verified v5 rollback")
    archive = helper.read_archive(original)
    replacements = {n.name: n for n in ast.parse((HERE / "mp_tools_history.py").read_text(encoding="utf-8")).body
                    if isinstance(n, ast.FunctionDef)}
    exporter = ast.parse((HERE / "mp_tools_reading_export.py").read_text(encoding="utf-8"))
    changed = {}
    for module, source in [
        ("backend.articles", ROOT / "data/patches/short-url-2026-10-21/articles.patched.py"),
        ("backend.account_pool", SOURCE / "account_pool.py"),
        ("backend.downloader", ROOT / "data/patches/campusos-reading-2026-10-21/downloader.reading.py")]:
        old = marshal.loads(zlib.decompress(archive["modules"][module][1]))
        source_text = source.read_text(encoding="utf-8")
        if helper.code_hash(compile(source_text, old.co_filename, "exec", dont_inherit=True)) != helper.code_hash(old):
            raise RuntimeError("Source differs from packaged code: " + module)
        tree = ast.parse(source_text)
        if module == "backend.articles":
            replace_function(tree.body, replacements["_fetch_articles_page"], "_fetch_articles_page")
            tree.body.extend(replacements[n] for n in ("_history_request", "_history_error_response"))
            route = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "get_articles")
            handler = next(n for n in route.body if isinstance(n, ast.Try)).handlers[-1]
            handler.body = ast.parse("return jsonify({'error': str(e), 'directory_complete': False}), 503").body
        elif module == "backend.account_pool":
            cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "AccountPool")
            replace_function(cls.body, replacements["history_pool_acquire"], "acquire")
            replace_function(cls.body, replacements["history_pool_report"], "report")
            replace_function(tree.body, replacements["history_borrow_weread_session"], "borrow_weread_session")
        else:
            for node in exporter.body:
                if not isinstance(node, ast.FunctionDef):
                    continue
                if node.name == "campusos_file_metadata":
                    tree.body.append(node)
                else:
                    replace_function(tree.body, node, node.name)
            hooks = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                     and isinstance(n.func, ast.Name) and n.func.id == "campusos_save_reading"]
            if len(hooks) != 1:
                raise RuntimeError("Reviewed HTML export hook changed")
            hooks[0].args[3] = ast.parse("page_title or title_hint or safe_title", mode="eval").body
            download = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "download_single_article")
            class ProtectReadingOnFailure(ast.NodeTransformer):
                def visit_Expr(self, node):
                    call = node.value
                    if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                            and isinstance(call.func.value, ast.Name) and call.func.value.id == "shutil"
                            and call.func.attr == "rmtree"):
                        return ast.If(test=ast.parse("not settings.get('campusos_reading_only', False)", mode="eval").body,
                                      body=[node], orelse=[])
                    return node
            ProtectReadingOnFailure().visit(download)
        ast.fix_missing_locations(tree)
        text = ast.unparse(tree) + "\n"
        code = compile(text, old.co_filename, "exec", dont_inherit=True)
        changed[module] = zlib.compress(marshal.dumps(code), 9)
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / (module.split(".")[-1] + ".browse.py")).write_text(text, encoding="utf-8")
    output = pack(helper, archive, changed)
    staged = OUT / "WeChat MP Tools.browse.exe"
    staged.write_bytes(output)
    ui = ROOT / "_internal/frontend/js/components/articles.js"
    before_ui = ui.read_bytes()
    ui_output = patch_ui(before_ui.decode("utf-8-sig")).encode("utf-8")
    (OUT / "articles.browse.js").write_bytes(ui_output)
    report = {"patch": "directory-errors-and-title-html-v7", "builtAt": datetime.now(timezone.utc).isoformat(),
              "baseSha256": BASE_SHA, "patchedSha256": sha(output), "changedModules": list(changed),
              "uiSha256": sha(ui_output), "networkRequests": 0, "installed": False,
              "onlineHistoryRestored": False, "bulkBackfillStarted": False}
    if "--install" in sys.argv:
        if helper.running():
            raise RuntimeError("MP Tools must be closed before installation; staged repair is ready")
        if sha(exe.read_bytes()) != installed_sha or ui.read_bytes() != before_ui:
            raise RuntimeError("Application changed after build")
        protected = [p for p in (ROOT / "data").glob("*.json")]
        data_hashes = {p.name: sha(p.read_bytes()) for p in protected}
        article_hashes = {str(p.relative_to(ROOT / "data/articles_full")): sha(p.read_bytes())
                          for p in (ROOT / "data/articles_full").rglob("*") if p.is_file()}
        for filename, payload in [("WeChat MP Tools.before-browse.exe", original), ("articles.before-browse.js", before_ui)]:
            target = OUT / filename
            if target.exists() and target.read_bytes() != payload:
                raise RuntimeError("Conflicting backup: " + filename)
            target.write_bytes(payload)
        for path in protected:
            shutil.copy2(path, OUT / ("before-" + path.name))
        try:
            pending = ROOT / "WeChat MP Tools.browse.pending"
            pending.write_bytes(output)
            os.replace(pending, exe)
            pending_ui = ui.with_suffix(".js.pending")
            pending_ui.write_bytes(ui_output)
            os.replace(pending_ui, ui)
            if sha(exe.read_bytes()) != sha(output) or sha(ui.read_bytes()) != sha(ui_output):
                raise RuntimeError("Installation readback differs")
        except Exception:
            exe.write_bytes(original)
            ui.write_bytes(before_ui)
            raise
        after_data = {p.name: sha(p.read_bytes()) for p in protected}
        after_articles = {str(p.relative_to(ROOT / "data/articles_full")): sha(p.read_bytes())
                          for p in (ROOT / "data/articles_full").rglob("*") if p.is_file()}
        if after_data != data_hashes or after_articles != article_hashes:
            raise RuntimeError("Protected application data changed")
        report.update(installed=True, protectedDataFiles=len(protected), articleFilesUnchanged=len(article_hashes))
    (OUT / ("report.json" if report["installed"] else "staged-report.json")).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
