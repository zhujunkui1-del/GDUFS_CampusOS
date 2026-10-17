"""Offline WeRSS/helper research probes, not a CampusOS production adapter.

Reads pinned local source files using AST; does not import either application.
Synthetic API, publisher and article fixtures are never persisted to D1.
Network, browser/CDP, child processes, SMTP and listeners are denied.
"""

from __future__ import annotations

import argparse
import ast
import base64
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / "CampusOS_Codex_完整设计文档_v2"
W = LOCAL / "we-mp-rss-main/we-mp-rss-main"
T = LOCAL / "thu-push-main/thu-push-main"
PINS = {
    "rachelos/we-mp-rss": "9b40351fd1913e7f74cf88f65740cd67a28baf81",
    "thu-lawyer/thu-push": "19abc55134cf5691e575fbcc74cb88d3801c2b28",
}


def selected_functions(path: Path, names: set[str], namespace: dict):
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    definitions = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names
    ]
    if {node.name for node in definitions} != names:
        raise ValueError("Pinned source definitions missing")
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


def short_article_url(value: str) -> str:
    """Proposed exchange-format check; never fetches the target."""
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.netloc != "mp.weixin.qq.com":
        raise ValueError("unapproved_url")
    query = parse_qs(parsed.query)
    if any(key in query for key in ("uin", "key", "pass_ticket", "appmsg_token")):
        raise ValueError("credential_query_rejected")
    if not re.fullmatch(r"/s/[A-Za-z0-9_-]{1,200}", parsed.path):
        raise ValueError("unsupported_url_form")
    return "https://mp.weixin.qq.com" + parsed.path


def readonly_route(method: str, path: str) -> bool:
    """Allowlist proposal: HTTP GET alone does not prove absence of side effects."""
    if method != "GET":
        return False
    return path in ("/api/v1/wx/mps", "/api/v1/wx/articles") or bool(
        re.fullmatch(r"/api/v1/wx/articles/[A-Za-z0-9_-]{1,255}", path)
    )


class Blocked(Exception):
    pass


