"""Owner-authorized offline regression against code extracted from the real EXE.

The only replaced boundary is page acquisition. Real saved article HTML is supplied
there; no login/configuration files or production download directories are changed.
"""
import importlib.util
import hashlib
import json
import marshal
import os
import re
from pathlib import Path
import socket
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zlib
from html.parser import HTMLParser

PROJECT = Path(__file__).resolve().parents[2]
TOOLS = Path(os.environ.get("MP_TOOLS_HOME", r"D:\WeChat MP Tools"))
EXE = Path(os.environ.get("MP_TOOLS_PATCH_EXE", TOOLS / "WeChat MP Tools.exe"))
ARTICLE = TOOLS / "data/articles_full/外环东路178号的猫/广外学子，一起去趟台湾吧！"
URL = "https://mp.weixin.qq.com/s/b-j068_jhyDagOUOiqitOg"


class SavedHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.metadata = None
        self.images = []
        self.text = []
        self.backgrounds = set()
        self.csp = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta" and values.get("name") == "campusos-article":
            self.metadata = json.loads(values["content"])
        if tag == "meta" and values.get("http-equiv", "").lower() == "content-security-policy":
            self.csp = values.get("content", "")
        if tag == "img":
            self.images.append(values.get("src", ""))
        style = values.get("style", "")
        if "background" in style:
            for match in re.finditer(r'''url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)''', style):
                url = next((part for part in match.groups() if part is not None), "").strip()
                if url.startswith("//"):
                    url = "https:" + url
                if url.startswith("https://mmbiz.qpic.cn/"):
                    self.backgrounds.add(url)

    def handle_data(self, value):
        self.text.append(value)


class PackagedDownloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not EXE.is_file() or not ARTICLE.is_dir():
            raise unittest.SkipTest("The owner's EXE and real local article are required.")
        helper_path = TOOLS / "data/patches/short-url-2026-10-21/patch_package.py"
        spec = importlib.util.spec_from_file_location("mp_archive_helpers", helper_path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        archive = helper.read_archive(EXE.read_bytes())
        cls.code = marshal.loads(zlib.decompress(archive["modules"]["backend.downloader"][1]))
        raw_files = list(ARTICLE.glob("*_raw.html"))
        if raw_files and (ARTICLE / "metadata.json").is_file():
            cls.raw = raw_files[0].read_text(encoding="utf-8-sig")
            cls.original = json.loads((ARTICLE / "metadata.json").read_text(encoding="utf-8-sig"))
        else:
            # The owner has removed the legacy raw/JSON copies. Reuse the real
            # single-HTML export, including its embedded publication metadata.
            saved = (ARTICLE / "reading.html").read_text(encoding="utf-8-sig")
            parsed = SavedHTML()
            parsed.feed(saved)
            if not parsed.metadata:
                raise unittest.SkipTest("Real saved article metadata is required")
            cls.original = parsed.metadata
            body = re.search(r"<body\b[^>]*>(.*?)</body>", saved, re.S | re.I)
            if body is None:
                raise unittest.SkipTest("Real saved article body is required")
            # Restore only the native acquisition envelope, not article content.
            # The original WeChat DOM wrapper was removed by the reading export.
            cls.raw = ('<!doctype html><html><head><title>' + cls.original["title"] +
                       '</title></head><body><h1 id="activity-name">' + cls.original["title"] +
                       '</h1><div id="js_content">' + body.group(1) + '</div></body></html>')
        # The saved reading copy omits page scripts. Rebuild that input envelope
        # from the real saved publication metadata for the dated-page cases.
        cls.dated_page = cls.raw + '<script>var ct = "' + str(cls.original["publish_time"]) + '";</script>'

    def setUp(self):
        self.patches = []
        self.fetches = []
        self.config = types.ModuleType("backend.config")
        self.config.DEFAULT_HEADERS = {}
        # Legacy output flags deliberately remain on: the reading branch must return
        # before any media directory or secondary format is created.
        self.config.get_settings = lambda: {"campusos_reading_only": True, "auto_save_images": True, "auto_save_videos": True, "save_markdown": True, "save_pdf": True}
        self.config.get_proxies_dict = lambda: {}
        self.config.report_proxy_status = lambda *args, **kwargs: None
        requests = types.ModuleType("requests")
        requests.get = self.forbid_network
        backend = types.ModuleType("backend")
        backend.__path__ = []
        for item in [
            patch.dict(sys.modules, {"backend": backend, "backend.config": self.config, "requests": requests}),
            patch.object(socket.socket, "connect", self.forbid_network),
            patch.object(socket.socket, "connect_ex", self.forbid_network),
        ]:
            item.start()
            self.patches.append(item)
        self.namespace = {"__name__": "offline_packaged_downloader", "__file__": self.code.co_filename}
        exec(self.code, self.namespace)

        def acquire(url, review_id=""):
            self.fetches.append((url, review_id))
            return self.dated_page, url, ""
        self.namespace["fetch_wechat_article_html"] = acquire
        root = PROJECT / "test-results"
        root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="mp-tools-html-", dir=root)
        self.output = Path(self.temp.name).resolve()
        self.assertTrue(self.output.is_relative_to(root.resolve()))

    def tearDown(self):
        self.assertTrue(self.output.resolve().is_relative_to((PROJECT / "test-results").resolve()))
        self.temp.cleanup()
        for item in reversed(self.patches):
            item.stop()

    @staticmethod
    def forbid_network(*args, **kwargs):
        raise AssertionError("Network use is forbidden in this offline regression.")

    def check_export(self, review_id):
        result = self.namespace["download_single_article"](URL.replace("_", "~"), self.output, "", review_id=review_id)
        self.assertTrue(result.get("success"), result.get("error"))
        self.assertEqual(self.fetches, [(URL, review_id)])
        files = [p for p in self.output.rglob("*") if p.is_file()]
        self.assertEqual([p.name for p in files], [files[0].parent.name + ".html"])
        self.assertEqual(files[0].parent.name, self.original["title"])
        self.assertFalse(any(p.name == "media" for p in self.output.rglob("*")))
        document = files[0].read_text(encoding="utf-8")
        parsed = SavedHTML()
        parsed.feed(document)
        self.assertEqual(parsed.metadata["url"], URL)
        self.assertEqual(parsed.metadata["publish_time"], self.original["publish_time"])
        self.assertEqual(parsed.metadata["publish_time_source"], "original_page")
        self.assertGreaterEqual(len(parsed.images), 24)
        self.assertTrue(all(src.startswith("https://") for src in parsed.images))
        self.assertTrue("东吴大学" in "".join(parsed.text), "Original article text is missing")
        self.assertTrue(re.search(r"background-color:\s*rgb\(248,\s*250,\s*251\)", document), "Original background color is missing")
        original_layout = SavedHTML()
        original_layout.feed(self.raw)
        self.assertTrue(original_layout.backgrounds, "The real fixture must include CDN background images")
        self.assertTrue(original_layout.backgrounds.issubset(parsed.backgrounds), "Original CDN background URLs are missing")
        self.assertIn("script-src 'none'", parsed.csp)
        self.assertTrue("<script" not in document.lower(), "Active page scripts must not be exported")
        if review_id:
            self.assertEqual(parsed.metadata["account_id"], "MP_WXS_3889818792")
        return document

    def test_manual_download_uses_acquired_html_and_preserves_layout(self):
        self.check_export("MP_WXS_3889818792_b-j068_jhyDagOUOiqitOg")

    def test_rss_download_without_review_id_is_single_html_and_retry_overwrites(self):
        self.check_export("")
        self.fetches.clear()
        self.check_export("")

    def test_failed_acquisition_keeps_original_error_and_creates_no_article(self):
        self.namespace["fetch_wechat_article_html"] = lambda url, review_id="": ("", url, "ORIGINAL_ACCESS_FAILURE")
        result = self.namespace["download_single_article"](URL, self.output)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "ORIGINAL_ACCESS_FAILURE")
        self.assertEqual(list(self.output.iterdir()), [])

    def test_failed_retry_preserves_existing_article_bytes(self):
        first = self.namespace["download_single_article"](URL, self.output)
        folder = Path(first["path"])
        before = {p.name: p.read_bytes() for p in folder.iterdir() if p.is_file()}
        self.namespace["fetch_wechat_article_html"] = lambda url, review_id="": ("", url, "ORIGINAL_ACCESS_FAILURE")
        result = self.namespace["download_single_article"](URL, self.output, self.original["title"])
        self.assertFalse(result["success"])
        self.assertTrue(folder.is_dir())
        self.assertEqual({p.name: p.read_bytes() for p in folder.iterdir() if p.is_file()}, before)

    def test_readable_page_without_date_is_saved_with_unknown_date(self):
        self.namespace["fetch_wechat_article_html"] = lambda url, review_id="": (self.raw, url, "")
        result = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(result["success"], result.get("error"))
        files = [p for p in self.output.rglob("*") if p.is_file()]
        self.assertEqual([p.name for p in files], [files[0].parent.name + ".html"])
        parsed = SavedHTML()
        parsed.feed(files[0].read_text(encoding="utf-8"))
        self.assertIsNone(parsed.metadata["publish_time"])
        self.assertEqual(parsed.metadata["publish_time_source"], "unknown")
        self.assertGreaterEqual(len(parsed.images), 24)

    def test_svg_layout_never_preserves_script_or_event_handlers(self):
        position = self.dated_page.index(">", self.dated_page.index('id="js_content"')) + 1
        hostile = '<svg onload="bad()"><foreignObject><div><script>bad()</script><img src="https://mmbiz.qpic.cn/offline-fixture.png" onerror="bad()"><a href="javascript:bad()">fixture</a></div></foreignObject></svg>'
        page = self.dated_page[:position] + hostile + self.dated_page[position:]
        self.namespace["fetch_wechat_article_html"] = lambda url, review_id="": (page, url, "")
        result = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(result["success"], result.get("error"))
        document = next(self.output.rglob("*.html")).read_text(encoding="utf-8")
        for active_content in ('<script', 'onload=', 'onerror=', 'href="javascript:'):
            self.assertTrue(active_content not in document.lower(), "Active content survived sanitization")
        parsed = SavedHTML()
        parsed.feed(document)
        self.assertIn("script-src 'none'", parsed.csp)

    def test_same_title_different_articles_do_not_overwrite_each_other(self):
        first = self.namespace["download_single_article"](URL, self.output)
        other_url = "https://mp.weixin.qq.com/s/abcdefghijklmnopqrstuv"
        second = self.namespace["download_single_article"](other_url, self.output)
        self.assertTrue(first["success"] and second["success"])
        self.assertNotEqual(first["path"], second["path"])
        self.assertEqual(Path(first["path"]).name, self.original["title"])
        self.assertTrue(Path(second["path"]).name.startswith(self.original["title"] + " ["))
        self.assertEqual(len(list(self.output.rglob("*.html"))), 2)

    def test_existing_hash_folder_is_renamed_without_duplicate(self):
        first = self.namespace["download_single_article"](URL, self.output)
        source = Path(first["path"])
        legacy = self.output / ("campusos-" + hashlib.sha256(URL.encode()).hexdigest()[:32])
        self.assertEqual(source.resolve().parent, self.output)
        self.assertEqual(legacy.resolve().parent, self.output)
        source.rename(legacy)
        result = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(result["success"])
        self.assertEqual(Path(result["path"]).name, self.original["title"])
        self.assertFalse(legacy.exists())
        self.assertEqual(len(list(self.output.rglob("*.html"))), 1)

    def test_revised_title_renames_same_article_instead_of_duplicating(self):
        first = self.namespace["download_single_article"](URL, self.output)
        revised = re.sub(r"<title>.*?</title>", "<title>更正后的文章标题</title>", self.dated_page, count=1)
        self.namespace["fetch_wechat_article_html"] = lambda url, review_id="": (revised, url, "")
        second = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(second["success"])
        self.assertEqual(Path(second["path"]).name, "更正后的文章标题")
        self.assertFalse(Path(first["path"]).exists())
        files = list(self.output.rglob("*.html"))
        self.assertEqual([p.name for p in files], ["更正后的文章标题.html"])

    def test_windows_folder_names_and_existing_unrelated_folder_are_safe(self):
        naming = self.namespace["campusos_folder_name"]
        self.assertEqual(naming("CON", self.output), "_CON")
        self.assertEqual(naming("NUL.txt", self.output), "_NUL.txt")
        self.assertEqual(naming('标题&quot;引号&quot;/A:测试. ', self.output), '标题_引号__A_测试')
        long_name = naming("长标题" * 150, self.output)
        self.assertLessEqual(len(str(self.output / long_name / (long_name + ".html.tmp")).encode("utf-16-le")) // 2, 240)
        unrelated = self.output / self.original["title"]
        unrelated.mkdir()
        (unrelated / "notes.txt").write_text("keep", encoding="utf-8")
        result = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(result["success"])
        self.assertNotEqual(Path(result["path"]), unrelated)
        self.assertEqual((unrelated / "notes.txt").read_text(encoding="utf-8"), "keep")

    def test_stale_directory_index_never_overwrites_a_repurposed_folder(self):
        first = self.namespace["download_single_article"](URL, self.output)
        original_file = next(Path(first["path"]).glob("*.html"))
        changed = original_file.read_text(encoding="utf-8").replace(URL, "https://mp.weixin.qq.com/s/abcdefghijklmnopqrstuv")
        original_file.write_text(changed, encoding="utf-8")
        result = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(result["success"])
        self.assertNotEqual(result["path"], first["path"])
        self.assertEqual(original_file.read_text(encoding="utf-8"), changed)

    def test_legacy_reading_filename_is_replaced_only_for_same_article(self):
        first = self.namespace["download_single_article"](URL, self.output)
        folder = Path(first["path"])
        saved = next(folder.glob("*.html"))
        if saved.name != "reading.html":
            saved.rename(folder / "reading.html")
        (folder / "notes.txt").write_text("keep", encoding="utf-8")
        self.namespace["_campusos_directory_index"].clear()
        second = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(second["success"])
        self.assertEqual(second["path"], first["path"])
        self.assertEqual([p.name for p in folder.glob("*.html")], [folder.name + ".html"])
        self.assertEqual((folder / "notes.txt").read_text(encoding="utf-8"), "keep")

    def test_full_title_is_preserved_before_windows_path_shortening(self):
        title = "完整标题" * 18
        revised = re.sub(r"<title>.*?</title>", "<title>" + title + "</title>", self.dated_page, count=1)
        self.namespace["fetch_wechat_article_html"] = lambda url, review_id="": (revised, url, "")
        result = self.namespace["download_single_article"](URL, self.output)
        self.assertTrue(result["success"], result.get("error"))
        file = next(Path(result["path"]).glob("*.html"))
        parsed = SavedHTML()
        parsed.feed(file.read_text(encoding="utf-8"))
        self.assertEqual(parsed.metadata["title"], title)
        self.assertEqual(file.stem, file.parent.name)
        self.assertTrue(title.startswith(file.stem))
        self.assertLessEqual(len(str(file).encode("utf-16-le")) // 2, 240)


if __name__ == "__main__":
    unittest.main()
