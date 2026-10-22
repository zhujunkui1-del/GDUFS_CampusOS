"""Shared local library → cloud adds/updates; disappearance cannot remove data."""
from datetime import datetime, timezone, timedelta
import base64
import json
from pathlib import Path
import sys
import tempfile
import unittest

SERVICE = Path(__file__).resolve().parents[2] / "services/wechat-collector"
sys.path.insert(0, str(SERVICE))
import collector
import werss_sync
from article_library import read_metadata, reading_document, write_imported_article

ACCOUNT = "MP_WXS_12345"
URL = "https://mp.weixin.qq.com/s/SyntheticArticle000001"


class FakeWeRSS:
    def __init__(self, rows):
        self.rows = rows
        self.details = []

    def articles(self):
        yield from self.rows

    def detail(self, identity):
        self.details.append(identity)
        return dict(next(row for row in self.rows if row["id"] == identity))


class FakeCloud:
    def __init__(self):
        self.calls = []
        self.documents = {}
        self.failure = None

    def call(self, path, value=None):
        self.calls.append((path, value))
        if path == "sources":
            return {"sources": [{"sourceId": "synthetic-source", "accountId": ACCOUNT,
                                 "name": "隔离测试公众号", "sinceDay": "2000-01-01"}]}
        if path == "articles":
            if self.failure:
                raise RuntimeError(self.failure)
            previous = self.documents.get(value["url"])
            self.documents[value["url"]] = dict(value)
            return {"documentId": "synthetic-" + str(len(self.documents)), "state": "published",
                    "changed": int(previous != value), "htmlBytes": len(value["readingHtml"].encode())}
        if path == "heartbeat":
            return {}
        raise AssertionError("Non-add/update operation attempted: " + path)


class SharedSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.root = self.home / "data/articles_full"
        self.root.mkdir(parents=True)
        self.state = self.home / "data/CampusOS_collector"
        self.state.mkdir()
        self.config = {"exportDirectories": [str(self.root)], "dataDirectory": str(self.state),
                       "werss": {"enabled": True, "sinceDay": "2000-01-01"}}
        (self.root.parent / "rss_subscriptions.json").write_text(json.dumps([
            {"fakeid": base64.b64encode(b"12345").decode(), "nickname": "隔离测试公众号"}]), encoding="utf-8")
        self.db = collector.database(self.state / "state.sqlite3")
        self.cloud = FakeCloud()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def row(self, suffix="000001"):
        now = datetime.now(timezone.utc)
        return {"id": suffix, "mp_id": ACCOUNT, "status": 1, "has_content": 1,
                "title": "隔离样本 " + suffix, "url": URL[:-6] + suffix,
                "publish_time": int((now - timedelta(days=1)).timestamp()),
                "created_at": (now - timedelta(hours=1)).astimezone(werss_sync.CST).replace(tzinfo=None).isoformat(),
                "content": '<section style="background-color:#123456"><p>真实样式边界测试</p><img src="http://mmbiz.qpic.cn/synthetic/test.png"><script>bad()</script></section>',
                "content_html": "<p>Normalized fallback loses original layout</p>"}

    def import_row(self, row=None):
        client = FakeWeRSS([row or self.row()])
        result = werss_sync.sync_once(self.config, client)
        self.assertEqual(result["failed"], 0)
        return result, client

    def test_import_preserves_raw_styles_cdn_and_native_history_then_skips_existing(self):
        stats, client = self.import_row()
        self.assertEqual((stats["created"], len(client.details)), (1, 1))
        path = next(self.root.glob("*/*/reading.html"))
        html = path.read_text(encoding="utf-8")
        self.assertIn("background-color:#123456", html)
        self.assertIn("https://mmbiz.qpic.cn/", html)
        self.assertNotIn("bad()", html)
        history = json.loads((self.root.parent / "download_history.json").read_text(encoding="utf-8"))
        self.assertEqual(history[0]["link"], self.row()["url"])
        again, repeated = self.import_row()
        self.assertEqual((again["existing"], again["created"], len(repeated.details)), (1, 0, 0))
        self.assertEqual(path.read_text(encoding="utf-8"), html)

    def test_missing_body_stays_pending_and_unregistered_source_is_excluded(self):
        no_body = self.row()
        no_body["has_content"] = 0
        outsider = self.row("000002")
        outsider["mp_id"] = "MP_WXS_99999"
        client = FakeWeRSS([no_body, outsider])
        result = werss_sync.sync_once(self.config, client)
        self.assertEqual((result["pendingBody"], result["outOfScope"], result["created"]), (1, 1, 0))
        self.assertFalse(client.details)
        self.assertFalse(list(self.root.glob("*/*/*.html")))

    def test_existing_version_two_single_html_import_retains_original_date(self):
        self.import_row()
        path = next(self.root.glob("*/*/reading.html"))
        meta = read_metadata(path)
        meta["rendering_version"] = 2
        meta["publish_time_source"] = "original_saved_metadata"
        # The source iframe has already been removed from this saved reading
        # HTML, so reparsing cannot rediscover its partial-content state.
        meta["media_omitted"] = True
        path.write_text(reading_document(meta, "<p>旧版单文件正文</p>"), encoding="utf-8")
        result = collector.sync_once(self.config, self.db, self.cloud)
        self.assertEqual((result["published"], result["skipped"]), (1, 0))
        self.assertEqual(next(iter(self.cloud.documents.values()))["publishedAt"], collector.iso(meta["publish_time"]))
        self.assertTrue(next(iter(self.cloud.documents.values()))["mediaOmitted"])

    def test_changed_detail_identity_cannot_write(self):
        client = FakeWeRSS([self.row()])
        client.detail = lambda identity: {**self.row(), "mp_id": "MP_WXS_99999"}
        result = werss_sync.sync_once(self.config, client)
        self.assertEqual(result["errors"], {"WERSS_ARTICLE_IDENTITY_CHANGED": 1})
        self.assertFalse(list(self.root.glob("*/*/*.html")))

    def test_missing_library_and_legacy_deletion_evidence_never_remove_cloud_article(self):
        self.import_row()
        collector.sync_once(self.config, self.db, self.cloud)
        documents = dict(self.cloud.documents)
        # Simulate an accidentally missing library by reversible rename, plus
        # both historical removal inputs. Neither can emit an observation.
        self.root.rename(self.root.with_name("temporarily-offline"))
        (self.state / "upstream-observations.jsonl").write_text(json.dumps({
            "sourceId": "synthetic-source", "url": URL, "observedAt": datetime.now(timezone.utc).isoformat(),
            "outcome": "platform_deleted"}), encoding="utf-8")
        (self.root.parent / "download_history.json").write_text(json.dumps([
            {"success": False, "error": "文章已被作者删除", "account": "隔离测试公众号", "link": URL,
             "time": datetime.now(timezone.utc).timestamp()}]), encoding="utf-8")
        before = len(self.cloud.calls)
        result = collector.sync_once(self.config, self.db, self.cloud)
        self.assertEqual(result["syncMode"], "add_update_only")
        self.assertEqual(self.cloud.documents, documents)
        self.assertEqual([path for path, _ in self.cloud.calls[before:]], ["sources", "heartbeat"])

    def test_new_export_revision_updates_same_document_and_repeat_is_idle(self):
        self.import_row()
        collector.sync_once(self.config, self.db, self.cloud)
        path = next(self.root.glob("*/*/reading.html"))
        meta = read_metadata(path)
        meta["time"] = datetime.now(timezone.utc).isoformat()
        path.write_text(reading_document(meta, "<p>修订正文</p>"), encoding="utf-8")
        updated = collector.sync_once(self.config, self.db, self.cloud)
        self.assertEqual(updated["published"], 1)
        self.assertEqual(len(self.cloud.documents), 1)
        self.assertIn("修订正文", next(iter(self.cloud.documents.values()))["readingHtml"])
        before = len([p for p, _ in self.cloud.calls if p == "articles"])
        collector.sync_once(self.config, self.db, self.cloud)
        self.assertEqual(len([p for p, _ in self.cloud.calls if p == "articles"]), before)

    def test_upload_budget_resumes_and_outage_stops_after_first_request(self):
        client = FakeWeRSS([self.row("000001"), self.row("000002"), self.row("000003")])
        werss_sync.sync_once(self.config, client)
        self.config["maxUploadsPerCycle"] = 1
        first = collector.sync_once(self.config, self.db, self.cloud)
        self.assertEqual((first["published"], first["deferred"]), (1, 2))
        collector.sync_once(self.config, self.db, self.cloud)
        self.assertEqual(len(self.cloud.documents), 2)
        self.cloud.failure = "SERVICE_UNAVAILABLE"
        before = len([p for p, _ in self.cloud.calls if p == "articles"])
        with self.assertRaisesRegex(RuntimeError, "SERVICE_UNAVAILABLE"):
            collector.sync_once(self.config, self.db, self.cloud)
        self.assertEqual(len([p for p, _ in self.cloud.calls if p == "articles"]), before + 1)

    def test_cloud_client_refuses_removal_even_with_old_configuration(self):
        cloud = collector.Cloud({"campusosOrigin": "https://example.invalid", "token": "synthetic"})
        with self.assertRaisesRegex(ValueError, "COLLECTOR_ADD_UPDATE_ONLY"):
            cloud.call("observations", {"outcome": "platform_deleted"})


if __name__ == "__main__":
    unittest.main()
