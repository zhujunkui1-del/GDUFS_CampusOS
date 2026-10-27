"""Discover publisher identities from the owner's current completed local library."""
import base64
import hashlib
import json
from pathlib import Path
import re


def account_identity(value):
    if not isinstance(value, str):
        return None
    if re.fullmatch(r"MP_WXS_\d{3,20}", value):
        return value
    try:
        number = base64.b64decode(value, validate=True).decode("ascii")
        return "MP_WXS_" + number if re.fullmatch(r"\d{3,20}", number) else None
    except (ValueError, UnicodeError):
        return None


def account_manifest(export_directories):
    from article_library import read_metadata
    found = {}
    for root_name in export_directories:
        root = Path(root_name)
        if not root.is_dir() or root.is_symlink():
            continue
        saved = []
        for name in ("accounts.json", "rss_subscriptions.json"):
            file = root.parent / name
            if file.is_file():
                rows = json.loads(file.read_text(encoding="utf-8-sig"))
                if isinstance(rows, list):
                    saved.extend(rows)
        for folder in sorted(root.iterdir()):
            if not folder.is_dir() or folder.is_symlink() or folder.name.startswith("."):
                continue
            candidates = {account_identity(row.get("fakeid") or row.get("account_id")) for row in saved
                          if (row.get("nickname") or row.get("name")) == folder.name}
            candidates.discard(None)
            if not candidates:
                for i, file in enumerate(folder.glob("*/*.html")):
                    if i >= 5:
                        break
                    meta = read_metadata(file)
                    identity = account_identity(meta.get("account_id"))
                    if identity:
                        candidates.add(identity)
            if len(candidates) != 1:
                continue
            identity = candidates.pop()
            item = {"accountId": identity, "biz": base64.b64encode(identity[7:].encode("ascii")).decode("ascii"), "name": folder.name}
            # A renamed account is one publisher, not two public sources.
            found.setdefault(identity, item)
    return sorted(found.values(), key=lambda item: item["accountId"])


def sync_accounts(config, db, cloud):
    accounts = account_manifest(config["exportDirectories"])
    if not accounts:
        return None
    db.execute("CREATE TABLE IF NOT EXISTS collector_registry_cache(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    fingerprint = hashlib.sha256(json.dumps(accounts, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    prior = db.execute("SELECT value FROM collector_registry_cache WHERE key='manifest'").fetchone()
    if prior and prior[0] == fingerprint:
        return None
    result = {"accounts": []}
    for offset in range(0, len(accounts), 64):
        result["accounts"].extend(cloud.call("accounts", {"accounts": accounts[offset:offset + 64]})["accounts"])
    if all(a["state"] in {"created", "matched", "paused", "archived"} for a in result["accounts"]):
        db.execute("INSERT INTO collector_registry_cache(key,value) VALUES('manifest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (fingerprint,))
        db.commit()
    return result
