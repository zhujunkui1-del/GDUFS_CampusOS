"""Owner-authorized local migration; run with all MP Tools writers stopped.

Keeps the existing HTML library mounted for the unchanged CampusOS bridge.
Never copies a process lock, discards a login, or calls an upstream endpoint.
"""
import ast
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PureWindowsPath, PurePosixPath
import shutil
import textwrap
import time

HERE = Path(__file__).resolve().parent
TARGET = Path(r"D:\tlydcg\Codex_work\wechat_mp_tools\wechat-mp-tools")
DESKTOP = Path(r"D:\WeChat MP Tools_v2.3.1")
USER_BACKUP = Path(r"C:\Users\zhuju\Desktop\WeChat MP Tools_v2.3.1")
DATA = TARGET / "deploy/docker/data"
SOURCE_DATA = DESKTOP / "data"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
SNAPSHOT = DATA / "migration-backups" / STAMP


def read(path, default):
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else copy.deepcopy(default)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def function(source, name, owner=None):
    nodes = ast.parse(source).body
    if owner:
        nodes = next(n for n in nodes if isinstance(n, ast.ClassDef) and n.name == owner).body
    return next(n for n in nodes if isinstance(n, ast.FunctionDef) and n.name == name)


def replace(source, name, value, owner=None):
    node = function(source, name, owner)
    value = textwrap.dedent(value).strip()
    if owner:
        value = textwrap.indent(value, "    ")
    lines = source.splitlines(keepends=True)
    return "".join(lines[:node.lineno - 1]) + value + "\n" + "".join(lines[node.end_lineno:])


def node_source(node, name=None):
    node = copy.deepcopy(node)
    node.decorator_list = []
    if name:
        node.name = name
    return ast.unparse(ast.fix_missing_locations(node))


def patch_file(relative, transform):
    path = TARGET / relative
    original = path.read_text(encoding="utf-8-sig")
    saved = SNAPSHOT / "source" / relative
    saved.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, saved)
    updated = transform(original)
    if path.suffix == ".py":
        compile(updated, str(path), "exec", dont_inherit=True)
    path.write_text(updated, encoding="utf-8", newline="\n")


def merge(rows, extra, key):
    found = {x[key]: dict(x) for x in rows}
    for row in extra:
        found.setdefault(row[key], {}).update(row)
    return list(found.values())


