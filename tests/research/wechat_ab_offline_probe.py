"""Read-only, network-denied probes of owner-supplied A/B source snapshots.

No upstream module imports, service startup, activation, cookies or live articles.
Selected function ASTs run only with synthetic responses and small fixture HTML.
An assertion passing can mean a known defect was reproduced, not feature success.
"""

from __future__ import annotations

import ast
import contextlib
import datetime as dt
import hashlib
import html as html_stdlib
import io
import json
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
from typing import Annotated, Any, Dict, List, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from lxml import html as lxml_html


ROOT = Path(__file__).resolve().parents[2]
REFERENCES = ROOT / "CampusOS_Codex_完整设计文档_v2"
A = REFERENCES / "weixin_search_mcp-main"
B = REFERENCES / "wechat-article-exporter-main" / "wechat-article-exporter-main"
RESULT = ROOT / "docs/verification/s3-wechat-resumed/ab-offline-probes.json"


def deny_network_or_process(event, _args):
    if event in {
        "socket.connect", "socket.getaddrinfo", "socket.gethostbyname",
        "socket.gethostbyname_ex", "subprocess.Popen", "os.system",
    }:
        raise AssertionError("Offline research forbids network and child processes")


sys.addaudithook(deny_network_or_process)
SOURCES = {
    "A/search": A / "weixin_search_mcp/tools/weixin_search.py",
    "A/main": A / "weixin_search_mcp/main.py",
    "B/wechat": B / "backend/app/scrapers/wechat.py",
    "B/meta": B / "backend/app/scrapers/custom_urls.py",
    "B/models": B / "backend/app/models.py",
}
HASHES = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in SOURCES.items()}


class RemoveCookieLiteral(ast.NodeTransformer):
    def visit_Dict(self, node):
        self.generic_visit(node)
        for index, key in enumerate(node.keys):
            if isinstance(key, ast.Constant) and str(key.value).lower() == "cookie":
                node.values[index] = ast.Constant("[OMITTED-NOT-USED]")
        return node


def load_functions(path, names, namespace, class_name=None):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    pool = tree.body
    if class_name:
        pool = next(x.body for x in tree.body if isinstance(x, ast.ClassDef) and x.name == class_name)
    chosen = [x for x in pool if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef)) and x.name in names]
    assert {x.name for x in chosen} == set(names)
    for function in chosen:
        function.decorator_list = []
        assert not any(isinstance(x, (ast.Import, ast.ImportFrom)) for x in ast.walk(function)), function.name
        assert not any(
            isinstance(x, ast.Call) and isinstance(x.func, ast.Name)
            and x.func.id in {"eval", "exec", "compile", "__import__", "open"}
            for x in ast.walk(function)
        ), function.name
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *chosen], type_ignores=[])
    module = ast.fix_missing_locations(RemoveCookieLiteral().visit(module))
    exec(compile(module, str(path), "exec"), namespace)


class RequestError(Exception):
    pass


class Response:
    def __init__(self, text="<html></html>", status_code=200, url="https://synthetic.invalid/"):
        self.text, self.status_code, self.url = text, status_code, url

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RequestError(f"synthetic HTTP {self.status_code}")


class RequestsStub:
    Response = Response
    RequestException = RequestError

    def __init__(self):
        self.reply = Response()
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, "page": kwargs.get("params", {}).get("page")})
        if callable(self.reply):
            return self.reply(url, kwargs)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


requests_stub = RequestsStub()
a = {"requests": requests_stub, "html": lxml_html, "quote": quote,
     "time": SimpleNamespace(sleep=lambda _: None), "REQUEST_TIMEOUT": 15}
load_functions(SOURCES["A/search"], ["_is_antispider_response", "sogou_weixin_search", "sogou_weixin_search_all", "get_real_url_from_sogou", "get_article_content"], a)

common = {"re": re, "json": json, "html_module": html_stdlib,
          "html_lib": html_stdlib, "BeautifulSoup": BeautifulSoup}
b_meta = {**common, "datetime": dt.datetime, "timezone": dt.timezone, "timedelta": dt.timedelta}
load_functions(SOURCES["B/meta"], ["dedupe_wechat_title", "parse_wechat_page_meta"], b_meta)


def article_item(**values):
    return SimpleNamespace(is_failed=False, error_reason=None, **values)


class NoClient:
    async def get(self, *_args, **_kwargs):
        raise AssertionError("Synthetic raw_html must prevent any request")


b = {**common, "datetime": dt, "ArticleItem": article_item,
     "dedupe_wechat_title": b_meta["dedupe_wechat_title"]}
