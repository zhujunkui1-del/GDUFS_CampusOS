import { it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import {
  claimRelay,
  finishRelay,
  createDbRelay,
} from "@/lib/server/external-search/relay";
import { RelayInputSchema } from "@/domain/retrieval/relay";
const input = RelayInputSchema.parse({
  kind: "web",
  query: "广外借阅规则",
  limit: 2,
  policy: { intent: "official", officialOnly: true, campus: true },
  onlyXhs: false,
});
const runner = "11111111-1111-4111-8111-111111111111";
const result = {
  provider: "exa_web_local",
  status: "ok" as const,
  items: [
    {
      title: "隔离规则样本",
      originalUrl: "https://lib.gdufs.edu.cn/rule",
      sourceName: "广外官方网页",
      platform: "web" as const,
      authority: "official" as const,
      evidenceKind: "search_excerpt" as const,
      snippet: "隔离测试证据",
      publishedAt: null,
      retrievedAt: "2026-10-26T00:00:00Z",
      searchMode: "web" as const,
      canConfirmAdministrativeFacts: false,
    },
  ],
  durationMs: 10,
};
function add(
  db: ReturnType<typeof sqliteD1>,
  id: string,
  expires = Date.now() + 30000,
) {
  db.sqlite
    .prepare(
      "INSERT INTO agent_external_search_jobs(id,owner_key,input_json,state,created_at_ms,expires_at_ms) VALUES(?,?,?,'pending',?,?)",
    )
    .run(id, "owned", JSON.stringify(input), Date.now(), expires);
}
it("claims exactly one pending request and rejects other runners and altered official scope", async () => {
  const f = sqliteD1();
  try {
    const id = crypto.randomUUID();
    add(f, id);
    const claimed = await claimRelay(f.db, runner, 0);
    expect(claimed.work?.id).toBe(id);
    expect((await claimRelay(f.db, runner, 0)).work).toBeNull();
    await expect(
      finishRelay(f.db, id, crypto.randomUUID(), result),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      finishRelay(f.db, id, runner, {
        ...result,
        items: [
          { ...result.items[0], originalUrl: "https://example.test/rule" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect((await finishRelay(f.db, id, runner, result)).accepted).toBe(true);
    expect((await finishRelay(f.db, id, runner, result)).accepted).toBe(true);
    await expect(
      finishRelay(f.db, id, runner, { ...result, durationMs: 11 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    f.close();
  }
});
it("a real relay round trip uses one document identity and deletes its temporary payload", async () => {
  const f = sqliteD1();
  try {
    const pending = createDbRelay(f.db, "guest-one")(
      input,
      AbortSignal.timeout(3000),
    );
    const work = await claimRelay(f.db, runner, 0);
    expect(work.work).not.toBeNull();
    await finishRelay(f.db, work.work!.id, runner, result);
    const output = await pending;
    expect(output.status).toBe("ok");
    expect(output.items).toEqual(result.items);
    expect(output.relayUsage?.queries).toBeGreaterThan(2);
    expect(
      f.sqlite
        .prepare("SELECT count(*) AS n FROM agent_external_search_jobs")
        .get()?.n,
    ).toBe(0);
  } finally {
    f.close();
  }
});
it("expired and cancelled requests cannot later publish a result", async () => {
  const f = sqliteD1();
  try {
    const id = crypto.randomUUID();
    add(f, id, Date.now() - 1000);
    expect((await claimRelay(f.db, runner, 0)).work).toBeNull();
    await expect(finishRelay(f.db, id, runner, result)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const stopped = new AbortController();
    stopped.abort();
    const stoppedResult = await createDbRelay(f.db, "guest-one")(
      input,
      stopped.signal,
    );
    expect(stoppedResult.relayUsage?.queries).toBe(0);
    const cancel = new AbortController();
    const pending = createDbRelay(f.db, "guest-one")(input, cancel.signal);
    cancel.abort();
    expect((await pending).status).toBe("unavailable");
    expect(
      f.sqlite
        .prepare("SELECT count(*) AS n FROM agent_external_search_jobs")
        .get()?.n,
    ).toBe(0);
  } finally {
    f.close();
  }
});
it("pending pickup and expiry cleanup use bounded indexes", () => {
  const f = sqliteD1();
  try {
    const plans = f.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM agent_external_search_jobs INDEXED BY idx_external_search_pending WHERE state='pending' AND expires_at_ms>? ORDER BY created_at_ms,id LIMIT 1",
      )
      .all(Date.now());
    expect(JSON.stringify(plans)).toContain("idx_external_search_pending");
    const expiry = f.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM agent_external_search_jobs INDEXED BY idx_external_search_expiry WHERE expires_at_ms<? ORDER BY expires_at_ms LIMIT 20",
      )
      .all(Date.now());
    expect(JSON.stringify(expiry)).toContain("idx_external_search_expiry");
  } finally {
    f.close();
  }
});
