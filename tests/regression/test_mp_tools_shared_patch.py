"""Exercise actual staged PyInstaller functions with temporary local files only."""
from datetime import datetime, timezone
import importlib.util
import json
import marshal
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch
import zlib

TARGET = Path(r"D:\WeChat MP Tools_v2.3.1")
EXE = Path(os.environ.get("MP_TOOLS_LIBRARY_EXE", TARGET / "data/patches/shared-article-library-2026-10-22/WeChat MP Tools.shared-library.exe"))
URL = "https://mp.weixin.qq.com/s/staged_fixture_article_123"


def functions(code):
    return {item.co_name: item for item in code.co_consts if isinstance(item, types.CodeType)}


class StagedPatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        helper_path = Path(r"D:\WeChat MP Tools_v2.2.4\data\patches\short-url-2026-10-21\patch_package.py")
        spec = importlib.util.spec_from_file_location("shared_patch_archive", helper_path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        archive = helper.read_archive(EXE.read_bytes())
        cls.codes = {name: marshal.loads(zlib.decompress(archive["modules"][name][1])) for name in (
            "backend.downloader", "backend.config", "backend.articles", "backend.campusos_reading_html", "backend.campusos_article_library")}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "data/articles_full"
        self.root.mkdir(parents=True)
        self.history = self.root.parent / "download_history.json"
        backend = types.ModuleType("backend")
        backend.__path__ = []
        sanitizer = types.ModuleType("backend.campusos_reading_html")
        exec(self.codes[sanitizer.__name__], sanitizer.__dict__)
        library = types.ModuleType("backend.campusos_article_library")
        self.modules = patch.dict(sys.modules, {"backend": backend, sanitizer.__name__: sanitizer,
            library.__name__: library, "article_library": None, "reading_html": None})
        self.modules.start()
        exec(self.codes[library.__name__], library.__dict__)
        self.library = library
        self.g = {"__builtins__": __builtins__, "Path": Path, "get_settings": lambda: {"campusos_reading_only": True, "download_dir": str(self.root)},
                  "OUTPUT_DIR": self.root, "DOWNLOAD_HISTORY_FILE": self.history,
                  "json": json, "shutil": shutil, "jsonify": lambda x: x}
        downloader_codes = functions(self.codes["backend.downloader"])
        for name in ("campusos_existing_reading", "campusos_reading_result", "download_single_article"):
            self.g[name] = types.FunctionType(downloader_codes[name], self.g)
        self.save = types.FunctionType(functions(self.codes["backend.config"])["save_json"], self.g)
        self.g["save_json"] = self.save
        self.g["load_json"] = lambda p, default=None: json.loads(p.read_text(encoding="utf-8")) if p.exists() else default

    def tearDown(self):
        self.modules.stop()
        self.temp.cleanup()

    def create(self):
        return self.library.write_imported_article(self.root, account_id="MP_WXS_123456789", source_name="测试公众号", title="真实样式测试",
            url=URL, published_at=1700000000, content_html="<p>Body</p>", observed_at=datetime.now(timezone.utc).isoformat())

    def test_shipped_download_function_skips_import_before_fetch(self):
        imported = self.create()
        self.g["fetch_wechat_article_html"] = lambda *a, **k: self.fail("Existing article triggered an upstream request")
        result = self.g["download_single_article"](URL, self.root / "测试公众号", "title", 0, "")
        self.assertTrue(result["already_exists"])
        self.assertEqual(result["path"], str(Path(imported["path"]).parent))

    def test_shipped_save_json_preserves_concurrent_import(self):
        self.create()
        self.save(self.history, [{"title": "Other", "link": URL + "_other", "success": True}])
        rows = json.loads(self.history.read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 2)
        self.assertTrue(any(row["link"] == URL for row in rows))

    def test_shipped_scanner_reads_embedded_metadata_without_removing_empty_folders(self):
        imported = self.create()
        empty = self.root / "测试公众号" / "未完成下载"
        empty.mkdir()
        scan = types.FunctionType(functions(self.codes["backend.articles"])["_sync_history_from_disk"], self.g)
        rows = []
        self.assertTrue(scan(rows))
        self.assertEqual(rows[0]["link"], URL)
        self.assertEqual(rows[0]["publish_time"], 1700000000)
        self.assertEqual(rows[0]["path"], str(Path(imported["path"]).parent))
        self.assertTrue(empty.is_dir())

    def test_native_explicit_history_delete_retains_its_original_behavior(self):
        self.create()
        delete = types.FunctionType(functions(self.codes["backend.articles"])["delete_history_item"], self.g)
        result = delete(0)
        self.assertIn("message", result)
        self.assertEqual(json.loads(self.history.read_text(encoding="utf-8")), [])


if __name__ == "__main__":
    unittest.main()
