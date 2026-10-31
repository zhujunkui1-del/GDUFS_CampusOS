import { sqliteD1 } from "./sqlite-d1";
import type { SqlDatabase, Statement } from "@/lib/server/assistant/database";
import { AccountService } from "@/lib/server/account/email";
import type { MailMessage } from "@/lib/server/account/store";
import { tokenHash } from "@/lib/server/assistant/crypto";
export function accountFixture(mailAvailable = true) {
  const f = sqliteD1(),
    meta = new WeakMap<Statement, { sql: string; args: unknown[] }>();
  // Execute each batch synchronously in one SQLite transaction, like D1's atomic batch.
  const db: SqlDatabase = {
    prepare(sql) {
      const item = { sql, args: [] as unknown[] };
      const s: Statement = {
        bind(...args) {
          item.args = args;
          return s;
        },
        async first<T>() {
          return (f.sqlite.prepare(sql).get(...(item.args as never[])) ||
            null) as T | null;
        },
        async all<T>() {
          return {
            results: f.sqlite
              .prepare(sql)
              .all(...(item.args as never[])) as T[],
          };
        },
        async run() {
          return {
            meta: {
              changes: Number(
                f.sqlite.prepare(sql).run(...(item.args as never[])).changes,
              ),
            },
          };
        },
      };
      meta.set(s, item);
      return s;
    },
    async batch(statements) {
      f.sqlite.exec("BEGIN IMMEDIATE");
      try {
        const r = statements.map((s) => {
          const m = meta.get(s)!;
          return {
            meta: {
              changes: Number(
                f.sqlite.prepare(m.sql).run(...(m.args as never[])).changes,
              ),
            },
          };
        });
        f.sqlite.exec("COMMIT");
        return r;
      } catch (e) {
        f.sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  let now = Date.parse("2026-10-31T08:00:00Z");
  const sent: MailMessage[] = [];
  const store = new AccountService(db, {
    origin: "https://campus.example",
    otpSecret: "isolated-fixture-secret-".repeat(3),
    now: () => now,
    passwords: {
      hash: async (p) => "isolated:" + (await tokenHash(p)),
      verify: async (p, h) => h === "isolated:" + (await tokenHash(p)),
      check: async () => {},
    },
    mailer: {
      available: mailAvailable,
      async send(message) {
        sent.push(message);
      },
    },
  });
  const request = (token?: string) =>
    new Request("https://campus.example/api/me", {
      headers: { ...(token ? { Cookie: "campusos_session=" + token } : {}) },
    });
  const register = (username: string, email?: string) =>
    store.register(
      {
        username,
        password: "Fixture-Password-Only",
        ...(email ? { email } : {}),
      },
      request(),
      username,
    );
  return {
    ...f,
    db,
    store,
    sent,
    request,
    register,
    advance: (ms: number) => {
      now += ms;
    },
    lastCode: () => {
      const message = sent.filter((m) => m.purpose === "code").at(-1);
      if (!message || message.purpose !== "code")
        throw Error("No fixture mail");
      return message.code;
    },
  };
}
