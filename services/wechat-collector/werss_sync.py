"""Import completed WeRSS articles into the owner's shared MP Tools library.

Only reads the local WeRSS API. It never refreshes, deletes or fetches upstream
articles. Missing bodies stay pending until WeRSS has actually obtained them.
"""
from datetime import datetime, timezone, timedelta
import base64
import json
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, ProxyHandler, build_opener

from article_library import (canonical_url, read_metadata, reading_files,
                             register_history, write_imported_article)

CST = timezone(timedelta(hours=8))


class WeRSS:
    def __init__(self, settings):
        self.base = settings.get("origin", "http://localhost:8001").rstrip("/")
        origin = urlsplit(self.base)
        if (origin.scheme not in {"http", "https"} or origin.hostname not in {"localhost", "127.0.0.1", "::1"}
                or origin.path or origin.query or origin.fragment or origin.username or origin.password):
            raise ValueError("WERSS_LOCAL_ORIGIN_REQUIRED")
        secret = Path(settings["credentialsFile"]).read_text(encoding="utf-8-sig")
        access = re.search(r"(?im)^\s*Access\s*Key\s*[:：=]\s*(\S+)\s*$", secret)
        private = re.search(r"(?im)^\s*Secret\s*Key\s*[:：=]\s*(\S+)\s*$", secret)
        if not access or not private:
            raise ValueError("WERSS_CREDENTIAL_FORMAT")
        self.authorization = "AK-SK " + access[1] + ":" + private[1]
        # Localhost reads must not be routed through the desktop's capture proxy.
        self.opener = build_opener(ProxyHandler({}))

    def call(self, path):
        request = Request(self.base + "/api/v1/wx/" + path,
                          headers={"Authorization": self.authorization, "Accept": "application/json",
                                   "User-Agent": "CampusOS-WeRSSBridge/1.0"})
        try:
            with self.opener.open(request, timeout=30) as response:
                encoded = response.read(4_000_001)
                if len(encoded) > 4_000_000:
                    raise RuntimeError("WERSS_RESPONSE_TOO_LARGE")
                body = json.loads(encoded)
        except HTTPError as exc:
            raise RuntimeError("WERSS_HTTP_" + str(exc.code)) from None
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("WERSS_UNAVAILABLE") from None
        except (ValueError, UnicodeError):
            raise RuntimeError("WERSS_RESPONSE_INVALID") from None
        if not isinstance(body, dict) or body.get("code") != 0:
            raise RuntimeError("WERSS_API_FAILED")
        return body.get("data")

    def articles(self):
        offset = 0
        visited = set()
        while True:
            data = self.call("articles?" + urlencode({"limit": 100, "offset": offset, "status": "active"}))
            rows = data.get("list", [])
            if not isinstance(rows, list):
                raise RuntimeError("WERSS_RESPONSE_INVALID")
            for row in rows:
                identity = row.get("id")
                if identity and identity not in visited:
                    visited.add(identity)
                    yield row
            offset += len(rows)
            if not rows or offset >= int(data.get("total", offset)):
                return

    def detail(self, article_id):
        return self.call("articles/" + quote(str(article_id), safe=""))


def subscriptions(export_root):
    rows = json.loads((Path(export_root).parent / "rss_subscriptions.json").read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise ValueError("MP_TOOLS_SUBSCRIPTIONS_INVALID")
    result = {}
    for row in rows:
        identity = row.get("fakeid") or row.get("account_id")
        if not re.fullmatch(r"MP_WXS_\d+", identity or ""):
            # MP Tools stores the public __biz value as fakeid; WeRSS uses
            # MP_WXS_<decoded numeric biz> for the exact same publisher.
            try:
                decoded = base64.b64decode(identity or "", validate=True).decode("ascii")
                identity = "MP_WXS_" + decoded if decoded.isdigit() else None
            except (ValueError, UnicodeError):
                identity = None
        name = row.get("nickname") or row.get("name")
        if re.fullmatch(r"MP_WXS_\d+", identity or "") and name:
            if identity in result and result[identity] != name:
                raise ValueError("MP_TOOLS_ACCOUNT_CONFLICT")
            result[identity] = name
    return result


def observation(row):
    """WeRSS's saved created_at is in its configured Asia/Shanghai container TZ.

    Preserve that actual stored observation rather than stamping an old body as
    a fresh upstream fetch when the bridge is first started or restarted.
    """
    raw = row.get("created_at")
    if not isinstance(raw, str):
        raise ValueError("WERSS_OBSERVATION_MISSING")
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=CST)
    value = value.astimezone(timezone.utc)
    if value.year < 2000 or value > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError("WERSS_OBSERVATION_INVALID")
    return value.isoformat()


