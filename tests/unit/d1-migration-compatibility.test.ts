import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

it("keeps CASE expressions parenthesized in D1 admission/capacity triggers", () => {
  // Cloud D1 /query rejects bare SELECT CASE ... END in CREATE TRIGGER,
  // although local SQLite accepts it. The cloud EXPLAIN pair is archived in S2-E.
  const sql = readFileSync(
    "migrations/0004_assistant_shared_state.sql",
    "utf8",
  );
  expect(sql).not.toMatch(/SELECT\s+CASE\s+WHEN/i);
  expect(sql.match(/SELECT\s+\(CASE\s+WHEN/gi)).toHaveLength(12);
  expect(sql).toContain(">=200 THEN RAISE(ABORT,'AGENT_SITE_QUOTA')");
  expect(sql).toContain(">5000000 THEN RAISE(ABORT,'AGENT_SITE_TOKEN_QUOTA')");
});
