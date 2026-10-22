"""Owner-authorized, socket-blocked regression of the installed MP Tools code.

Only HTTP, clock and local account storage boundaries are replaced. No real
credentials are read, and no production files or download history are written.
"""
import importlib.util
import logging
import json
import html
import marshal
import os
from pathlib import Path
import socket
import sys
import threading
import tempfile
import types
import unittest
from unittest.mock import patch
import zlib
import re

HOME = Path(r"D:\WeChat MP Tools")
EXE = Path(os.environ.get("MP_TOOLS_PATCH_EXE", HOME / "WeChat MP Tools.exe"))


def child(code, name):
    return next(x for x in code.co_consts if isinstance(x, types.CodeType) and x.co_name == name)


class Response:
    def __init__(self, status, data):
        self.status_code = status
        self.data = data
        self.text = "offline fixture"
        self.headers = {}

    def __bool__(self):
        # requests.Response is false for HTTP errors: this is part of the bug.
        return self.status_code < 400

    def json(self):
        return self.data


class HistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("history_archive", HOME / "data/patches/short-url-2026-10-21/patch_package.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        archive = helper.read_archive(EXE.read_bytes())
        cls.articles = marshal.loads(zlib.decompress(archive["modules"]["backend.articles"][1]))
        pool = marshal.loads(zlib.decompress(archive["modules"]["backend.account_pool"][1]))
        cls.pool_class = child(pool, "AccountPool")

    def setUp(self):
        self.calls = []
        self.reports = []
        self.tokens = [patch.object(socket.socket, "connect", side_effect=AssertionError("Offline regression must not use network")),
                       patch.object(socket.socket, "connect_ex", side_effect=AssertionError("Offline regression must not use network"))]
        waterwall = types.ModuleType("backend.waterwall")
        waterwall.detect_waterwall = lambda *a: None
        waterwall.record_failure = lambda *a: None
        waterwall.waterwall_hit = lambda *a: None
        self.tokens.append(patch.dict(sys.modules, {"backend.waterwall": waterwall}))
        for item in self.tokens:
            item.start()
        self.g = {"__builtins__": __builtins__, "__name__": "offline_history", "threading": threading,
                  "time": types.SimpleNamespace(time=lambda: 1000.0, monotonic=lambda: 1000.0, sleep=lambda *_: None),
                  "logger": logging.getLogger("offline_history"), "json": __import__("json")}
        self.g.update({"biz_to_book_id": lambda _: "MP_WXS_3083007618",
                       "borrow_weread_session": lambda: ("offline-account", "offline-vid", "offline-token", {}),
                       "account_pool": types.SimpleNamespace(report=lambda *a, **k: self.reports.append(k)),
                       "_resolve_review_doc_url": lambda *a: "https://mp.weixin.qq.com/s/offline_abcdefghij123456",
                       "short_id_from_review_id": lambda rid: rid.split("MP_WXS_3083007618_", 1)[-1],
                       "normalize_wechat_short_url": lambda x: x})
        for code in self.articles.co_consts:
            if isinstance(code, types.CodeType) and code.co_name.startswith(("_history_", "_directory_", "_restore_", "_short_")):
                self.g[code.co_name] = types.FunctionType(code, self.g)
        self.fetch = types.FunctionType(child(self.articles, "_fetch_articles_page"), self.g)
        self.fetch.__defaults__ = ("", "", "")

    def tearDown(self):
        for item in reversed(self.tokens):
            item.stop()

    def responses(self, history_status=200, payload=None):
        if payload is None:
            payload = {"data": [{"reviewId": "MP_WXS_3083007618_abcdefghijklmnopq12345", "createTime": 1792000000,
                                  "mpInfo": {"title": "Offline historical item"}},
                                 {"reviewId": "MP_WXS_3083007618_second_abcdefghijklm12345", "createTime": 1791900000,
                                  "mpInfo": {"title": "Offline historical item 2"}}], "hasMore": True}

        def get(url, **kwargs):
            self.calls.append(url)
            if "/mp/cover?" in url:
                return Response(200, {"reviewId": "MP_WXS_3083007618_offline_abcdefghij123456", "title": "Offline cover"})
            if "/mp/chapters?" in url:
                return Response(history_status, payload)
            raise AssertionError("Unexpected fallback request: " + url)
        self.g["get_weread_session"] = lambda: types.SimpleNamespace(get=get)

    def test_cover_does_not_hide_history_rate_limit(self):
        self.responses(499, {"errcode": -2013, "errmsg": "offline rate limit"})
        with self.assertRaises(RuntimeError):
            self.fetch("offline-biz", 0, 10)

    def test_error_payload_with_http_200_is_not_empty_history(self):
        self.responses(200, {"errcode": -2013, "errmsg": "offline rate limit"})
        with self.assertRaises(RuntimeError):
            self.fetch("offline-biz", 0, 10)

    def test_healthy_history_can_continue_beyond_cover(self):
        self.responses()
        articles, total, more = self.fetch("offline-biz", 0, 10)
        self.assertGreaterEqual(len(articles), 2)
        self.assertEqual(more, 1)
        self.assertGreater(total, len(articles))

    def test_empty_more_page_is_not_end_of_history(self):
        self.responses(200, {"data": [], "hasMore": True})
        with self.assertRaises(RuntimeError):
            self.fetch("offline-biz", 10, 10)

    def test_missing_list_is_not_end_of_history(self):
        self.responses(200, {})
        with self.assertRaises(RuntimeError):
            self.fetch("offline-biz", 0, 10)

    def test_distinct_articles_with_same_title_are_kept(self):
        self.responses(200, {"data": [
            {"reviewId": "MP_WXS_3083007618_first_abcdefghijklm12345", "mpInfo": {"title": "Same title"}},
            {"reviewId": "MP_WXS_3083007618_second_abcdefghijklm12345", "mpInfo": {"title": "Same title"}},
        ], "hasMore": False})
        articles, total, more = self.fetch("offline-biz", 0, 10)
        self.assertEqual(len(articles), 2)
        self.assertEqual(total, 2)
        self.assertEqual(more, 0)

    def test_refusal_is_not_retried_or_replaced_with_cover(self):
        self.responses(499, {"errcode": -2013})
        with self.assertRaises(RuntimeError):
            self.fetch("offline-biz", 0, 10)
        self.assertEqual(len(self.calls), 1)
        self.assertIn("/mp/chapters?", self.calls[0])

    def test_expired_cooldown_can_resume_normally(self):
        pool, values = self.pool()
        values[0]["cooldown_until"] = 900.0
        acquire = types.FunctionType(child(self.pool_class, "acquire"), self.g)
        self.assertEqual(acquire(pool)["status"], "active")

    def test_failed_directory_returns_failure_not_successful_empty_list(self):
        root = Path(__file__).resolve().parents[2] / "test-results"
        root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="mp-tools-directory-cache-", dir=root) as temp:
            output = Path(temp).resolve()
            self.assertTrue(output.is_relative_to(root.resolve()))
            data = output / "data"
            article = data / "articles_full/Offline source/Offline title"
            article.mkdir(parents=True)
            (data / "accounts.json").write_text(json.dumps([{"fakeid": "MzA4MzAwNzYxOA==", "nickname": "Offline source"}]), encoding="utf-8")
            meta = {"title": "Offline title", "url": "https://mp.weixin.qq.com/s/abcdefghijklmnopq12345",
                    "account_id": "MP_WXS_3083007618", "publish_time": 1792000000}
            (article / "reading.html").write_text('<meta name="campusos-article" content="' + html.escape(json.dumps(meta), quote=True) + '">', encoding="utf-8")
            self.g.update({"DATA_DIR": data, "Path": Path, "re": re,
                           "load_json": lambda p, default: json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default,
                           "get_settings": lambda: {"download_dir": str(data / "articles_full")},
                           "jsonify": lambda d: d})
            class Args(dict):
                def get(self, key, default=None, type=None):
                    value = super().get(key, default)
                    return type(value) if type else value
            self.g["request"] = types.SimpleNamespace(args=Args())
            def unavailable(*args, **kwargs):
                raise RuntimeError("Offline directory restriction")
            self.g["_fetch_articles_page"] = unavailable
            route = types.FunctionType(child(self.articles, "get_articles"), self.g)
            result = route("MzA4MzAwNzYxOA==")
            body, status = result
            self.assertEqual(status, 503)
            self.assertIs(body["directory_complete"], False)
            self.assertIn("Offline directory restriction", body["error"])
            self.assertNotIn("articles", body)

    def test_second_page_uses_requested_offset_and_preserves_more_flag(self):
        self.responses()
        first, _, more = self.fetch("offline-biz", 0, 20)
        second, _, second_more = self.fetch("offline-biz", 20, 20)
        self.assertEqual(len(first), 2)
        self.assertEqual(len(second), 2)
        self.assertEqual((more, second_more), (1, 1))
        self.assertIn("offset=0", self.calls[0])
        self.assertIn("offset=20", self.calls[1])

    def pool(self):
        values = [{"id": "offline-account", "vid": "offline-vid", "status": "cooldown",
                   "cooldown_until": 1120.0, "last_error": "offline restriction", "failures": 0}]
        pool = types.SimpleNamespace(_lock=threading.RLock(), _load=lambda: values, _save=lambda _: None,
                                     _refresh_account_locked=lambda _: (_ for _ in ()).throw(AssertionError("No refresh expected")))
        return pool, values

    def test_cooling_account_is_not_borrowed(self):
        pool, _ = self.pool()
        acquire = types.FunctionType(child(self.pool_class, "acquire"), self.g)
        self.assertIsNone(acquire(pool))

    def test_cover_success_does_not_erase_cooldown_error(self):
        pool, values = self.pool()
        report = types.FunctionType(child(self.pool_class, "report"), self.g)
        report.__kwdefaults__ = {"ret": None, "status_code": None, "is_success": None,
                                 "error_msg": None, "need_refresh": False, "retry_after": 120.0}
        report(pool, "offline-account", is_success=True)
        self.assertEqual(values[0]["last_error"], "offline restriction")


if __name__ == "__main__":
    unittest.main(verbosity=2)