def main():
    if (DATA / "docker-migration-report.json").exists():
        raise RuntimeError("Migration already applied; inspect its report before repeating")
    SNAPSHOT.mkdir(parents=True)
    for name in ("accounts.json", "account_pool.json", "rss_subscriptions.json", "rss_articles.json", "app_settings.json", "download_history.json"):
        if (DATA / name).exists():
            shutil.copy2(DATA / name, SNAPSHOT / name)
    library = SOURCE_DATA / "articles_full"
    html = list(library.rglob("*.html"))
    if len(html) < 749:
        raise RuntimeError("Expected complete source article library")
    hashes = {str(p.relative_to(library)): hashlib.sha256(p.read_bytes()).hexdigest() for p in html}
    for relative, digest in hashes.items():
        backup = USER_BACKUP / "data/articles_full" / relative
        if not backup.exists() or hashlib.sha256(backup.read_bytes()).hexdigest() != digest:
            raise RuntimeError("Owner's HTML backup differs: " + relative)
    write(SNAPSHOT / "article-hashes.json", hashes)
    # Keep the newer Docker login; desktop credentials remain in the owner backup.
    if not (DATA / "account_pool.json").exists():
        shutil.copy2(SOURCE_DATA / "account_pool.json", DATA / "account_pool.json")
    accounts = merge(read(SOURCE_DATA / "accounts.json", []), read(DATA / "accounts.json", []), "fakeid")
    subs = merge(read(SOURCE_DATA / "rss_subscriptions.json", []), read(DATA / "rss_subscriptions.json", []), "fakeid")
    for i, sub in enumerate(subs):
        sub["next_fetch_time"] = time.time() + 60 * (i + 1)
    cache = read(SOURCE_DATA / "rss_articles.json", {})
    for key, rows in read(DATA / "rss_articles.json", {}).items():
        current = cache.setdefault(key, [])
        known = {x.get("link") or x.get("url") or x.get("id") for x in current}
        current.extend(x for x in rows if (x.get("link") or x.get("url") or x.get("id")) not in known)
    history = read(SOURCE_DATA / "download_history.json", [])
    history.extend(read(DATA / "download_history.json", []))
    windows_root = PureWindowsPath(str(library))
    for row in history:
        if row.get("path"):
            try:
                relative = PureWindowsPath(row["path"]).relative_to(windows_root)
                row["path"] = str(PurePosixPath("/app/data/articles_full").joinpath(*relative.parts))
            except ValueError:
                if not row["path"].startswith("/app/data/articles_full/"):
                    raise RuntimeError("Unmapped article path")
    settings = read(SOURCE_DATA / "app_settings.json", {})
    settings.update(read(DATA / "app_settings.json", {}))
    settings.update({"campusos_reading_only": True, "auto_save_images": False,
                     "auto_save_videos": False, "save_markdown": False, "save_pdf": False,
                     "download_dir": "/app/data/articles_full", "concurrent_downloads": 1,
                     "rss_collection_paused": True, "weread_request_interval_seconds": 4,
                     "weread_cooldown_seconds": 300})
    for name, data in (("accounts.json", accounts), ("rss_subscriptions.json", subs), ("rss_articles.json", cache),
                       ("download_history.json", history), ("app_settings.json", settings)):
        write(DATA / name, data)
    if (SOURCE_DATA / "avatars").exists():
        shutil.copytree(SOURCE_DATA / "avatars", DATA / "avatars", dirs_exist_ok=True)

    patched = (SOURCE_DATA / "patches/shared-article-library-2026-10-22/downloader.shared-library.py").read_text(encoding="utf-8")
    export_tree = ast.parse(patched)
    helpers = [n for n in export_tree.body if isinstance(n, ast.FunctionDef) and
               (n.name.startswith("campusos_") or n.name.startswith("_campusos_"))]
    def downloader(source):
        source = replace(source, "download_single_article", node_source(function(patched, "download_single_article")))
        source += "\nfrom datetime import datetime, timezone\nfrom threading import RLock\nfrom html import escape\nfrom urllib.parse import urlsplit, urlunsplit, parse_qs, urlencode\nfrom backend.campusos_reading_html import reading_fragment\n_campusos_directory_lock = RLock()\n_campusos_directory_index = {}\n"
        return source + "\n\n".join(node_source(n) for n in helpers) + "\n"
    patch_file("backend/downloader.py", downloader)
    patch_report = read(SOURCE_DATA / "patches/shared-article-library-2026-10-22/report.json", {})
    for source, dest in (("article_library.py", "campusos_article_library.py"), ("reading_html.py", "campusos_reading_html.py")):
        blob = (HERE / source).read_bytes()
        if hashlib.sha256(blob).hexdigest() != patch_report["helperSourceHashes"][source]:
            raise RuntimeError("Shared helper differs from installed desktop patch")
        (TARGET / "backend" / dest).write_bytes(blob)

    def config(source):
        node = copy.deepcopy(function(source, "save_json"))
        node.body[0:0] = ast.parse('''
if Path(filepath).resolve() == DOWNLOAD_HISTORY_FILE.resolve():
    from backend.campusos_article_library import merge_history
    return merge_history(filepath, data)
''').body
        source = replace(source, "save_json", node_source(node))
        return source.replace('DEFAULT_SETTINGS = {', 'DEFAULT_SETTINGS = {\n    "campusos_reading_only": True,\n    "rss_collection_paused": False,\n    "weread_request_interval_seconds": 4,\n    "weread_cooldown_seconds": 300,')
    patch_file("backend/config.py", config)

    strict = (HERE / "mp_tools_history.py").read_text(encoding="utf-8")
    scanner = (HERE / "patch_mp_tools_library.py").read_text(encoding="utf-8")
    def articles(source):
        source = replace(source, "_sync_history_from_disk", node_source(function(scanner, "history_scanner"), "_sync_history_from_disk"))
        for name in ("clear_history", "delete_history_item"):
            node = copy.deepcopy(function(source, name))
            class Exact(ast.NodeTransformer):
                def visit_Name(self, n):
                    return ast.copy_location(ast.Name(id="write_history_exact", ctx=n.ctx), n) if n.id == "save_json" else n
            Exact().visit(node)
            node.body = ast.parse("from backend.campusos_article_library import history_lock, write_history_exact").body + [
                ast.With(items=[ast.withitem(context_expr=ast.parse("history_lock(DOWNLOAD_HISTORY_FILE)", mode="eval").body)], body=node.body)]
            source = replace(source, name, node_source(node))
        fetch = node_source(function(strict, "_fetch_articles_page")).replace("_short_id_from_review_id", "short_id_from_review_id").replace("_restore_wechat_short_url", "normalize_wechat_short_url")
        source = replace(source, "_fetch_articles_page", fetch)
        source += '''
def _history_request(session, url, headers, account_id):
    response = session.get(url, headers=headers, timeout=20)
    try:
        data = response.json()
    except ValueError:
        raise RuntimeError("历史目录响应格式错误") from None
    if not isinstance(data, dict):
        raise RuntimeError("历史目录响应格式错误")
    return data
'''
        source = replace(source, "get_articles", '''
def get_articles(fakeid):
    begin = request.args.get("begin", 0, type=int)
    count = request.args.get("count", 10, type=int)
    keyword = request.args.get("keyword", "").strip()
    try:
        rows, total, more = _fetch_articles_page(fakeid, begin, count, keyword)
        return jsonify({"articles": rows, "total": total, "count": len(rows), "begin": begin,
                        "can_msg_continue": more, "directory_complete": True, "list_origin": "upstream_history"})
    except Exception as error:
        status = getattr(error, "status", 503)
        data = {"error": str(error), "directory_complete": False, "error_code": getattr(error, "code", None)}
        response = jsonify(data)
        response.status_code = status
        if getattr(error, "retry_after", 0):
            response.headers["Retry-After"] = str(error.retry_after)
        return response
''')
        return source
    patch_file("backend/articles.py", articles)

    def pool(source):
        source = replace(source, "acquire", node_source(function(strict, "history_pool_acquire"), "acquire"), "AccountPool")
        report = function(strict, "history_pool_report")
        text = node_source(report, "report")
        text = text.replace('account[\'cooldown_until\'] = max(account.get(\'cooldown_until\', 0), now + max(120.0, retry_after))', '''from backend.config import get_settings
            hits = int(account.get('rate_limit_hits', 0)) + 1
            account['rate_limit_hits'] = hits
            base = max(1.0, float(get_settings().get('weread_cooldown_seconds', 300)))
            delay = max(float(retry_after), min(3600.0, base * 2 ** min(hits - 1, 4)))
            account['cooldown_until'] = max(account.get('cooldown_until', 0), now + delay)''')
        source = replace(source, "report", text, "AccountPool")
        borrow = function(source, "borrow_weread_session")
        text = ast.get_source_segment(source, borrow)
        old = 'raise RuntimeError("微信读书账号池中暂无可用账号，请先在『账号池』页面扫码登录")'
        new = '''from backend.campusos_weread import WereadRequestError
        with account_pool._lock:
            cooling = [a for a in account_pool._load() if a.get("status") == "cooldown"]
        if cooling:
            item = min(cooling, key=lambda a: a.get("cooldown_until", 0))
            left = max(1, int(item.get("cooldown_until", 0) - time.time()) + 1)
            raise WereadRequestError("微信读书账号冷却中，剩余 " + str(left) + " 秒；" + str(item.get("last_error") or ""), status=429, code=item.get("last_ret"), retry_after=left)
        raise WereadRequestError("微信读书暂无可用登录，请在账号池登录", status=401)'''
        if old not in text:
            raise RuntimeError("Borrow function boundary changed")
        source = replace(source, "borrow_weread_session", text.replace(old, new))
        source = source.replace("s = requests.Session()", "from backend.campusos_weread import WereadSession\n                s = WereadSession()")
        return source.replace("pool_maxsize=20, max_retries=1", "pool_maxsize=1, max_retries=0")
    patch_file("backend/account_pool.py", pool)
    def scheduler(source):
        source = source.replace("MAX_FETCH_WORKERS = 50", "MAX_FETCH_WORKERS = 1")
        source = source.replace('    def _tick(self):\n', '    def _tick(self):\n        from backend.config import get_settings\n        if get_settings().get("rss_collection_paused", False):\n            return\n')
        anchor = '        from backend.articles import _fetch_articles_page\n'
        return source.replace(anchor, '        from backend.config import get_settings\n        if get_settings().get("rss_collection_paused", False):\n            return\n' + anchor)
    patch_file("backend/rss_scheduler.py", scheduler)

    def article_js(source):
        start = source.index("    async loadArticles()")
        catch = source.index("        } catch (err) {", start)
        end = source.index("    async syncTargetAccount", catch)
        source = source[:catch] + '''        } catch (err) {
            container.innerHTML = '<div class="empty-state"><h3 class="empty-state-title">文章目录暂不可用</h3><p class="empty-state-desc" id="article-directory-error"></p><button class="btn btn-secondary" onclick="ArticlesPage.loadArticles()">重试</button></div>';
            document.getElementById('article-directory-error').textContent = err.message || '请求失败';
        }
    },

''' + source[end:]
        return source.replace("            this.articles = data.articles || [];", "            if (data.error) throw new Error(data.error);\n            this.articles = data.articles || [];")
    patch_file("frontend/js/components/articles.js", article_js)
    def accounts_js(source):
        source = source.replace('<span class="badge badge-info" id="accounts-count">0 个</span>', '<span class="badge badge-info" id="accounts-count">0 个</span><button class="btn btn-secondary" id="collection-toggle" disabled onclick="AccountsPage.toggleCollection()">采集状态加载中</button>')
        source = source.replace("        await this.loadAccounts();", "        await this.loadAccounts();\n        await this.loadCollectionState();", 1)
        anchor = "    async loadAccounts() {"
        methods = '''    async loadCollectionState() {
        const settings = await API.settings.get();
        this.collectionPaused = !!settings.rss_collection_paused;
        const button = document.getElementById('collection-toggle');
        if (button) {
            button.disabled = false;
            button.textContent = this.collectionPaused ? '恢复自动采集' : '暂停自动采集';
        }
    },

    async toggleCollection() {
        await API.settings.save({rss_collection_paused: !this.collectionPaused});
        await this.loadCollectionState();
        Toast.info(this.collectionPaused ? '自动采集已暂停' : '自动采集已恢复');
    },

'''
        return source.replace(anchor, methods + anchor)
    patch_file("frontend/js/components/accounts.js", accounts_js)

    def compose(source):
        anchor = "      - ./data:/app/data"
        if source.count(anchor) != 1:
            raise RuntimeError("Compose volume boundary changed")
        return source.replace(anchor, anchor + '\n      - "${CAMPUSOS_ARTICLE_LIBRARY:-./data/articles_full}:/app/data/articles_full"')
    patch_file("deploy/docker/docker-compose.yaml", compose)
    env = TARGET / "deploy/docker/.env"
    shutil.copy2(env, SNAPSHOT / "compose.env")
    env.write_text(env.read_text(encoding="utf-8-sig").rstrip() + "\nCAMPUSOS_ARTICLE_LIBRARY=D:/WeChat MP Tools_v2.3.1/data/articles_full\n", encoding="utf-8", newline="\n")
    report = {"created_at": datetime.now(timezone.utc).isoformat(), "snapshot": str(SNAPSHOT),
              "accounts": len(accounts), "subscriptions": len(subs), "enabled_subscriptions_preserved": sum(bool(x.get("enabled")) for x in subs),
              "rss_collection_paused": True, "history_rows": len(history), "successful_history": sum(bool(x.get("success")) for x in history),
              "html_files": len(html), "html_bytes": sum(x.stat().st_size for x in html),
              "html_backup_hashes_match": True, "shared_library": str(library), "upstream_requests": 0,
              "lightweight_patch": "installed desktop exporter + unchanged matching helper sources"}
    write(DATA / "docker-migration-report.json", report)
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
