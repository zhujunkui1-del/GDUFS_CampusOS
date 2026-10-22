"""Restore real, previously exported reading HTML without upstream requests.

Only missing files are created, atomically and without overwriting existing
articles. Original publication and observation times are retained.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import uuid

HOME = Path(r"D:\WeChat MP Tools")
DATA = HOME / "data"
ACCOUNT = "MP_WXS_3083007618"


def main():
    root = (DATA / "articles_full/广外就业").resolve()
    if root.parent != (DATA / "articles_full").resolve():
        raise RuntimeError("Unexpected account directory")
    root.mkdir(exist_ok=True)
    spec = importlib.util.spec_from_file_location("restore_title_folders", Path(__file__).with_name("mp_tools_reading_export.py"))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    since = int(datetime(2026, 10, 1, tzinfo=timezone(timedelta(hours=8))).timestamp())
    report = {"origin": "existing_local_export", "networkRequests": 0, "restored": [], "skipped": []}
    for manifest in sorted((DATA / "CampusOS_collector/reading" / ACCOUNT).glob("*/metadata.json")):
        metadata = json.loads(manifest.read_text(encoding="utf-8"))
        if metadata.get("accountId") != ACCOUNT:
            raise RuntimeError("Saved export source identity mismatch")
        published = int(datetime.fromisoformat(metadata["publishedAt"].replace("Z", "+00:00")).timestamp())
        if published < since:
            continue
        source = manifest.with_name("reading.html")
        if not source.is_file():
            continue
        fragment = source.read_text(encoding="utf-8-sig")
        meta = {"title": metadata["title"], "url": metadata["url"], "source": "广外就业", "account_id": ACCOUNT,
                "publish_time": published, "publish_time_source": "original_saved_metadata", "time": metadata["observedAt"],
                "format": "reading_html", "rendering_version": metadata.get("renderingVersion", 2),
                "media_omitted": False, "has_markdown": False, "has_pdf": False, "download_origin": "existing_local_export"}
        tag = '<meta name="campusos-article" content="' + html.escape(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), quote=True) + '">'
        if 'name="campusos-article"' in fragment:
            raise RuntimeError("Saved cache already has embedded article metadata")
        if re.search(r"<head\b[^>]*>", fragment, re.I):
            document = re.sub(r"(<head\b[^>]*>)", lambda m: m.group(1) + tag, fragment, count=1, flags=re.I)
        else:
            csp = "default-src 'none'; script-src 'none'; img-src https: data:; style-src 'unsafe-inline'; media-src https:; font-src https: data:; base-uri 'none'; form-action 'none'"
            document = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
                        '<meta name="viewport" content="width=device-width,initial-scale=1">'
                        '<meta http-equiv="Content-Security-Policy" content="' + html.escape(csp, quote=True) + '">'
                        + tag + '<title>' + html.escape(metadata["title"]) + '</title></head><body>' + fragment + '</body></html>')
        if re.search(r'''(?:src\s*=\s*["']|url\(\s*["']?)(?:media/|file:)''', document, re.I):
            raise RuntimeError("Saved export contains unresolved local media references")
        directory = helper.campusos_article_folder(root, metadata["title"], metadata["url"]).resolve()
        if directory.parent != root:
            raise RuntimeError("Target outside intended account directory")
        target = directory / "reading.html"
        if target.exists():
            report["skipped"].append({"title": metadata["title"], "reason": "already_exists"})
            continue
        if "--apply" not in sys.argv:
            report["skipped"].append({"title": metadata["title"], "reason": "preview", "target": str(target)})
            continue
        directory.mkdir(exist_ok=True)
        pending = directory / (".restore-" + uuid.uuid4().hex + ".pending")
        try:
            with pending.open("xb") as f:
                f.write(document.encode("utf-8"))
            os.link(pending, target)
        except FileExistsError:
            report["skipped"].append({"title": metadata["title"], "reason": "created_concurrently"})
        else:
            report["restored"].append({"title": metadata["title"], "url": metadata["url"], "path": str(target),
                                       "publishTime": published, "originalObservedAt": metadata["observedAt"],
                                       "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                                       "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        finally:
            if pending.exists():
                pending.unlink()
    destination = DATA / "patches/history-directory-2026-10-22/local-reading-recovery.json"
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"restoredCount": len(report["restored"]), "skippedCount": len(report["skipped"]),
                      "networkRequests": 0, "report": str(destination)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
