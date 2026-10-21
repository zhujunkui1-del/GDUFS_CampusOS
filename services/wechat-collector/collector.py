"""CampusOS local collector bridge. Credentials and state stay beside MP Tools data.

Consumes completed MP Tools exports, never treats an incomplete scan as deletion.
The cloud API is the sole authority for publication, deduplication and removal.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from datetime import datetime, timezone, timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit, parse_qs, urlencode
from urllib.request import Request, urlopen
import uuid

from reading_html import reading_fragment

CST = timezone(timedelta(hours=8))


def iso(value):
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
        number = float(value)
        if number > 100000000000:
            number /= 1000
        d = datetime.fromtimestamp(number, timezone.utc)
    elif isinstance(value, str):
        import re
        if not re.search(r"[T ]\d{2}:\d{2}:\d{2}", value):
            raise ValueError("ORIGINAL_DATE_PRECISION_MISSING")
        d = datetime.fromisoformat(value.strip().replace("Z", "+00:00").replace("/", "-"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=CST)
    else:
        raise ValueError("ORIGINAL_DATE_MISSING")
    if d.year < 2000 or d > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError("ORIGINAL_DATE_INVALID")
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(raw):
    import re
    u = urlsplit(raw)
    if u.scheme != "https" or u.hostname != "mp.weixin.qq.com" or u.username or u.password or u.port:
        raise ValueError("ARTICLE_URL_INVALID")
    if re.fullmatch(r"/s/[\w~\-]{15,100}", u.path):
        return urlunsplit(("https", "mp.weixin.qq.com", u.path.replace("~", "_"), "", ""))
    query = parse_qs(u.query)
    if u.path == "/s" and all(query.get(k) for k in ("__biz", "mid", "idx", "sn")):
        return "https://mp.weixin.qq.com/s?" + urlencode({k: query[k][0] for k in ("__biz", "mid", "idx", "sn")})
    raise ValueError("ARTICLE_URL_INVALID")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


class Cloud:
    def __init__(self, config):
        self.base = config["campusosOrigin"].rstrip("/")
        u = urlsplit(self.base)
        if u.path or u.query or u.fragment or (u.scheme != "https" and not (u.scheme == "http" and u.hostname in {"127.0.0.1", "localhost"})):
            raise ValueError("CAMPUSOS_ORIGIN_INVALID")
        self.token = config["token"]

    def call(self, path, value=None):
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/json", "User-Agent": "CampusOS-WeChatCollector/1.0"}
        data = None
        if value is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        req = Request(self.base + "/api/collector/" + path, data=data, headers=headers)
        try:
            with urlopen(req, timeout=40) as response:
                body = json.loads(response.read(2000000))
        except HTTPError as exc:
            code = "HTTP_" + str(exc.code)
            try:
                code = json.loads(exc.read(10000)).get("error", {}).get("code", code)
            except (ValueError, TypeError):
                pass
            raise RuntimeError(code) from None
        except (URLError, TimeoutError):
            raise RuntimeError("CLOUD_UNAVAILABLE") from None
        if not body.get("ok"):
            raise RuntimeError(body.get("error", {}).get("code", "SYNC_FAILED"))
        return body["data"]


def database(path):
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,request_id TEXT NOT NULL,status TEXT NOT NULL,document_id TEXT,last_error TEXT,updated_at TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS observations(fingerprint TEXT PRIMARY KEY,request_id TEXT NOT NULL,status TEXT NOT NULL)")
    db.commit()
    return db


def native_removal_observations(config, sources):
    """Only explicit deletion messages from MP Tools' completed direct-page checks."""
    history_path = Path(config["dataDirectory"]).parent / "download_history.json"
    if not history_path.is_file():
        return []
    try:
        history = read_json(history_path)
    except (ValueError, OSError):
        return []
    items = []
    for row in history if isinstance(history, list) else []:
        if row.get("success") is not False or row.get("error") not in {"文章已被作者删除", "内容已被作者删除"}:
            continue
        matching = [s for s in sources if s["name"] == row.get("account")]
        if len(matching) != 1:
            continue
        try:
            items.append({"sourceId": matching[0]["sourceId"], "url": canonical(row.get("link", "")), "observedAt": iso(row.get("time")), "outcome": "platform_deleted"})
        except (ValueError, TypeError):
            continue
    return items