def body_html(row):
    # The normalized content_html has passed through Markdown and loses WeChat
    # layout. Prefer the stored original article body for its styles/backgrounds.
    body = row.get("content") or row.get("content_html") or ""
    if not isinstance(body, str) or not body.strip() or body.strip() == "DELETED":
        raise ValueError("WERSS_BODY_PENDING")
    if any(marker in body for marker in ("当前环境异常，完成验证后即可继续访问", "你暂无权限查看此页面内容", "未知错误，请稍后再试")):
        raise ValueError("WERSS_BODY_UNAVAILABLE")
    return body


def sync_once(config, client=None):
    settings = config.get("werss", {})
    stats = {"seen": 0, "created": 0, "existing": 0, "pendingBody": 0, "deferred": 0,
             "outOfScope": 0, "failed": 0, "errors": {}}
    if not settings.get("enabled"):
        return stats
    root = Path(settings.get("exportDirectory") or config["exportDirectories"][0]).resolve()
    if not root.is_dir() or root.is_symlink():
        raise ValueError("EXPORT_UNAVAILABLE")
    accounts = subscriptions(root)
    client = client or WeRSS(settings)
    # One bounded library inventory per pass; every actual write rechecks under
    # the same cross-process article lock used by MP Tools.
    known = {}
    for path in reading_files(root):
        key = canonical_url(read_metadata(path).get("url"))
        if key:
            known[key] = path
    limit = max(1, min(100, int(settings.get("maxNewArticlesPerCycle", 20))))
    since = settings.get("sinceDay", "2000-01-01")
    for row in client.articles():
        stats["seen"] += 1
        try:
            account = row.get("mp_id")
            if account not in accounts or row.get("status", 1) != 1:
                stats["outOfScope"] += 1
                continue
            published = row.get("publish_time")
            if not isinstance(published, (int, float)) or isinstance(published, bool):
                raise ValueError("ORIGINAL_DATE_MISSING")
            if datetime.fromtimestamp(published, CST).date().isoformat() < since:
                continue
            key = canonical_url(row.get("url"))
            if not key:
                raise ValueError("ARTICLE_URL_INVALID")
            if key in known:
                # Re-register a completed HTML if a previous process stopped
                # between its atomic write and the MP Tools history update.
                register_history(root, known[key])
                stats["existing"] += 1
                continue
            if not row.get("has_content"):
                stats["pendingBody"] += 1
                continue
            if stats["created"] >= limit:
                stats["deferred"] += 1
                continue
            article = client.detail(row["id"])
            if (article.get("mp_id") != account or canonical_url(article.get("url")) != key
                    or article.get("status", 1) != 1):
                raise ValueError("WERSS_ARTICLE_IDENTITY_CHANGED")
            result = write_imported_article(root, account_id=account, source_name=accounts[account],
                                            title=article.get("title") or row.get("title"), url=key,
                                            published_at=article.get("publish_time"), content_html=body_html(article),
                                            observed_at=observation(article))
            known[key] = Path(result["path"])
            stats["created"] += int(result["created"])
            stats["existing"] += int(result["skipped"])
        except (ValueError, OSError, RuntimeError, TypeError, KeyError) as exc:
            code = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "WERSS_IMPORT_FAILED"
            if code == "WERSS_BODY_PENDING":
                stats["pendingBody"] += 1
            else:
                stats["failed"] += 1
                stats["errors"][code] = stats["errors"].get(code, 0) + 1
            if code.startswith("WERSS_HTTP_") or code == "WERSS_UNAVAILABLE":
                raise
    return stats
