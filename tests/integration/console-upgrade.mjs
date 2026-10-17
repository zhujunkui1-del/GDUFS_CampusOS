// All fixtures remain in disposable in-memory SQLite databases.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const files = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
for (const file of files)
  if (file < "0006_console_registry.sql")
    db.exec(readFileSync("migrations/" + file, "utf8"));
const now = Date.now();
db.exec(`INSERT INTO users(id,display_name) VALUES('upgrade-student','Isolated student');
INSERT INTO login_sessions(session_hash,user_id,expires_at) VALUES('isolated-session','upgrade-student','2099-01-01T00:00:00Z');
INSERT INTO conversations(id,user_id,owner_key,expires_at_ms) VALUES('upgrade-conversation','upgrade-student','u:upgrade-student',${now + 86400000});
INSERT INTO conversation_messages(id,conversation_id,role,content) VALUES('upgrade-message','upgrade-conversation','user','isolated private conversation');
INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json) VALUES('old-public','Public fixture','official_web','[]','[]','{}');
INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json) VALUES('old-private','Private fixture','user_private','[]','[]','{}');
INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain) VALUES('old-public-document','old-public','Public fixture','https://example.invalid/public','isolated public body','public-hash','2026-10-17T00:00:00Z','all','official_policy');
INSERT INTO knowledge_documents(id,source_id,owner_user_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain) VALUES('old-private-document','old-private','upgrade-student','Private fixture','https://example.invalid/private','isolated private body','private-hash','2026-10-17T00:00:00Z','unknown','user_private');`);
function fingerprint() {
  return JSON.stringify({
    users: db.prepare("SELECT * FROM users").all(),
    sessions: db.prepare("SELECT * FROM login_sessions").all(),
    conversations: db.prepare("SELECT * FROM conversations").all(),
    messages: db.prepare("SELECT * FROM conversation_messages").all(),
    documents: db
      .prepare(
        "SELECT id,source_id,owner_user_id,title,body,content_hash,review_status,lifecycle_status FROM knowledge_documents ORDER BY id",
      )
      .all(),
  });
}
const before = fingerprint();
db.exec(readFileSync("migrations/0006_console_registry.sql", "utf8"));
assert.equal(fingerprint(), before);
assert.equal(
  db
    .prepare(
      "SELECT count(*) AS n FROM console_content_versions WHERE document_id='old-private-document'",
    )
    .get().n,
  0,
);
assert.equal(
  db
    .prepare(
      "SELECT count(*) AS n FROM console_content_versions WHERE document_id='old-public-document'",
    )
    .get().n,
  1,
);
assert.equal(
  db.prepare("SELECT count(*) AS n FROM console_public_documents").get().n,
  0,
);
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
db.close();
const empty = new DatabaseSync(":memory:");
empty.exec("PRAGMA foreign_keys=ON");
for (const file of files)
  empty.exec(readFileSync("migrations/" + file, "utf8"));
const tables = empty
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )
  .all();
for (const { name } of tables)
  assert.equal(empty.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n, 0);
const result = {
  recordedAt: new Date().toISOString(),
  emptyMigrationPassed: true,
  populatedUpgradePassed: true,
  businessTables: tables.length,
  originalUserSessionConversationMessagesPreserved: true,
  privateDocumentsNotCopiedToConsole: true,
  publicLegacyVersionPreserved: true,
  oldDocumentsNotAutoPublished: true,
  foreignKeyViolations: empty.prepare("PRAGMA foreign_key_check").all().length,
  realCloud: false,
  fixturesOnly: true,
};
empty.close();
mkdirSync("docs/verification/s3-a", { recursive: true });
writeFileSync(
  "docs/verification/s3-a/database-tests.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