class ExchangeProbe:
    """In-memory format/idempotency sketch; not the existing ingestion DAO."""

    def __init__(self):
        self.rows: dict[tuple[str, str], tuple[str, int]] = {}
        self.state = "ready"
        self.consumed = 0

    def consume(self, http_status: int, payload: dict, approved: dict[str, str]):
        if self.state == "paused":
            raise Blocked("already_paused")
        if http_status in (401, 403, 429):
            self.state = "paused"
            raise Blocked("authorization_or_platform_restriction")
        if http_status != 200 or type(payload) is not dict:
            raise ValueError("transport_or_format_error")
        if type(payload.get("code")) is not int or payload["code"] != 0:
            self.state = "paused"
            raise Blocked("upstream_error_is_not_empty")
        data = payload.get("data")
        if type(data) is not dict or type(data.get("list")) is not list:
            raise ValueError("invalid_list_shape")
        if len(data["list"]) > 100:
            raise ValueError("page_too_large")
        result = {"new": 0, "changed": 0, "duplicate": 0}
        for article in data["list"]:
            if article.get("mp_id") not in approved:
                raise ValueError("source_not_approved")
            source = approved[article["mp_id"]]
            url = short_article_url(article["url"])
            title = article.get("title")
            if not isinstance(title, str) or not title.strip() or len(title) > 1000:
                raise ValueError("invalid_title")
            epoch = article.get("publish_time")
            published = epoch if type(epoch) is int and epoch > 0 else None
            fingerprint = hashlib.sha256(
                json.dumps([source, url, title, published], ensure_ascii=False).encode()
            ).hexdigest()
            key = (source, url)
            old = self.rows.get(key)
            if old and old[0] == fingerprint:
                result["duplicate"] += 1
            else:
                self.rows[key] = (fingerprint, (old[1] if old else 0) + 1)
                result["changed" if old else "new"] += 1
            self.consumed += 1
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    denied: list[str] = []

    def guard(event, _args):
        if event in {
            "socket.connect", "socket.connect_ex", "socket.bind", "socket.getaddrinfo",
            "subprocess.Popen", "os.system", "smtplib.connect", "smtplib.send",
        }:
            denied.append(event)
            raise RuntimeError("offline research policy")

    sys.addaudithook(guard)
    from bs4 import BeautifulSoup

    files = [
        W / "core/wx/model/weread_mp.py", W / "core/article_content.py",
        T / "weread-push/import/mp_searchbiz.py",
    ]
    before = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    upstream = selected_functions(
        files[0], {"WereadMPAPIError", "extract_mp_content", "_raise_response_error"},
        {"BeautifulSoup": BeautifulSoup},
    )
    helper = selected_functions(files[2], {"norm"}, {})
    checks = []

    def check(name, origin, function):
        started = time.perf_counter()
        try:
            ok = bool(function())
            error = None if ok else "expectation_not_met"
        except Exception as exc:
            ok, error = False, type(exc).__name__
        checks.append({"name": name, "origin": origin, "passed": ok,
                       "elapsedMs": round((time.perf_counter() - started) * 1000, 3), "error": error})

    def raises(error, call):
        try:
            call()
        except error:
            return True
        return False

    check("traditional js_content extraction removes scripts", "pinned upstream function",
          lambda: upstream["extract_mp_content"]('<div id="js_content"><p>Synthetic</p><script>x()</script></div>') == "<p>Synthetic</p>")
    check("JS-only new body shell raises invalid_content", "pinned upstream limitation reproduced",
          lambda: raises(upstream["WereadMPAPIError"], lambda: upstream["extract_mp_content"]("<script>var content_noencode='synthetic';</script>")))
    check("upstream error payload does not become empty success", "pinned upstream function",
          lambda: raises(upstream["WereadMPAPIError"], lambda: upstream["_raise_response_error"]({"errCode": -2012, "errMsg": "synthetic-expired"})))
    check("helper name normalization ignores ordinary and ideographic spaces", "pinned upstream function",
          lambda: helper["norm"](" Fixture\u3000 Account ") == "FixtureAccount")
    check("same display name cannot distinguish certification owner", "pinned upstream limitation reproduced",
          lambda: helper["norm"]("Fixture Account") == helper["norm"]("Fixture\u3000Account"))
    fake_biz = base64.b64encode(b"synthetic-not-real-account").decode()
    check("biz decode and engine feed ID are distinct representations", "synthetic format, upstream documented mapping",
          lambda: fake_biz != "MP_WXS_" + base64.b64decode(fake_biz).decode())
    for method, path in [("GET", "/api/v1/wx/message_tasks/x/run"), ("GET", "/api/v1/wx/mps/update/x"),
                         ("POST", "/api/v1/wx/mps"), ("PUT", "/api/v1/wx/message_tasks/job/fresh")]:
        check("read-only boundary rejects " + method + " " + path, "proposed exchange gateway",
              lambda method=method, path=path: not readonly_route(method, path))
    check("read-only boundary allows article list", "proposed exchange gateway",
          lambda: readonly_route("GET", "/api/v1/wx/articles"))
    approved = {"MP_WXS_synthetic": "synthetic-source"}
    article = {"mp_id": "MP_WXS_synthetic", "title": "Synthetic fixture", "publish_time": 0,
               "url": "https://mp.weixin.qq.com/s/synthetic-fixture?scene=1"}
    page = {"code": 0, "data": {"list": [article], "total": 1}}
    probe = ExchangeProbe()
    check("real list envelope accepted with approved source mapping", "proposed exchange format; synthetic input",
          lambda: probe.consume(200, page, approved)["new"] == 1)
    check("same URL and same input are idempotent", "in-memory exchange sketch",
          lambda: probe.consume(200, page, approved)["duplicate"] == 1 and len(probe.rows) == 1)
    changed = {**page, "data": {"list": [{**article, "title": "Synthetic revision"}], "total": 1}}
    check("same URL changed input creates a new content revision", "in-memory exchange sketch",
          lambda: probe.consume(200, changed, approved)["changed"] == 1 and list(probe.rows.values())[0][1] == 2)
    check("unknown source is rejected", "proposed exchange gateway",
          lambda: raises(ValueError, lambda: ExchangeProbe().consume(200, page, {})))
    check("HTML-shaped or missing list is not an empty page", "proposed exchange gateway",
          lambda: raises(ValueError, lambda: ExchangeProbe().consume(200, {"code": 0, "data": {}}, approved)))
    for status in (401, 403, 429):
        blocked_probe = ExchangeProbe()
        check("HTTP " + str(status) + " pauses before any row is consumed", "proposed exchange gateway",
              lambda status=status, p=blocked_probe: raises(Blocked, lambda: p.consume(status, page, approved)) and p.consumed == 0 and p.state == "paused")
        check("later successful data cannot resume a paused feed automatically after " + str(status), "proposed exchange gateway",
              lambda p=blocked_probe: raises(Blocked, lambda: p.consume(200, page, approved)) and p.consumed == 0)
    check("HTTP 200 upstream failure is not no-new-articles", "proposed exchange gateway",
          lambda: raises(Blocked, lambda: ExchangeProbe().consume(200, {"code": 200013, "data": {"list": []}}, approved)))
    check("userinfo and foreign host are rejected", "proposed exchange gateway",
          lambda: raises(ValueError, lambda: short_article_url("https://mp.weixin.qq.com.evil.invalid/s/x"))
          and raises(ValueError, lambda: short_article_url("https://synthetic@mp.weixin.qq.com/s/x")))
    check("credential query is rejected", "proposed exchange gateway",
          lambda: raises(ValueError, lambda: short_article_url("https://mp.weixin.qq.com/s/synthetic?pass_ticket=synthetic")))
    check("same title at different URL is not auto-merged", "in-memory exchange sketch",
          lambda: probe.consume(200, {"code": 0, "data": {"list": [{**article, "url": "https://mp.weixin.qq.com/s/second-synthetic"}]}}, approved)["new"] == 1 and len(probe.rows) == 2)
    after = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    result = {"checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "pins": PINS,
              "scope": "Offline research only; no WeChat/API requests, server startup, CDP, accounts, SMTP, models, D1 or deployment",
              "syntheticData": True, "gatewayImplementedInCampusOS": False,
              "guards": {"networkListenersProcessesSmtpDenied": True, "attemptedDeniedCalls": denied},
              "sourceHashesBefore": before, "sourceHashesAfter": after, "sourceFilesUnchanged": before == after,
              "checks": checks, "passed": sum(c["passed"] for c in checks), "total": len(checks)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "total": result["total"], "sourceFilesUnchanged": before == after}))
    return 0 if all(c["passed"] for c in checks) and before == after else 1


if __name__ == "__main__":
    raise SystemExit(main())
