import { it, expect } from "vitest";
import { measuredAccountDatabase } from "@/lib/server/account/metrics";
import type { SqlDatabase, Statement } from "@/lib/server/assistant/database";
it("counts first/all/run/batch metadata without recording SQL values", async () => {
  const statement: Statement = {
    bind() {
      return this;
    },
    async first<T>() {
      return { secret: "not-logged" } as T;
    },
    async all<T>() {
      return {
        results: [{ secret: "not-logged" } as T],
        meta: { rows_read: 2 },
      };
    },
    async run() {
      return { meta: { changes: 1, rows_read: 1, rows_written: 3 } };
    },
  };
  const db: SqlDatabase = {
    prepare: () => statement,
    async batch() {
      return [{ meta: { rows_read: 4, rows_written: 5 } }];
    },
  };
  const m = measuredAccountDatabase(db),
    s = m.database.prepare("ignored SQL").bind("not-logged");
  expect(await s.first()).toEqual({ secret: "not-logged" });
  await s.all();
  await s.run();
  await m.database.batch([s]);
  expect(m.totals).toEqual({ queries: 4, rowsRead: 9, rowsWritten: 8 });
  expect(JSON.stringify(m.totals)).not.toContain("not-logged");
});
