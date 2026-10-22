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
    root = Path(out_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    key = _campusos_article_key(url)
    if not key:
        raise ValueError("ARTICLE_URL_INVALID")
    index = _campusos_directory_index.get(str(root))
    if index is None or (key in index and (not index[key].is_dir() or _campusos_article_key(campusos_article_metadata(index[key]).get("url")) != key)):
        index = {}
        for folder in root.iterdir():
            if folder.is_dir() and not folder.is_symlink():
                existing_key = _campusos_article_key(campusos_article_metadata(folder).get("url"))
                if existing_key:
                    index.setdefault(existing_key, folder)
        _campusos_directory_index[str(root)] = index
    digest = hashlib.sha256(key.encode()).hexdigest()
    for suffix in ("", " ["+digest[:8]+"]", " ["+digest[:16]+"]", " ["+digest[:32]+"]"):
        candidate = root / campusos_folder_name(title, root, suffix)
        if candidate.is_symlink() or candidate.resolve().parent != root:
            raise ValueError("UNSAFE_ARTICLE_DIRECTORY")
        if candidate.exists() and (not candidate.is_dir() or _campusos_article_key(campusos_article_metadata(candidate).get("url")) != key):
            continue
        previous = index.get(key)
        if previous and previous != candidate and not candidate.exists():
            if previous.is_symlink() or previous.resolve().parent != root or _campusos_article_key(campusos_article_metadata(previous).get("url")) != key:
                raise ValueError("UNSAFE_ARTICLE_DIRECTORY")
            previous.rename(candidate)
        candidate.mkdir(exist_ok=True)
        index[key] = candidate
        return candidate
    raise ValueError("ARTICLE_DIRECTORY_COLLISION")


def campusos_save_reading(raw_html, url, out_dir, title, content_html, publish_time, review_id):
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
    # One atomic HTML carries both the reading body and its non-executable metadata.
    csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; media-src https:; font-src data:; frame-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"
    document = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + escape(csp, quote=True) + '"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="campusos-article" content="' + escape(json.dumps(meta, ensure_ascii=False, separators=(',', ':')), quote=True) + '"><title>' + escape(title) + '</title><style>body{margin:0 auto;padding:20px;max-width:677px;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}table{max-width:100%}</style></head><body>' + fragment + '</body></html>'
    with _campusos_directory_lock:
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
        # Remove only another HTML export of this exact article after success.
        # Old media, raw pages and unrelated files are left intact.
        for previous in folder.glob("*.html"):
            if previous != target and not previous.is_symlink() and previous.resolve().parent == folder.resolve():
                if _campusos_article_key(campusos_file_metadata(previous).get("url")) == _campusos_article_key(url):
                    previous.unlink()
    return {"success": True, "title": title, "author": name, "path": str(folder),
            "resources": 0, "cover_url": "", "digest": "", "publish_time": publish_time,
            "has_markdown": False, "markdown_path": "", "has_pdf": False, "pdf_path": ""}
