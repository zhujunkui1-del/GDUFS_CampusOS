import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { SqlDatabase, Statement } from "@/lib/server/assistant/database";

export function sqliteD1(path = ":memory:") {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='assistant_sessions'").get()) for (const file of readdirSync("migrations").filter(file => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync("migrations/" + file, "utf8"));
  const db: SqlDatabase = {
    prepare(sql) {
      let values: (string | number | null)[] = [];
      const statement: Statement = {
        bind(...input) { values = input as typeof values; return statement; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) || null) as T | null; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
      return statement;
    },
    async batch(statements) { sqlite.exec("BEGIN IMMEDIATE"); try { const values = []; for (const statement of statements) values.push(await statement.run()); sqlite.exec("COMMIT"); return values; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } },
    withSession() { return db; },
  };
  return { db, sqlite, close: () => sqlite.close() };
}
