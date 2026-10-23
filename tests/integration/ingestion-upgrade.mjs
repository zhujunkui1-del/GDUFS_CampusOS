// Disposable in-memory databases only. Does not open any existing local/cloud D1.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const files = readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort();
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
for (const file of files.filter((x) => x < "0007"))
  db.exec(readFileSync("migrations/" + file, "utf8"));
db.exec(`INSERT INTO users(id,display_name) VALUES('upgrade-fixture-user','isolated student');
INSERT INTO login_sessions(session_hash,user_id,expires_at) VALUES('fixture-session','upgrade-fixture-user','2099-01-01');
INSERT INTO conversations(id,user_id,owner_key,expires_at_ms) VALUES('fixture-chat','upgrade-fixture-user','u:upgrade-fixture-user',4102444800000);
INSERT INTO conversation_messages(id,conversation_id,role,content) VALUES('fixture-message','fixture-chat','user','isolated private fixture');
INSERT INTO console_admins(id,email,role) VALUES('fixture-admin','fixture@example.invalid','admin');
INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,console_managed,verification_status,official_status,permission_status,authorization_status,version)
VALUES('fixture-approved','approved fixture','official_web','[]','[]','{}',1,'verified','verified_official','approved','approved',7);
INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json) VALUES('fixture-private','private fixture','user_private','[]','[]','{}');
INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,published_at,fetched_at,campus_scope,data_domain,review_status,workflow_status,version) VALUES('fixture-public','fixture-approved','old fixture','https://example.invalid/old','old fixture body','old-hash','2019-01-01','2020-01-01','all','official_policy','approved','approved',4);
INSERT INTO knowledge_documents(id,source_id,owner_user_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain) VALUES('fixture-private','fixture-private','upgrade-fixture-user','private fixture','https://example.invalid/private','private fixture body','private-hash','2020-01-01','unknown','user_private');
INSERT INTO console_content_versions(document_id,version,snapshot_json,created_by,created_at) VALUES('fixture-public',4,'{"input":{"title":"old immutable fixture"}}','fixture-admin','2020-01-01');
INSERT INTO ingestion_jobs(id,source_id,status,error_code,attempts) VALUES('fixture-job','fixture-approved','failed','OLD_FIXTURE',2);
INSERT INTO console_audit_logs(id,actor_label,action,target_type,target_id) VALUES('fixture-audit','fixture','fixture.audit','document','fixture-public');`);
const fingerprint = () =>
  JSON.stringify({
    sources: db
      .prepare(
        "SELECT id,verification_status,official_status,permission_status,authorization_status,enabled,version FROM knowledge_sources ORDER BY id",
      )
      .all(),
    documents: db
      .prepare(
        "SELECT id,source_id,owner_user_id,title,body,published_at,fetched_at,version,review_status,workflow_status FROM knowledge_documents ORDER BY id",
      )
      .all(),
    snapshots: db
      .prepare(
        "SELECT document_id,version,snapshot_json FROM console_content_versions",
      )
      .all(),
    users: db.prepare("SELECT * FROM users").all(),
    sessions: db.prepare("SELECT * FROM login_sessions").all(),
    messages: db.prepare("SELECT * FROM conversation_messages").all(),
    audit: db.prepare("SELECT * FROM console_audit_logs").all(),
    jobs: db
      .prepare(
        "SELECT id,source_id,status,error_code,attempts FROM ingestion_jobs",
      )
      .all(),
  });
const before = fingerprint(),
  checks = [];
for (const file of files.filter((x) => x >= "0007")) {
  const ddl = readFileSync("migrations/" + file, "utf8");
  assert(
    !/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+\w+\s+RENAME)\b/i.test(
      ddl,
    ),
  );
  db.exec("BEGIN");
  try {
    db.exec(ddl);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  assert.equal(fingerprint(), before);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  checks.push({
    file,
    sha256: createHash("sha256")
      .update(ddl.replace(/\r\n/g, "\n").trimEnd() + "\n")
      .digest("hex"),
    populatedUpgradePassed: true,
  });
}
assert.equal(
  db.prepare("SELECT count(*) AS n FROM console_public_documents").get().n,
  0,
);
// Application rollback can keep new columns; old clients can write drafts, not publish unverified revisions.
db.exec(
  "UPDATE knowledge_documents SET title='old client edit',version=version+1 WHERE id='fixture-public'",
);
assert.throws(() =>
  db.exec(
    "UPDATE knowledge_documents SET publication_status='published' WHERE id='fixture-public'",
  ),
);
const title = db
  .prepare("SELECT title FROM knowledge_documents WHERE id='fixture-public'")
  .get().title;
db.exec("BEGIN");
assert.throws(() =>
  db.exec(
    "UPDATE knowledge_documents SET title='must rollback' WHERE id='fixture-public'; INSERT INTO knowledge_documents SELECT * FROM knowledge_documents;",
  ),
);
db.exec("ROLLBACK");
assert.equal(
  db
    .prepare("SELECT title FROM knowledge_documents WHERE id='fixture-public'")
    .get().title,
  title,
);
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
for (const { name } of tables) {
  const count = empty.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n;
  const expected =
    name === "console_admins"
      ? 4
      : name === "console_engine_settings"
        ? 1
        : 0;
  assert.equal(count, expected, name);
}
assert.deepEqual(
  empty
    .prepare("SELECT id FROM console_admins ORDER BY id")
    .all()
    .map(({ id }) => id),
  [
    "sys-console-cloud",
    "sys-console-publisher",
    "sys-console-runner",
    "sys-console-scheduler",
  ],
);
const report = {
  recordedAt: new Date().toISOString(),
  fixturesOnly: true,
  migrationHashMode: "sha256 UTF-8 LF with one final newline",
  realCloud: false,
  emptyMigrationPassed: true,
  populatedUpgradePassed: true,
  failedBatchRollbackPassed: true,
  legacyApplicationDraftCompatibilityPassed: true,
  legacyApplicationCannotBypassPublicationGate: true,
  sourceHumanStatesPreserved: true,
  privateDataAndSnapshotsPreserved: true,
  businessTables: tables.length,
  foreignKeyViolations: empty.prepare("PRAGMA foreign_key_check").all().length,
  migrations: checks,
  rollbackPolicy:
    "Application rollback preserves additive schema. Do not drop tables, erase documents or restore old public view.",
};
empty.close();
mkdirSync("docs/verification/s3-b", { recursive: true });
writeFileSync(
  "docs/verification/s3-b/database-tests.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
