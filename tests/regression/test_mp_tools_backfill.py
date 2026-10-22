"""Offline backfill orchestration checks; never access a running application."""
import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("backfill", ROOT / "services/wechat-collector/backfill_mp_tools.py")
B = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(B)


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.guards = [patch.object(socket.socket, "connect", side_effect=AssertionError("No network")),
                       patch.object(socket.socket, "connect_ex", side_effect=AssertionError("No network")),
                       patch.object(B, "inventory", return_value={})]
        for guard in self.guards:
            guard.start()
        result = ROOT / "test-results"
        result.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="mp-tools-backfill-", dir=result)
        self.directory = Path(self.temp.name).resolve()
        self.assertTrue(self.directory.is_relative_to(result.resolve()))
        self.job = {"name": "Offline source", "fakeid": "offline", "offset": 0, "status": "pending", "pages": 0,
                    "fingerprints": [], "downloaded": 0, "alreadyPresent": 0, "outOfRange": 0}
        self.state = {"status": "ready", "completed": False, "jobs": [self.job], "newDownloads": [],
                      "unavailable": [], "consecutiveFrequencyLimits": 0, "nextAttemptAt": 0}
        self.worker = B.Backfill(self.state, self.directory)
        self.worker.wait = lambda _: None

    def tearDown(self):
        self.temp.cleanup()
        for guard in reversed(self.guards):
            guard.stop()

    def test_short_url_preserves_complete_token(self):
        self.assertEqual(B.canonical("https://mp.weixin.qq.com/s/first~middle_tail?scene=1"),
                         "https://mp.weixin.qq.com/s/first_middle_tail")

    def test_local_cache_cannot_advance_cursor_or_trigger_download(self):
        response = {"list_origin": "local_downloads", "directory_complete": False, "articles": [{"title": "Offline"}],
                    "warning": "HTTP 499，错误码 -2014"}
        with patch.object(B, "api", return_value=response) as api, patch.object(B, "pool_state", return_value=[]):
            with self.assertRaises(B.WaitForRateLimit):
                self.worker.page(self.job)
        self.assertEqual(self.job["offset"], 0)
        self.assertEqual(self.job["pages"], 0)
        self.assertEqual(self.job["status"], "pending")
        self.assertEqual(len(self.state["newDownloads"]), 0)
        self.assertEqual(api.call_count, 1)
        self.assertNotIn("/download", api.call_args.args[0])

    def test_verified_pages_skip_existing_urls_and_finish_at_boundary(self):
        url = "https://mp.weixin.qq.com/s/offline_abcdefghijklmnop"
        self.worker.known[(self.job["name"], url)] = {"publishTime": B.START + 100, "path": "offline"}
        pages = [{"list_origin": "upstream_history", "directory_complete": True, "can_msg_continue": 1,
                  "articles": [{"title": "Offline", "link": url, "update_time": B.START + 100}]},
                 {"list_origin": "upstream_history", "directory_complete": True, "can_msg_continue": 0, "articles": []}]
        with patch.object(B, "api", side_effect=pages) as api, patch.object(B, "pool_state", return_value=[]):
            self.worker.page(self.job)
            self.assertEqual(self.job["offset"], 20)
            self.worker.page(self.job)
        self.assertEqual(self.job["status"], "completed")
        self.assertEqual(self.job["pages"], 2)
        self.assertEqual(self.job["alreadyPresent"], 1)
        self.assertEqual(api.call_count, 2)
        self.assertTrue(all("/list/" in c.args[0] for c in api.call_args_list))

    def test_frequency_backoff_increases_and_preserves_publisher_deadline(self):
        with patch.object(B.time, "time", return_value=1000.0), patch.object(B, "pool_state", return_value=[]):
            self.worker.schedule_frequency_wait("offline -2014")
            self.assertEqual(self.state["nextAttemptAt"], 1900.0)
            self.worker.schedule_frequency_wait("offline -2014")
            self.assertEqual(self.state["nextAttemptAt"], 2800.0)
        with patch.object(B.time, "time", return_value=1000.0), patch.object(B, "pool_state", return_value=[{"cooldown_until": 9000.0}]):
            self.worker.schedule_frequency_wait("offline -2014")
            self.assertEqual(self.state["nextAttemptAt"], 9000.0)

    def test_only_the_registered_scope_is_used(self):
        accounts = [{"nickname": "Offline " + str(i), "fakeid": str(i)} for i in range(75)]
        accounts += [{"nickname": name, "fakeid": name} for name in B.EXCLUDED]
        with patch.object(B, "load_json", return_value={}):
            state = B.new_state(accounts)
        self.assertEqual(len(state["jobs"]), 75)
        self.assertTrue(B.EXCLUDED.isdisjoint({j["name"] for j in state["jobs"]}))
        self.assertIs(state["completed"], False)

    def test_interrupted_download_with_saved_file_is_not_submitted_again(self):
        url = "https://mp.weixin.qq.com/s/offline_abcdefghijklmnop"
        self.state["activeDownload"] = {"account": self.job["name"], "url": url, "taskId": "offline-task"}
        known = {(self.job["name"], url): {"path": "offline", "publishTime": B.START + 1}}
        with patch.object(B, "inventory", return_value=known), patch.object(B, "api") as api:
            self.worker.download(self.job, {"title": "Offline", "link": url})
        api.assert_not_called()
        self.assertEqual(len(self.state["newDownloads"]), 1)
        self.assertNotIn("activeDownload", self.state)

    def test_known_inaccessible_article_is_not_requested_again(self):
        url = "https://mp.weixin.qq.com/s/offline_abcdefghijklmnop"
        self.state["unavailable"].append({"account": self.job["name"], "url": url})
        with patch.object(B, "api") as api:
            self.worker.download(self.job, {"title": "Offline", "link": url})
        api.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