def export_payload(path, sources):
    meta = read_json(path)
    data_file = path.parent / "data.json"
    if data_file.exists() and data_file.resolve().parent != path.parent.resolve():
        raise ValueError("UNSAFE_EXPORT_PATH")
    data = read_json(data_file) if data_file.is_file() else {}
    account_id = meta.get("account_id") or data.get("account_id")
    name = meta.get("source") or data.get("source") or path.parent.parent.name
    matches = [s for s in sources if (s["accountId"] == account_id if account_id else s["name"] == name)]
    if len(matches) != 1:
        raise ValueError("SOURCE_NOT_IN_SCOPE")
    source = matches[0]
    # A saved/download timestamp is never substituted for an original publication time.
    published = iso(meta.get("publish_time") or data.get("publish_time"))
    if meta.get("publish_time_inferred") or meta.get("publish_time_source") in {"download_time", "fallback"}:
        raise ValueError("ORIGINAL_DATE_INFERRED")
    if not meta.get("publish_time_source") and abs(datetime.fromisoformat(published.replace("Z", "+00:00")).timestamp() - datetime.fromisoformat(iso(meta.get("time")).replace("Z", "+00:00")).timestamp()) < 120:
        raise ValueError("ORIGINAL_DATE_UNCONFIRMED")
    if datetime.fromisoformat(published.replace("Z", "+00:00")).astimezone(CST).date().isoformat() < source["sinceDay"]:
        raise ValueError("BEFORE_RANGE")
    reading = path.parent / "reading.html"
    if reading.exists() and reading.resolve().parent != path.parent.resolve():
        raise ValueError("UNSAFE_EXPORT_PATH")
    original_html = next(iter(path.parent.glob("*_raw.html")), None)
    if original_html and original_html.resolve().parent != path.parent.resolve():
        raise ValueError("UNSAFE_EXPORT_PATH")
    content = original_html.read_text(encoding="utf-8-sig") if original_html else data.get("content") or (reading.read_text(encoding="utf-8-sig") if reading.is_file() else None)
    if not content:
        raise ValueError("READING_BODY_MISSING")
    fragment, media_omitted = reading_fragment(content)
    title = str(data.get("title") or meta.get("title") or "").strip()
    if not title:
        raise ValueError("TITLE_MISSING")
    # The export's saved time is the observation time. Reopening an old file does not
    # make it a fresh observation and cannot undo a confirmed newer removal.
    seen = iso(meta.get("time") or meta.get("observed_at"))
    source_updated = meta.get("source_updated_at")
    return {"sourceId": source["sourceId"], "accountId": source["accountId"], "title": title,
            "url": canonical(data.get("url") or meta.get("url") or ""), "publishedAt": published,
            "sourceUpdatedAt": iso(source_updated) if source_updated else None, "observedAt": seen,
            "readingHtml": fragment, "renderingVersion": 2, "mediaOmitted": bool(media_omitted),
            "provenance": "local_export"}


