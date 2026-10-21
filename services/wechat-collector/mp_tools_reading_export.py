"""HTML-only output adapter embedded in the owner's existing MP Tools package."""
import hashlib
import json
from pathlib import Path
import re
import os
from datetime import datetime, timezone
from html import unescape

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
            "format": "reading_html", "rendering_version": 2, "has_markdown": False, "has_pdf": False,
            "resources_count": 0, "videos_count": 0}
    # Metadata is the commit marker. A watcher never sees metadata for a partial body.
    document = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fragment + '</body></html>'
    for filename, content in (("reading.html", document), ("metadata.json", json.dumps(meta, ensure_ascii=False, indent=2))):
        pending = folder / (filename + ".tmp")
        pending.write_text(content, encoding="utf-8")
        os.replace(pending, folder / filename)
    return {"success": True, "title": title, "author": name, "path": str(folder),
            "resources": 0, "cover_url": "", "digest": "", "publish_time": publish_time,
            "has_markdown": False, "markdown_path": "", "has_pdf": False, "pdf_path": ""}
