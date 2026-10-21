"""HTML-only output adapter embedded in the owner's existing MP Tools package."""
import hashlib
import json
from pathlib import Path
import re
import os
from datetime import datetime, timezone
from html import unescape, escape

# The installer embeds reading_html.py above this module, without another runtime dependency.


def campusos_save_reading(raw_html, url, out_dir, title, content_html, publish_time, review_id):
    # Never use MP Tools' download-time fallback as an original publication time.
    original_time = re.search(r"\b(?:ct|publish_time)\s*=\s*[\"']?(\d{10})", raw_html)
    if not original_time:
        return {"success": False, "title": title, "error": "未取得原文发布时间，未保存为可发布文章", "is_permanent": False}
    publish_time = int(original_time.group(1))
    fragment, omitted = reading_fragment(content_html)
    name = ""
    for pattern in (r"\bnickname\s*=\s*[\"']([^\"']+)[\"']", r'class="profile_nickname"[^>]*>([^<]+)<', r'id="js_name"[^>]*>([^<]+)<'):
        match = re.search(pattern, raw_html)
        if match:
            name = unescape(match.group(1)).strip()
            break
    account = re.match(r"^(MP_WXS_\d+)(?:_|$)", review_id or "")
    account_id = account.group(1) if account else None
    folder = Path(out_dir) / ("campusos-" + hashlib.sha256(url.encode()).hexdigest()[:32])
    folder.mkdir(parents=True, exist_ok=True)
    meta = {"title": title, "url": url, "source": name, "account_id": account_id,
            "publish_time": publish_time, "publish_time_source": "original_page",
            "time": datetime.now(timezone.utc).isoformat(), "media_omitted": omitted,
            "format": "reading_html", "rendering_version": 3, "has_markdown": False, "has_pdf": False,
            "resources_count": 0, "videos_count": 0}
    # One atomic HTML carries both the reading body and its non-executable metadata.
    document = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="campusos-article" content="' + escape(json.dumps(meta, ensure_ascii=False, separators=(',', ':')), quote=True) + '"><title>' + escape(title) + '</title><style>body{margin:0 auto;padding:20px;max-width:677px;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}table{max-width:100%}</style></head><body>' + fragment + '</body></html>'
    pending = folder / "reading.html.tmp"
    pending.write_text(document, encoding="utf-8")
    os.replace(pending, folder / "reading.html")
    return {"success": True, "title": title, "author": name, "path": str(folder),
            "resources": 0, "cover_url": "", "digest": "", "publish_time": publish_time,
            "has_markdown": False, "markdown_path": "", "has_pdf": False, "pdf_path": ""}
