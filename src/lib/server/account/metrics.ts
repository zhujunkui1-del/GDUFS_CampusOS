import type { SqlDatabase, Statement } from "../assistant/database";
// Count metadata only; never record SQL, bind values, identities or credentials.
export function measuredAccountDatabase(db: SqlDatabase) {
  const totals = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const raw = new WeakMap<Statement, Statement>();
  function add(result: unknown) {
    const meta = (
      result as { meta?: { rows_read?: number; rows_written?: number } }
    )?.meta;
    totals.queries++;
    totals.rowsRead += meta?.rows_read || 0;
    totals.rowsWritten += meta?.rows_written || 0;
  }
  function wrap(statement: Statement): Statement {
    const item: Statement = {
      bind(...values) {
        return wrap(statement.bind(...values));
      },
      async first<T>() {
        const r = await statement.all<T>();
        add(r);
        return r.results[0] || null;
      },
      async all<T>() {
        const r = await statement.all<T>();
        add(r);
        return r;
      },
      async run() {
        const r = await statement.run();
        add(r);
        return r;
      },
    };
    raw.set(item, statement);
    return item;
  }
  const database: SqlDatabase = {
    prepare: (sql) => wrap(db.prepare(sql)),
    async batch(statements) {
      const r = await db.batch(statements.map((s) => raw.get(s) || s));
      r.forEach(add);
      return r;
    },
  };
  return { database, totals };
}
