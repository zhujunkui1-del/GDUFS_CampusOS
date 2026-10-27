from pathlib import Path
import base64
import json
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/wechat-collector"))
from account_registry import account_manifest, account_identity, sync_accounts


class RegistryTests(unittest.TestCase):
    def test_current_folders_register_new_accounts_without_a_fixed_count_or_reserved_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "articles_full"
            root.mkdir()
            (root / ".campusos-locks").mkdir()
            (root / "隔离公众号一").mkdir()
            rows = [{"nickname": "隔离公众号一", "fakeid": base64.b64encode(b"12345").decode()}]
            file = root.parent / "accounts.json"
            file.write_text(json.dumps(rows), encoding="utf8")
            db = sqlite3.connect(":memory:")
            calls = []

            class Cloud:
                def call(self, path, payload):
                    calls.append((path, payload))
                    return {"accounts": [{"accountId": a["accountId"], "state": "matched"} for a in payload["accounts"]]}

            config = {"exportDirectories": [str(root)]}
            sync_accounts(config, db, Cloud())
            sync_accounts(config, db, Cloud())
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], "accounts")
            self.assertEqual(len(calls[0][1]["accounts"]), 1)
            (root / "新增公众号").mkdir()
            rows.append({"nickname": "新增公众号", "fakeid": base64.b64encode(b"67890").decode()})
            file.write_text(json.dumps(rows), encoding="utf8")
            sync_accounts(config, db, Cloud())
            self.assertEqual(len(calls), 2)
            self.assertEqual({a["accountId"] for a in calls[-1][1]["accounts"]}, {"MP_WXS_12345", "MP_WXS_67890"})
            self.assertNotIn(".campusos-locks", json.dumps(calls, ensure_ascii=False))
            db.close()

    def test_renames_do_not_create_duplicate_publishers_or_guess_missing_identities(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "articles_full"
            root.mkdir()
            for name in ["旧名称", "新名称", "未知目录"]:
                (root / name).mkdir()
            (root.parent / "accounts.json").write_text(json.dumps([{"nickname": name, "fakeid": base64.b64encode(b"12345").decode()} for name in ["旧名称", "新名称"]]), encoding="utf8")
            self.assertEqual(len(account_manifest([str(root)])), 1)
            self.assertEqual(account_identity(base64.b64encode(b"12345").decode()), "MP_WXS_12345")
            self.assertIsNone(account_identity("bad-value"))


if __name__ == "__main__":
    unittest.main()
