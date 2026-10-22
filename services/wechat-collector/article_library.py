"""Shared, append-only article files and MP Tools history registration.

The WeRSS bridge and the embedded MP Tools exporter use the same file locks.
Missing folders never mean that a remote article should be removed.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from html import escape, unescape
from html.parser import HTMLParser
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

try:
    from reading_html import reading_fragment
except ModuleNotFoundError:
    from backend.campusos_reading_html import reading_fragment

_thread_guard = threading.Lock()
_thread_locks = {}


def canonical_url(raw):
    if not isinstance(raw, str):
        return None
    try:
        value = urlsplit(unescape(raw.strip()))
        if (value.scheme not in {"http", "https"} or value.hostname != "mp.weixin.qq.com"
                or value.username or value.password or value.port not in {None, 80, 443}):
            return None
        if re.fullmatch(r"/s/[A-Za-z0-9_~\-]+", value.path):
            return urlunsplit(("https", "mp.weixin.qq.com", value.path.replace("~", "_"), "", ""))
        fields = parse_qs(value.query)
        if value.path == "/s" and all(fields.get(k) for k in ("__biz", "mid", "idx", "sn")):
            return "https://mp.weixin.qq.com/s?" + urlencode({k: fields[k][0] for k in ("__biz", "mid", "idx", "sn")})
    except ValueError:
        pass
    return None


def read_metadata(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        return {}

    class Metadata(HTMLParser):
        value = None

        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if tag == "meta" and values.get("name") == "campusos-article":
                self.value = json.loads(values.get("content", ""))

    try:
        parser = Metadata()
        with path.open(encoding="utf-8-sig") as stream:
            parser.feed(stream.read(65536))
        value = parser.value
        return value if isinstance(value, dict) and value.get("format") == "reading_html" else {}
    except (ValueError, OSError):
        return {}


def reading_files(export_root):
    root = Path(export_root)
    if not root.is_dir() or root.is_symlink():
        return
    for account in root.iterdir():
        if not account.is_dir() or account.is_symlink() or account.name.startswith("."):
            continue
        for folder in account.iterdir():
            if folder.is_dir() and not folder.is_symlink():
                for path in sorted(folder.glob("*.html")):
                    if not path.name.endswith("_raw.html") and not path.is_symlink():
                        yield path


def find_existing(export_root, url, account_id=None):
    key = canonical_url(url)
    if not key:
        raise ValueError("ARTICLE_URL_INVALID")
    for path in reading_files(export_root):
        meta = read_metadata(path)
        if canonical_url(meta.get("url")) == key:
            # An URL uniquely identifies its publisher. Preserve an existing
            # legacy export whose older metadata has no account identifier.
            if account_id and meta.get("account_id") not in {None, "", account_id}:
                raise ValueError("ARTICLE_ACCOUNT_CONFLICT")
            return path
    return None


@contextmanager
def _file_lock(path, timeout=60):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    key = str(path.resolve())
    with _thread_guard:
        guard = _thread_locks.setdefault(key, threading.RLock())
    with guard:
        with path.open("a+b") as stream:
            stream.seek(0, 2)
            if not stream.tell():
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                deadline = time.monotonic() + timeout
                while True:
                    try:
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise TimeoutError("ARTICLE_LOCK_TIMEOUT")
                        time.sleep(0.05)
                try:
                    yield
                finally:
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def article_lock(export_root, url):
    key = canonical_url(url)
    if not key:
        raise ValueError("ARTICLE_URL_INVALID")
    digest = hashlib.sha256(key.encode()).hexdigest()
    return _file_lock(Path(export_root) / ".campusos-locks" / (digest + ".lock"))


def history_lock(history_path):
    return _file_lock(Path(history_path).with_name(".campusos-history.lock"))


def _read_history(path):
    if not path.exists():
        return []
    result = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(result, list):
        raise ValueError("DOWNLOAD_HISTORY_INVALID")
    return result


def _atomic_json(path, rows):
    pending = path.with_name(path.name + ".campusos.pending")
    if path.is_symlink() or pending.is_symlink():
        raise ValueError("UNSAFE_HISTORY_FILE")
    pending.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(pending, path)


def _history_identity(row):
    if not isinstance(row, dict):
        return None
    return canonical_url(row.get("link") or row.get("url")) or row.get("path")


def merge_history(history_path, incoming):
    """Merge a native stale read/modify/write without dropping bridge imports."""
    path = Path(history_path)
    if not isinstance(incoming, list):
        raise ValueError("DOWNLOAD_HISTORY_INVALID")
    with history_lock(path):
        rows = _read_history(path)
        original = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        by_key = {_history_identity(row): row for row in rows if _history_identity(row)}
        for item in incoming:
            key = _history_identity(item)
            existing = by_key.get(key) if key else None
            if existing is not None:
                # A failed duplicate attempt must not hide a readable export.
                if existing.get("success") and not item.get("success"):
                    continue
                existing.update(item)
            elif item not in rows:
                row = dict(item) if isinstance(item, dict) else item
                rows.append(row)
                if key:
                    by_key[key] = row
        if json.dumps(rows, ensure_ascii=False, separators=(",", ":")) != original:
            _atomic_json(path, rows)


def write_history_exact(history_path, rows):
    """Only native user-triggered history deletion calls this operation."""
    # Callers hold history_lock across their read and intentional modification.
    _atomic_json(Path(history_path), rows)


def history_entry(path, meta):
    try:
        observed = datetime.fromisoformat(meta["time"].replace("Z", "+00:00")).timestamp()
    except (KeyError, TypeError, ValueError):
        observed = path.stat().st_mtime
    return {"title": meta.get("title") or path.parent.name,
            "link": canonical_url(meta.get("url")) or "", "account": meta.get("source") or path.parent.parent.name,
            "account_id": meta.get("account_id"), "author": meta.get("source", ""),
            "success": True, "time": observed, "error": None, "path": str(path.parent),
            "publish_time": meta.get("publish_time"), "cover_url": "", "digest": "",
            "has_markdown": False, "has_pdf": False, "campusos_origin": meta.get("origin", "mp_tools")}


def register_history(export_root, path):
    path = Path(path)
    meta = read_metadata(path)
    if not canonical_url(meta.get("url")):
        raise ValueError("ARTICLE_METADATA_INVALID")
    merge_history(Path(export_root).parent / "download_history.json", [history_entry(path, meta)])


def safe_component(value, budget=80):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", unescape(str(value))).strip().rstrip(". ") or "未命名"
    if name.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *("COM"+str(i) for i in range(1, 10)), *("LPT"+str(i) for i in range(1, 10))}:
        name = "_" + name
    while len(name.encode("utf-16-le")) // 2 > budget:
        name = name[:-1]
    return name.rstrip(". ") or "未命名"


def article_folder(account_root, title, url):
    root = Path(account_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(canonical_url(url).encode()).hexdigest()
    budget = min(90, (238 - len(str(root).encode("utf-16-le")) // 2 - 26) // 2)
    if budget < 8:
        raise ValueError("EXPORT_PATH_TOO_LONG")
    for suffix in ("", " ["+digest[:8]+"]", " ["+digest[:16]+"]", " ["+digest[:32]+"]"):
        folder = root / (safe_component(title, max(8, budget - len(suffix))) + suffix)
        if folder.is_symlink() or folder.resolve().parent != root:
            raise ValueError("UNSAFE_ARTICLE_DIRECTORY")
        try:
            folder.mkdir()
            return folder
        except FileExistsError:
            if folder.is_dir() and any(canonical_url(read_metadata(p).get("url")) == canonical_url(url) for p in folder.glob("*.html")):
                return folder
    raise ValueError("ARTICLE_DIRECTORY_COLLISION")


def reading_document(meta, fragment):
    csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; media-src https:; font-src data:; frame-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta http-equiv="Content-Security-Policy" content="' + escape(csp, quote=True) + '">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="campusos-article" content="' + escape(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), quote=True) + '">'
            '<title>' + escape(meta["title"]) + '</title><style>body{margin:0 auto;padding:20px;max-width:677px;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}table{max-width:100%}</style></head><body>'
            + fragment + '</body></html>')


def write_imported_article(export_root, *, account_id, source_name, title, url,
                           published_at, content_html, observed_at, content_hash=None):
    root = Path(export_root).resolve()
    key = canonical_url(url)
    if not key or not re.fullmatch(r"MP_WXS_\d+", account_id or ""):
        raise ValueError("ARTICLE_IDENTITY_INVALID")
    if not isinstance(published_at, (int, float)) or isinstance(published_at, bool) or not 946684800 <= published_at <= time.time() + 86400:
        raise ValueError("ARTICLE_PUBLICATION_TIME_INVALID")
    observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    if observed.tzinfo is None or not str(source_name).strip() or not str(title).strip():
        raise ValueError("ARTICLE_METADATA_INVALID")
    with article_lock(root, key):
        previous = find_existing(root, key, account_id)
        if previous:
            register_history(root, previous)
            return {"path": str(previous), "created": False, "skipped": True}
        # Only known WeChat CDN image references are upgraded to HTTPS.
        content_html = re.sub(r"http://((?:mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn|mmbiz\.weixin\.qq\.com)/)", r"https://\1", content_html, flags=re.I)
        fragment, omitted = reading_fragment(content_html)
        meta = {"title": unescape(str(title)).strip(), "url": key, "source": str(source_name).strip(),
                "account_id": account_id, "publish_time": int(published_at), "publish_time_source": "werss_api",
                "time": observed.astimezone(timezone.utc).isoformat(), "media_omitted": omitted,
                "format": "reading_html", "rendering_version": 3, "origin": "werss",
                "has_markdown": False, "has_pdf": False, "resources_count": 0, "videos_count": 0,
                "content_hash": content_hash or hashlib.sha256(fragment.encode()).hexdigest()}
        source_root = root / safe_component(source_name, 60)
        if source_root.is_symlink():
            raise ValueError("UNSAFE_ARTICLE_DIRECTORY")
        folder = article_folder(source_root, title, key)
        target = folder / "reading.html"
        pending = folder / "reading.html.campusos.pending"
        if target.exists() or target.is_symlink() or pending.is_symlink():
            raise ValueError("ARTICLE_FILE_COLLISION")
        pending.write_text(reading_document(meta, fragment), encoding="utf-8")
        os.replace(pending, target)
        register_history(root, target)
        return {"path": str(target), "created": True, "skipped": False}
