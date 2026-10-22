"""Both local producers share article identity, locks and MP Tools history."""
from datetime import datetime, timezone
import json
import multiprocessing
from pathlib import Path
import sys
import tempfile
import unittest

SERVICES = Path(__file__).resolve().parents[2] / "services/wechat-collector"
sys.path.insert(0, str(SERVICES))
import article_library as library
import mp_tools_reading_export as mp

URL = "https://mp.weixin.qq.com/s/test_existing_article_12345"
ACCOUNT = "MP_WXS_123456789"
TITLE = "相同标题"
PUBLISHED = 1700000000
OBSERVED = datetime.now(timezone.utc).isoformat()


def import_article(root, url=URL, title=TITLE):
    return library.write_imported_article(root, account_id=ACCOUNT, source_name="测试公众号", title=title,
        url=url, published_at=PUBLISHED, content_html='<p>真实正文测试</p><img src="http://mmbiz.qpic.cn/test">', observed_at=OBSERVED)


def mp_article(root, url=URL, title=TITLE):
    out = Path(root) / "测试公众号"
    out.mkdir(parents=True, exist_ok=True)
    return mp.campusos_save_reading('var ct="1700000000";var nickname="测试公众号";', url, out,
        title, '<p>MP Tools 正文</p>', PUBLISHED, ACCOUNT + "_review")


def race_writer(root, producer, barrier, queue):
    barrier.wait(10)
    try:
        result = import_article(root) if producer == "werss" else mp_article(root)
        queue.put((True, result))
    except Exception as exc:
        queue.put((False, repr(exc)))


class ArticleLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "data/articles_full"
        self.root.mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def history(self):
        return json.loads((self.root.parent / "download_history.json").read_text(encoding="utf-8"))

    def test_import_then_mp_keeps_original_bytes_and_history(self):
        imported = import_article(self.root)
        path = Path(imported["path"])
        original = path.read_bytes()
        history_path = self.root.parent / "download_history.json"
        history_bytes = history_path.read_bytes()
        # Set a distinct timestamp so a rewrite cannot pass due to clock precision.
        import os
        os.utime(history_path, ns=(1600000000000000000, 1600000000000000000))
        history_mtime = history_path.stat().st_mtime_ns
        repeated = import_article(self.root)
        self.assertTrue(repeated["skipped"])
        self.assertEqual(history_path.read_bytes(), history_bytes)
        self.assertEqual(history_path.stat().st_mtime_ns, history_mtime)
        result = mp_article(self.root, URL + "?from=share", "后改的标题")
        self.assertTrue(result["already_exists"])
        self.assertEqual(result["path"], str(path.parent))
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(len(self.history()), 1)
        self.assertEqual(self.history()[0]["publish_time"], PUBLISHED)
        self.assertIn('src="https://mmbiz.qpic.cn/test"', original.decode())

    def test_mp_then_import_keeps_existing_file(self):
        saved = mp_article(self.root)
        path = next(Path(saved["path"]).glob("*.html"))
        original = path.read_bytes()
        result = import_article(self.root)
        self.assertTrue(result["skipped"])
        self.assertEqual(Path(result["path"]), path)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(len(self.history()), 1)

    def test_same_title_different_urls_remain_two_articles(self):
        first = import_article(self.root)
        second = mp_article(self.root, URL + "_different")
        self.assertNotEqual(Path(first["path"]).parent, Path(second["path"]))
        self.assertEqual(len(list(library.reading_files(self.root))), 2)
        self.assertEqual(len(self.history()), 2)

    def test_two_process_producers_only_create_one_article(self):
        context = multiprocessing.get_context("spawn")
        barrier, queue = context.Barrier(2), context.Queue()
        workers = [context.Process(target=race_writer, args=(str(self.root), p, barrier, queue)) for p in ("werss", "mp")]
        for worker in workers:
            worker.start()
        results = [queue.get(timeout=20) for _ in workers]
        for worker in workers:
            worker.join(20)
            self.assertEqual(worker.exitcode, 0)
        self.assertTrue(all(ok for ok, _ in results), results)
        self.assertEqual(len(list(library.reading_files(self.root))), 1)
        self.assertEqual(len(self.history()), 1)

    def test_stale_native_history_save_preserves_import_and_success(self):
        stale = [{"title": "另一个", "link": URL + "_other", "success": True, "path": "older"}]
        import_article(self.root)
        library.merge_history(self.root.parent / "download_history.json", stale)
        library.merge_history(self.root.parent / "download_history.json", [{"link": URL, "success": False, "path": None}])
        rows = self.history()
        self.assertEqual(len(rows), 2)
        self.assertTrue(next(row for row in rows if row["link"] == URL)["success"])

    def test_removed_local_folder_does_not_remove_history(self):
        result = import_article(self.root)
        Path(result["path"]).rename(Path(result["path"]).with_suffix(".preserved"))
        library.merge_history(self.root.parent / "download_history.json", [])
        self.assertEqual(len(self.history()), 1)

    def test_invalid_source_and_unknown_publication_time_do_not_write(self):
        with self.assertRaises(ValueError):
            library.write_imported_article(self.root, account_id="guess", source_name="测试公众号", title=TITLE,
                url=URL, published_at=None, content_html="<p>text</p>", observed_at=OBSERVED)
        self.assertEqual(list(library.reading_files(self.root)), [])


if __name__ == "__main__":
    unittest.main()
