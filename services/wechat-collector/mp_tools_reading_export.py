"""HTML-only output adapter embedded in the owner's existing MP Tools package."""
import hashlib
import json
from pathlib import Path
import re
import os
from datetime import datetime, timezone
from html import unescape, escape
from html.parser import HTMLParser
from threading import RLock
from urllib.parse import urlsplit, urlunsplit, parse_qs, urlencode

try:
    from reading_html import reading_fragment
except ModuleNotFoundError:
    from backend.campusos_reading_html import reading_fragment

# The installer embeds reading_html.py above this module, without another runtime dependency.
_campusos_directory_lock = RLock()
_campusos_directory_index = {}


def campusos_file_metadata(file):
    if not file.is_file() or file.is_symlink():
        return {}
    class Metadata(HTMLParser):
        value = None
        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if tag == "meta" and values.get("name") == "campusos-article":
                self.value = json.loads(values.get("content", ""))
    try:
        parser = Metadata()
        with file.open(encoding="utf-8-sig") as stream:
            parser.feed(stream.read(65536))
        value = parser.value
        return value if isinstance(value, dict) and value.get("format") == "reading_html" else {}
    except (ValueError, OSError):
        return {}


def campusos_article_metadata(folder):
    candidates = [folder / (folder.name + ".html"), folder / "reading.html", *sorted(folder.glob("*.html"))]
    for file in dict.fromkeys(candidates):
        value = campusos_file_metadata(file)
        if value:
            return value
    return {}


def _campusos_article_key(raw):
    if not isinstance(raw, str):
        return None
    try:
        url = urlsplit(raw)
        if url.hostname != "mp.weixin.qq.com" or url.username or url.password:
            return None
        if url.path.startswith("/s/"):
            return urlunsplit(("https", "mp.weixin.qq.com", url.path.replace("~", "_"), "", ""))
        fields = parse_qs(url.query)
        if url.path == "/s" and all(fields.get(k) for k in ("__biz", "mid", "idx", "sn")):
            return "https://mp.weixin.qq.com/s?" + urlencode({k: fields[k][0] for k in ("__biz", "mid", "idx", "sn")})
    except ValueError:
        pass
    return None


def campusos_folder_name(title, root, suffix=""):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", unescape(str(title))).strip().rstrip(". ") or "未命名文章"
    if name.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *("COM"+str(i) for i in range(1, 10)), *("LPT"+str(i) for i in range(1, 10))}:
        name = "_" + name
    # The title occurs twice: <title>/<title>.html (and the atomic .tmp suffix).
    budget = min(110, (240 - len(str(root).encode("utf-16-le")) // 2 - len("//.html.tmp")) // 2 - len(suffix))
    if budget < 8:
        raise ValueError("EXPORT_PATH_TOO_LONG")
    while len(name.encode("utf-16-le")) // 2 > budget:
        name = name[:-1]
    return (name.rstrip(". ") or "未命名文章") + suffix


def campusos_article_folder(out_dir, title, url):
    try:
        from article_library import article_folder
    except ModuleNotFoundError:
        from backend.campusos_article_library import article_folder
    if not _campusos_article_key(url):
        raise ValueError("ARTICLE_URL_INVALID")
    return article_folder(out_dir, title, url)


def campusos_save_reading(raw_html, url, out_dir, title, content_html, publish_time, review_id):
    try:
        from article_library import article_lock, find_existing, register_history, reading_document, read_metadata
    except ModuleNotFoundError:
        from backend.campusos_article_library import article_lock, find_existing, register_history, reading_document, read_metadata
    title = unescape(str(title)).strip() or "未命名文章"
    # Never use MP Tools' download-time fallback as an original publication time.
    original_time = re.search(r"\b(?:ct|publish_time)[\"']?\s*[:=]\s*[\"']?(\d{10})", raw_html)
    # Downloading and eligibility for publication are separate. Missing dates do
    # not discard a readable article and never inherit the download-time fallback.
    publish_time = int(original_time.group(1)) if original_time else None
    fragment, omitted = reading_fragment(content_html)
    name = ""
    for pattern in (r"\bnickname\s*=\s*[\"']([^\"']+)[\"']", r'class="profile_nickname"[^>]*>([^<]+)<', r'id="js_name"[^>]*>([^<]+)<'):
        match = re.search(pattern, raw_html)
        if match:
            name = unescape(match.group(1)).strip()
            break
    account = re.match(r"^(MP_WXS_\d+)(?:_|$)", review_id or "")
    account_id = account.group(1) if account else None
    meta = {"title": title, "url": url, "source": name, "account_id": account_id,
            "publish_time": publish_time, "publish_time_source": "original_page" if original_time else "unknown",
            "time": datetime.now(timezone.utc).isoformat(), "media_omitted": omitted,
            "format": "reading_html", "rendering_version": 3, "has_markdown": False, "has_pdf": False,
            "resources_count": 0, "videos_count": 0}
    document = reading_document(meta, fragment)
    export_root = Path(out_dir).resolve().parent
    with _campusos_directory_lock, article_lock(export_root, url):
        previous = find_existing(export_root, url, account_id)
        if previous:
            register_history(export_root, previous)
            return campusos_reading_result(previous, read_metadata(previous), skipped=True)
        folder = campusos_article_folder(out_dir, title, url)
        target = folder / (folder.name + ".html")
        if target.is_symlink() or target.resolve().parent != folder.resolve():
            raise ValueError("UNSAFE_ARTICLE_FILE")
        if target.exists() and _campusos_article_key(campusos_file_metadata(target).get("url")) != _campusos_article_key(url):
            raise ValueError("ARTICLE_FILE_COLLISION")
        pending = target.with_suffix(".html.tmp")
        if pending.is_symlink():
            raise ValueError("UNSAFE_ARTICLE_FILE")
        pending.write_text(document, encoding="utf-8")
        os.replace(pending, target)
        register_history(export_root, target)
    return campusos_reading_result(target, meta)


def campusos_reading_result(path, meta, skipped=False):
    return {"success": True, "title": meta.get("title") or path.parent.name,
            "source": meta.get("source") or path.parent.parent.name, "author": meta.get("source", ""),
            "path": str(path.parent), "resources": 0, "cover_url": "", "digest": "",
            "publish_time": meta.get("publish_time"), "has_markdown": False, "markdown_path": "",
            "has_pdf": False, "pdf_path": "", "already_exists": skipped}


def campusos_existing_reading(url, out_dir):
    """Skip an existing bridge export before MP Tools requests the source page."""
    try:
        from article_library import article_lock, canonical_url, find_existing, read_metadata, register_history
    except ModuleNotFoundError:
        from backend.campusos_article_library import article_lock, canonical_url, find_existing, read_metadata, register_history
    if not canonical_url(url):
        return None
    export_root = Path(out_dir).resolve().parent
    with article_lock(export_root, url):
        previous = find_existing(export_root, url)
        if previous:
            register_history(export_root, previous)
            return campusos_reading_result(previous, read_metadata(previous), skipped=True)
    return None