load_functions(SOURCES["B/wechat"], ["unescape_wechat_text", "clean_wechat_author"], b)
load_functions(SOURCES["B/wechat"], ["_extract_articles_from_album_scripts", "_extract_articles_from_all_links", "_format_wechat_create_time", "scrape_article_detail"], b, "WeChatScraper")
fixture_self = SimpleNamespace(client=NoClient(), include_comments=False, uin="", key="", pass_ticket="", appmsg_token="", enable_noise_filter=True, remove_image_watermark=False)

cases = []


def probe(case_id, kind, description, function):
    started = time.perf_counter()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            observed = function()
        cases.append({"id": case_id, "kind": kind, "description": description,
                      "assertion_passed": True, "observed": observed,
                      "elapsed_ms": round((time.perf_counter() - started) * 1000, 3)})
    except Exception as error:
        cases.append({"id": case_id, "kind": kind, "description": description,
                      "assertion_passed": False, "error_type": type(error).__name__,
                      "error": str(error)[:200]})


def run_offline_coroutine(coroutine):
    """Drive non-suspending raw_html paths without asyncio's Windows socketpair."""
    try:
        yielded = coroutine.send(None)
    except StopIteration as done:
        return done.value
    else:
        coroutine.close()
        raise AssertionError(f"Offline synthetic path unexpectedly suspended: {type(yielded).__name__}")


def search_html(date="2026-10-17", second=False):
    first = "<li id='sogou_vr_11002601_box_1'><div class='txt-box'><a id='sogou_vr_11002601_title_1' href='/link?url=synthetic'>合成通知</a><div class='s-p'><span class='s2'>" + date + "</span></div></div></li>"
    return "<html><body>" + first + ("<a id='sogou_vr_11002601_title_2' href='/link?url=synthetic2'>合成通知二</a>" if second else "") + "</body></html>"


def check_search_response(response, strict=False):
    requests_stub.reply = response
    result = a["sogou_weixin_search"]("合成测试", strict=strict)
    assert result == []
    return {"result": result}


probe("A01", "behavior", "A true empty HTML result returns []", lambda: check_search_response(Response()))
probe("A02", "known_defect_reproduced", "A default single-page HTTP 403 is indistinguishable from true empty", lambda: check_search_response(Response(status_code=403)))
probe("A03", "known_defect_reproduced", "A default single-page 200 anti-spider HTML becomes []", lambda: check_search_response(Response("<html>anti.min.css seccoderight</html>")))


def strict_block():
    requests_stub.reply = Response(status_code=403)
    try:
        a["sogou_weixin_search"]("合成测试", strict=True)
    except RuntimeError:
        return {"exception": "RuntimeError"}
    raise AssertionError("strict request unexpectedly returned normally")


probe("A04", "behavior", "A strict page mode reports HTTP failure as exception", strict_block)


def result_probe(js_date=False, second=False):
    requests_stub.reply = Response(search_html("<script>document.write(timeConvert('1788797730'))</script>" if js_date else "2026-10-17", second))
    # This fake redirect resolver records a missing link without making another request.
    resolver = a["get_real_url_from_sogou"]
    a["get_real_url_from_sogou"] = lambda _: ""
    try:
        result = a["sogou_weixin_search"]("合成测试")
    finally:
        a["get_real_url_from_sogou"] = resolver
    assert len(result) == 1
    assert result[0]["real_url"] == ""
    if js_date:
        assert "document.write" in result[0]["publish_time"]
    return {"result_count": len(result), "real_url": result[0]["real_url"], "publish_time": result[0]["publish_time"]}


probe("A05", "known_defect_reproduced", "A retains search row with missing real_url; no validated article identity", result_probe)
probe("A06", "known_defect_reproduced", "A returns JS date source rather than parsed timestamp", lambda: result_probe(js_date=True))
probe("A07", "known_defect_reproduced", "A zip(title,time) drops an article when time element is absent", lambda: result_probe(second=True))


def malformed_resolver():
    requests_stub.reply = Response("<script>url += 'discard'; url += 'synthetic.invalid/s/example';</script>")
    result = a["get_real_url_from_sogou"]("https://synthetic.invalid/redirect")
    assert urlsplit(result).hostname != "mp.weixin.qq.com"
    return {"returned_url": result, "exact_wechat_host": False}


probe("A08", "known_defect_reproduced", "A redirect string concatenation does not enforce exact WeChat hostname", malformed_resolver)


