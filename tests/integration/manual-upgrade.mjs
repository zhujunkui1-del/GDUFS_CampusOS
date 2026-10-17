// Only disposable in-memory SQLite; never executes against a cloud/local persistent DB.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const files = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql") && f <= "0013_content_edit_intake_guard.sql")
  .sort();
const target = "0012_manual_intake_and_evidence.sql";
const sql = files
  .filter((f) => f >= target)
  .map((f) => readFileSync("migrations/" + f, "utf8"))
  .join("\n");
assert(!/\b(?:DROP|DELETE|REPLACE)\s+(?:TABLE|FROM|INTO)\b/i.test(sql));
function before() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of files.filter((f) => f < target))
    db.exec(readFileSync("migrations/" + file, "utf8"));
  return db;
}
function seed(db) {
  db.exec(
    "INSERT INTO users(id,display_name) VALUES('synthetic-student','隔离学生'); INSERT INTO console_admins(id,email,role) VALUES('synthetic-admin','synthetic@example.invalid','admin'); INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,console_managed) VALUES('synthetic-source','隔离旧来源','manual','[]','[]','{}',1)",
  );
  for (const [id, owner, domain] of [
    ["old-public", null, "campus_announcements"],
    ["old-private", "synthetic-student", "user_private"],
  ])
    db.prepare(
      "INSERT INTO knowledge_documents(id,source_id,owner_user_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain) VALUES(?,'synthetic-source',?,'隔离旧记录',?,'旧内容不改写',?,'2020-01-01','unknown',?)",
    ).run(id, owner, "https://example.invalid/" + id, id, domain);
  db.exec(
    "INSERT INTO console_content_versions(document_id,version,snapshot_json,created_by,created_at) VALUES('old-public',1,'{\"legacy\":true}','synthetic-admin','2020-01-01')",
  );
}
const fingerprint = (db) =>
  JSON.stringify({
    documents: db
      .prepare(
        "SELECT id,source_id,owner_user_id,title,body,content_hash,published_at,fetched_at,version,input_hash,review_status,publication_status FROM knowledge_documents ORDER BY id",
      )
      .all(),
    versions: db.prepare("SELECT * FROM console_content_versions").all(),
    users: db.prepare("SELECT * FROM users").all(),
  });
const empty = before();
empty.exec(sql);
assert.equal(empty.prepare("PRAGMA foreign_key_check").all().length, 0);
const businessTables = empty
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )
  .all().length;
assert.equal(businessTables, 55);
empty.close();
const existing = before();
seed(existing);
const original = fingerprint(existing);
existing.exec(sql);
assert.equal(fingerprint(existing), original);
assert.equal(existing.prepare("PRAGMA foreign_key_check").all().length, 0);
assert.equal(
  existing
    .prepare(
      "SELECT count(*) AS n FROM knowledge_documents WHERE body_status='unknown'",
    )
    .get().n,
  2,
);
existing.close();
// A populated 0012 installation also upgrades to 0013 without data rewriting.
const incremental = before();
seed(incremental);
incremental.exec(readFileSync("migrations/" + target, "utf8"));
const after12 = fingerprint(incremental);
incremental.exec(
  readFileSync("migrations/0013_content_edit_intake_guard.sql", "utf8"),
);
assert.equal(fingerprint(incremental), after12);
assert.equal(incremental.prepare("PRAGMA foreign_key_check").all().length, 0);
incremental.close();
const rollback = before();
seed(rollback);
const baseline = fingerprint(rollback);
rollback.exec("BEGIN IMMEDIATE");
try {
  rollback.exec(sql);
  rollback.exec(
    "INSERT INTO users(id,display_name) VALUES('synthetic-student','duplicate')",
  );
  assert.fail("Expected rollback test failure");
} catch {
  rollback.exec("ROLLBACK");
}
assert.equal(fingerprint(rollback), baseline);
assert(
  !rollback
    .prepare("PRAGMA table_info(knowledge_documents)")
    .all()
    .some((c) => c.name === "body_status"),
);
rollback.close();
const report = {
  checkedAt: new Date().toISOString(),
  emptyMigrationPassed: true,
  populatedUpgradePassed: true,
  incremental0012UpgradePassed: true,
  failedMigrationRollbackPassed: true,
  privateDataAndSnapshotsPreserved: true,
  foreignKeyViolations: 0,
  businessTables,
  oldBodyCompletenessRemainsUnknown: true,
  noPersistentDatabaseTouched: true,
  migrations: files.map((file) => ({
    file,
    sha256: createHash("sha256")
      .update(
        readFileSync("migrations/" + file, "utf8")
          .replace(/\r\n/g, "\n")
          .trimEnd() + "\n",
      )
      .digest("hex"),
  })),
};
mkdirSync("docs/verification/s3-b-final", { recursive: true });
writeFileSync(
  "docs/verification/s3-b-final/database-tests.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