def sync_once(config, db, cloud):
    sources = cloud.call("sources")["sources"]
    source_ids = {s["sourceId"] for s in sources}
    stats = {"sources": len(sources), "published": 0, "unchanged": 0, "skipped": 0, "failed": 0, "removals": 0, "errors": {}}
    for root_name in config["exportDirectories"]:
        root = Path(root_name).resolve()
        if not root.is_dir():
            stats["errors"]["EXPORT_UNAVAILABLE"] = stats["errors"].get("EXPORT_UNAVAILABLE", 0) + 1
            continue
        for path in root.glob("*/*/metadata.json"):
            if root not in path.resolve().parents:
                continue
            try:
                payload = export_payload(path, sources)
            except (ValueError, OSError, TypeError) as exc:
                stats["skipped"] += 1
                code = str(exc) if isinstance(exc, ValueError) else "EXPORT_INCOMPLETE"
                stats["errors"][code] = stats["errors"].get(code, 0) + 1
                continue
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            fingerprint = hashlib.sha256(encoded.encode()).hexdigest()
            row = db.execute("SELECT fingerprint,request_id,status FROM files WHERE path=?", (str(path),)).fetchone()
            if row and row[0] == fingerprint and row[2] == "acknowledged":
                stats["unchanged"] += 1
                continue
            request_id = row[1] if row and row[0] == fingerprint else str(uuid.uuid4())
            stamp = datetime.now(timezone.utc).isoformat()
            db.execute("INSERT INTO files(path,fingerprint,request_id,status,updated_at) VALUES(?,?,?,'pending',?) ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint,request_id=excluded.request_id,status='pending',updated_at=excluded.updated_at", (str(path), fingerprint, request_id, stamp))
            db.commit()
            payload["requestId"] = request_id
            try:
                result = cloud.call("articles", payload)
                db.execute("UPDATE files SET status='acknowledged',document_id=?,last_error=NULL WHERE path=? AND fingerprint=?", (result["documentId"], str(path), fingerprint))
                if result["state"] == "stale":
                    db.commit()
                    stats["unchanged"] += 1
                    continue
                if not (path.parent / "reading.html").is_file():
                    # Legacy multi-format exports get one reading conversion. The new
                    # HTML-only native exporter already has it and is never duplicated.
                    output = Path(config["dataDirectory"]) / "reading" / payload["accountId"] / result["documentId"]
                    atomic(output / "reading.html", payload["readingHtml"])
                    metadata = {k: v for k, v in payload.items() if k not in {"readingHtml", "requestId"}}
                    metadata.update({"documentId": result["documentId"], "htmlBytes": result["htmlBytes"]})
                    atomic(output / "metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))
                stats["published"] += int(bool(result["changed"]))
                stats["unchanged"] += int(not result["changed"])
            except RuntimeError as exc:
                db.execute("UPDATE files SET status='failed',last_error=? WHERE path=?", (str(exc), str(path)))
                stats["failed"] += 1
                stats["errors"][str(exc)] = stats["errors"].get(str(exc), 0) + 1
                if str(exc) in {"UNAUTHORIZED", "FORBIDDEN", "RATE_LIMITED"}:
                    db.commit()
                    raise
            db.commit()
    # An upstream adapter may append explicit direct-page observations here.
    # Directory absence and article-list omissions are deliberately never emitted.
    observations = Path(config["dataDirectory"]) / "upstream-observations.jsonl"
    observation_lines = [json.dumps(item) for item in native_removal_observations(config, sources)]
    if observations.is_file():
        observation_lines.extend(observations.read_text(encoding="utf-8-sig").splitlines())
    if observation_lines:
        for line in observation_lines:
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                if item.get("sourceId") not in source_ids:
                    continue
                item["url"] = canonical(item["url"])
                item["observedAt"] = iso(item["observedAt"])
                # Do not replay stale deletion claims after a long offline period.
                if datetime.now(timezone.utc) - datetime.fromisoformat(item["observedAt"].replace("Z", "+00:00")) > timedelta(hours=1):
                    continue
                digest = hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()
                row = db.execute("SELECT request_id,status FROM observations WHERE fingerprint=?", (digest,)).fetchone()
                if row and row[1] == "acknowledged":
                    continue
                request_id = row[0] if row else str(uuid.uuid4())
                db.execute("INSERT OR IGNORE INTO observations VALUES(?,?,'pending')", (digest, request_id))
                db.commit()
                result = cloud.call("observations", {**item, "requestId": request_id})
                db.execute("UPDATE observations SET status='acknowledged' WHERE fingerprint=?", (digest,))
                db.commit()
                if result["state"] == "removed":
                    output = Path(config["dataDirectory"]) / "reading" / next(s["accountId"] for s in sources if s["sourceId"] == item["sourceId"]) / result["documentId"] / "reading.html"
                    output.unlink(missing_ok=True)
                stats["removals"] += int(bool(result["changed"]))
            except (ValueError, KeyError, RuntimeError):
                stats["failed"] += 1
    cloud.call("heartbeat", {"mode": "local_exports", "status": "error" if stats["failed"] else "idle", "imported": stats["published"], "errorCode": "SYNC_FAILED" if stats["failed"] else "EXPORT_UNAVAILABLE" if "EXPORT_UNAVAILABLE" in stats["errors"] else None})
    atomic(Path(config["dataDirectory"]) / "last-sync.json", json.dumps({"at": datetime.now(timezone.utc).isoformat(), **stats}, ensure_ascii=False, indent=2))
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--watch", action="store_true", help="watch completed local exports; polls every 60 seconds")
    args = parser.parse_args()
    config = read_json(args.config)
    data_dir = Path(config["dataDirectory"])
    data_dir.mkdir(parents=True, exist_ok=True)
    db = database(data_dir / "state.sqlite3")
    cloud = Cloud(config)
    # One local worker owns the outbox, including across repeated launches.
    lock = (data_dir / "collector.lock").open("a+b")
    if lock.tell() == 0:
        lock.write(b"0")
        lock.flush()
    lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(json.dumps({"error": "COLLECTOR_ALREADY_RUNNING"}))
        db.close()
        lock.close()
        return 1
    try:
        last_output = None
        while True:
            try:
                result = sync_once(config, db, cloud)
                output = json.dumps(result, ensure_ascii=False)
                if output != last_output:
                    print(output, flush=True)
                    last_output = output
            except (RuntimeError, OSError, ValueError) as exc:
                # Log codes only. Never credentials, raw HTML, headers or private paths.
                code = str(exc) if isinstance(exc, RuntimeError) else "SYNC_FAILED"
                print(json.dumps({"error": code}), flush=True)
                if not args.watch or code in {"UNAUTHORIZED", "FORBIDDEN"}:
                    return 1
            if not args.watch:
                return 0
            time.sleep(60)
    finally:
        db.close()
        lock.close()


if __name__ == "__main__":
    sys.exit(main())
