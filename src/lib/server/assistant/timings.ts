import type { SqlDatabase, Statement } from "./database";

// Request-local metadata only: no SQL, bindings, identities, coordinates or prompt text.
export function databaseTimings(
  db: SqlDatabase,
  now = () => performance.now(),
) {
  const statements = new WeakMap<
    Statement,
    { raw: Statement; write: boolean }
  >();
  let readQueries = 0,
    writeQueries = 0,
    calls = 0,
    failures = 0,
    durationMs = 0;
  const samples: number[] = [];
  async function timed<T>(
    work: () => Promise<T>,
    reads: number,
    writes: number,
  ) {
    const start = now();
    calls++;
    readQueries += reads;
    writeQueries += writes;
    try {
      return await work();
    } catch (error) {
      failures++;
      throw error;
    } finally {
      const elapsed = Math.max(0, now() - start);
      durationMs += elapsed;
      if (samples.length < 256) samples.push(elapsed);
    }
  }
  function wrap(raw: Statement, write: boolean): Statement {
    const value: Statement = {
      bind: (...values) => wrap(raw.bind(...values), write),
      first: <T>() => timed(() => raw.first<T>(), write ? 0 : 1, write ? 1 : 0),
      all: <T>() => timed(() => raw.all<T>(), write ? 0 : 1, write ? 1 : 0),
      run: () => timed(() => raw.run(), write ? 0 : 1, write ? 1 : 0),
    };
    statements.set(value, { raw, write });
    return value;
  }
  return {
    db: {
      prepare: (sql: string) =>
        wrap(db.prepare(sql), !/^\s*(?:SELECT|PRAGMA)\b/i.test(sql)),
      batch: (items: Statement[]) => {
        const entries = items.map(
          (item) => statements.get(item) || { raw: item, write: true },
        );
        const writes = entries.filter((item) => item.write).length;
        return timed(
          () => db.batch(entries.map((item) => item.raw)),
          entries.length - writes,
          writes,
        );
      },
    } satisfies SqlDatabase,
    snapshot: () => ({
      readQueries,
      writeQueries,
      calls,
      failures,
      durationMs: Math.round(durationMs * 100) / 100,
      maxCallMs: Math.round(Math.max(0, ...samples) * 100) / 100,
    }),
  };
}