def empty_content():
    requests_stub.reply = Response("<html><h1>合成验证页，无正文</h1></html>")
    result = a["get_article_content"]("https://synthetic.invalid/article", None)
    assert result == ""
    return {"content": result, "explicit_block_or_parse_error": False}


probe("A09", "known_defect_reproduced", "A 200 page without js_content silently returns empty string", empty_content)


def duplicate_pages():
    original = a["sogou_weixin_search"]
    a["sogou_weixin_search"] = lambda _query, page, strict: [{"title": "合成", "real_url": "https://mp.weixin.qq.com/s/synthetic", "page": str(page)}]
    try:
        result = a["sogou_weixin_search_all"]("合成", max_pages=2)
    finally:
        a["sogou_weixin_search"] = original
    assert len(result) == 2 and len({x["real_url"] for x in result}) == 1
    return {"rows": 2, "unique_real_urls": 1}


probe("A10", "known_defect_reproduced", "A multi-page aggregator concatenates duplicates without URL dedup", duplicate_pages)


def meta_valid():
    result = b_meta["parse_wechat_page_meta"]("<html><meta property='og:title' content='合成通知'><meta property='og:article:author' content='合成公众号'><script>var ct = '1788797730';</script></html>")
    expected = dt.datetime.fromtimestamp(1788797730, dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    assert result["publish_time"] == expected
    return {**result, "expected_timezone": "+08:00", "certification_verified": False}


probe("B01", "behavior", "B page-meta parser converts Unix ct explicitly to Beijing time", meta_valid)


def meta_missing():
    result = b_meta["parse_wechat_page_meta"]("<html><h1 id='activity-name'>合成无日期通知</h1></html>")
    assert "publish_time" not in result
    return result


probe("B02", "behavior", "B page-meta parser leaves unsupported date absent", meta_missing)


def album_synthetic():
    payload = [{"title": "合成一", "content_url": "https://mp.weixin.qq.com/s/synthetic1", "multi_app_msg_item_list": [{"title": "合成二", "content_url": "https://mp.weixin.qq.com/s/synthetic2"}]}]
    result = b["_extract_articles_from_album_scripts"](fixture_self, "<script>var articleList = " + json.dumps(payload, ensure_ascii=False) + ";</script>")
    assert {x["title"] for x in result} == {"合成一", "合成二"}
    return {"rows": len(result), "unique_urls": len({x["url"] for x in result}), "has_publish_time": any("publish_time" in x or "create_time" in x for x in result)}


probe("B03", "behavior", "B synthetic embedded album JSON can expose parent and child article links", album_synthetic)


def host_substring():
    result = b["_extract_articles_from_all_links"](fixture_self, "<a href='https://unapproved.invalid/?next=https://mp.weixin.qq.com/s/synthetic'>合成</a>")
    assert result and urlsplit(result[0]["url"]).hostname == "unapproved.invalid"
    return {"exact_wechat_host": False, "accepted_unapproved_hostname": True}


probe("B04", "known_defect_reproduced", "B fallback link parser accepts hostname substring outside exact WeChat host", host_substring)


def body_missing_actual():
    try:
        run_offline_coroutine(b["scrape_article_detail"](fixture_self, {"url": "https://mp.weixin.qq.com/s/synthetic", "title": "合成无正文", "raw_html": "<html><title>合成验证页</title></html>"}))
    except NameError as error:
        assert "html" in str(error)
        return {"exception": "NameError", "name": "html", "body_success": False}
    raise AssertionError("Expected current source's undefined html dependency")


probe("B05", "known_defect_reproduced", "B actual missing-body fallback references undefined html global", body_missing_actual)


def latent_template():
    # Explicit dependency repair only, not the unmodified runtime success path.
    # No upstream file is changed. It reveals why merely fixing NameError is unsafe.
    b["html"] = html_stdlib
    try:
        result = run_offline_coroutine(b["scrape_article_detail"](fixture_self, {"url": "https://mp.weixin.qq.com/s/synthetic", "title": "合成无正文", "raw_html": "<html><title>合成验证页</title></html>"}))
    finally:
        del b["html"]
    assert result.publish_time == dt.date.today().isoformat()
    assert "核心概念解构" in result.content_markdown and not result.is_failed
    return {"dependency_repair_only": "provided missing html stdlib alias in isolated namespace", "publication_date_filled_with_run_date": True, "generic_template_generated": True, "is_failed": result.is_failed, "real_body_obtained": False}


probe("B06", "latent_defect_with_explicit_dependency_repair", "B missing-body branch fabricates generic template and today's publication date after html alias supplied", latent_template)


def valid_body_missing_date():
    # Cleaner is a deterministic stand-in: checks method field mapping, not cleaner quality.
    b["clean_html_content"] = lambda *_args, **_kwargs: ("<p>合成正文足够长，只用于测试</p>", "合成正文足够长，只用于测试，不代表真实校园文章。", [])
    result = run_offline_coroutine(b["scrape_article_detail"](fixture_self, {"url": "https://mp.weixin.qq.com/s/synthetic", "title": "合成", "raw_html": "<html><div id='js_name'>合成公众号</div><div id='js_content'><p>合成正文足够长，只用于测试，不代表真实校园文章。</p></div></html>"}))
    assert result.publish_time == ""
    return {"cleaner_stubbed": True, "publish_time": result.publish_time, "body_is_synthetic": True}


probe("B07", "behavior", "B successful-body branch retains unknown publication date rather than always filling today", valid_body_missing_date)


def normalize_fixture_batch(rows):
    accepted, rejected, seen, duplicates = [], 0, set(), 0
    for row in rows:
        raw_url = row.get("real_url") if "real_url" in row else row.get("url")
        if not isinstance(raw_url, str) or row.get("is_failed"):
            rejected += 1
            continue
        parsed = urlsplit(raw_url)
        if parsed.scheme != "https" or parsed.hostname != "mp.weixin.qq.com" or parsed.username or parsed.password or parsed.port or not (parsed.path == "/s" or parsed.path.startswith("/s/")):
            rejected += 1
            continue
        query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k not in {"scene", "src", "timestamp"}]
        normalized_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(sorted(query)), ""))
        if normalized_url in seen:
            duplicates += 1
            continue
        seen.add(normalized_url)
        raw_time = row.get("publish_time") or row.get("create_time") or ""
        try:
            date_is_known = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_time)) and dt.date.fromisoformat(raw_time) is not None
        except ValueError:
            date_is_known = False
        accepted.append({"title": row.get("title", ""), "url": normalized_url,
                         "published_date": raw_time if date_is_known else None,
                         "time_precision": "date" if date_is_known else "unknown",
                         "rights_scope": "metadata_only", "review_status": "pending"})
    return {"accepted": accepted, "duplicates": duplicates, "rejected": rejected}


