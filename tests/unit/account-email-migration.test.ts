import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
it("preserves all legacy email challenges, users and sessions through 0057", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON;");
    for (const f of readdirSync("migrations")
      .filter((n) => n.endsWith(".sql") && n < "0057")
      .sort())
      db.exec(readFileSync("migrations/" + f, "utf8"));
    db.exec(
      "INSERT INTO users(id,display_name) VALUES('migration-user','Migration'); INSERT INTO login_sessions(session_hash,user_id,expires_at) VALUES('session-preserved','migration-user','2030-01-01');",
    );
    db.prepare(
      "INSERT INTO user_auth_tokens(token_hash,user_id,purpose,code_hash,email,auth_version,email_epoch,created_at_ms,expires_at_ms) VALUES('challenge-preserved','migration-user','verify_email',?,'owner@example.com',1,0,1,1000)",
    ).run("a".repeat(64));
    const before = db.prepare("SELECT * FROM user_auth_tokens").get();
    db.exec(
      readFileSync("migrations/0057_account_email_registration.sql", "utf8"),
    );
    const after = db.prepare("SELECT * FROM user_auth_tokens").get();
    expect(after).toEqual({ ...before, username_norm: null });
    expect(
      db.prepare("SELECT session_hash FROM login_sessions").get()?.session_hash,
    ).toBe("session-preserved");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
  } finally {
    db.close();
  }
});