def batch_contract():
    rows = [
        {"title": "合成A", "real_url": "https://mp.weixin.qq.com/s/synthetic1?scene=1", "publish_time": "document.write(timeConvert('1788797730'))"},
        {"title": "合成B", "url": "https://mp.weixin.qq.com/s/synthetic2", "publish_time": "2026-10-17"},
        {"title": "重复B", "url": "https://mp.weixin.qq.com/s/synthetic2#wechat_redirect"},
        {"title": "无真链", "real_url": ""},
        {"title": "外域", "url": "https://unapproved.invalid/s/synthetic"},
    ]
    result = normalize_fixture_batch(rows)
    assert len(result["accepted"]) == 2 and result["duplicates"] == 1 and result["rejected"] == 2
    assert result["accepted"][0]["published_date"] is None
    assert result["accepted"][1]["time_precision"] == "date"
    assert all(x["review_status"] == "pending" for x in result["accepted"])
    return result


probe("AB01", "synthetic_exchange_contract_only", "Fixture A/B output normalization rejects missing/foreign links, preserves unknown time and deduplicates", batch_contract)

unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == HASHES[name] for name, path in SOURCES.items())
assert unchanged
report = {
    "checked_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    "scope": "selected upstream function ASTs, synthetic HTML/JSON, stubbed requests; not full application startup or live collection",
    "network_guard": "Python audit denies DNS/socket connections and subprocess/os.system",
    "real_article_samples": 0, "live_discovery_denominator": 0,
    "live_url_accuracy": "not measured (0/0)", "live_body_completeness": "not measured (0/0)",
    "models_or_activation_used": False, "original_files_unchanged": unchanged,
    "source_hashes": HASHES,
    "summary": {"probes": len(cases), "assertions_passed": sum(x["assertion_passed"] for x in cases),
                "assertions_failed": sum(not x["assertion_passed"] for x in cases),
                "warning": "Passing defect-reproduction assertions are not upstream feature success."},
    "cases": cases,
}
RESULT.parent.mkdir(parents=True, exist_ok=True)
RESULT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report["summary"], ensure_ascii=False))
print(str(RESULT))
sys.exit(1 if report["summary"]["assertions_failed"] else 0)
