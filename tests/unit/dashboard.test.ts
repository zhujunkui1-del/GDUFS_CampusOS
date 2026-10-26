import { it, expect, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { recordVisits, trafficSummary } from "@/lib/server/console/traffic";
import {
  sourceControl,
  finishSourceControl,
  sourceSessionSnapshot,
  saveSessionState,
} from "@/lib/server/console/source-session";
import { claimRelay, finishRelay } from "@/lib/server/external-search/relay";
import { RelayInputSchema } from "@/domain/retrieval/relay";
import { SourceSessionResultSchema } from "@/domain/console/dashboard";
it("counts each anonymous batch once and uses indexed bounded daily and expiry queries", async () => {
  const f = sqliteD1();
  try {
    const id = crypto.randomUUID();
    await Promise.all([
      recordVisits(f.db, { id, views: 3 }),
      recordVisits(f.db, { id, views: 3 }),
    ]);
    await recordVisits(f.db, { id: crypto.randomUUID(), views: 2 });
    const data = await trafficSummary(f.db);
    expect([data.today, data.last7, data.last30, data.total]).toEqual([
      5, 5, 5, 5,
    ]);
    expect(data.days).toHaveLength(30);
    expect(data.days.slice(0, -1).every((d) => d.views === null)).toBe(true);
    expect(
      Object.keys(
        f.sqlite.prepare("SELECT * FROM site_visit_batches LIMIT 1").get()!,
      ),
    ).toEqual(["id", "views", "received_at_ms"]);
    for (const sql of [
      "SELECT day,views FROM site_visit_days WHERE day>='2026-01-01' AND day<='2026-10-26' ORDER BY day",
      "SELECT id FROM site_visit_batches WHERE received_at_ms<1 ORDER BY received_at_ms LIMIT 64",
    ])
      expect(
        f.sqlite
          .prepare("EXPLAIN QUERY PLAN " + sql)
          .all()
          .map((r) => r.detail)
          .join(" "),
      ).toMatch(/USING INDEX/);
    await expect(recordVisits(f.db, { id, views: 21 })).rejects.toThrow();
    await expect(
      recordVisits(f.db, { id, views: 1, ip: "not-collected" }),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
it("separates 7 and 30 day windows, cumulative totals, and genuinely untracked days", async () => {
  const f = sqliteD1();
  try {
    f.sqlite
      .prepare("UPDATE site_visit_settings SET started_at_ms=?")
      .run(Date.parse("2026-09-01T00:00:00+08:00"));
    const s = f.sqlite.prepare("INSERT INTO site_visit_days VALUES(?,?,?)");
    s.run("2026-09-10", 7, 7);
    s.run("2026-10-01", 10, 17);
    s.run("2026-10-20", 3, 20);
    s.run("2026-10-26", 2, 22);
    const d = await trafficSummary(
      f.db,
      Date.parse("2026-10-26T23:59:00+08:00"),
    );
    expect([d.today, d.last7, d.last30, d.total]).toEqual([2, 5, 15, 22]);
    expect(d.days.at(-1)?.day).toBe("2026-10-26");
    expect(d.days.filter((x) => x.views === 0).length).toBe(27);
  } finally {
    f.close();
  }
});
it("admin login control stays separate from public search and persists only non-secret status", async () => {
  const f = sqliteD1(),
    runner = crypto.randomUUID();
  try {
    const pending = sourceControl(f.db, "admin-test", {
      kind: "session_control",
      action: "login",
    });
    const claimed = await claimRelay(f.db, runner, 0);
    expect(claimed.work).toMatchObject({ control: { action: "login" } });
    const id = claimed.work!.id;
    const result = {
      state: "login_required",
      checkedAt: Date.now(),
      qr: "data:image/png;base64,aGVsbG8=",
      qrExpiresAt: Date.now() + 100000,
    };
    await expect(
      finishSourceControl(f.db, id, crypto.randomUUID(), result),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      finishRelay(f.db, id, runner, {
        provider: "x",
        status: "empty",
        items: [],
        durationMs: 1,
      }),
    ).rejects.toThrow();
    await finishSourceControl(f.db, id, runner, result);
    expect(await pending).toMatchObject(result);
    expect(await sourceSessionSnapshot(f.db)).toMatchObject({
      state: "login_required",
      qr: null,
    });
    expect(
      f.sqlite
        .prepare("SELECT count(*) n FROM agent_external_search_jobs")
        .get()?.n,
    ).toBe(0);
    await saveSessionState(f.db, {
      state: "logged_in",
      checkedAt: Date.now(),
      qr: null,
      qrExpiresAt: null,
    });
    expect((await sourceSessionSnapshot(f.db)).state).toBe("logged_in");
    expect(
      RelayInputSchema.safeParse({ kind: "session_control", action: "login" })
        .success,
    ).toBe(false);
    expect(
      SourceSessionResultSchema.safeParse({ ...result, state: "logged_in" })
        .success,
    ).toBe(false);
    await expect(
      saveSessionState(f.db, { ...result, checkedAt: Date.now() - 120000 }),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
it("missing runner is unavailable rather than logged out and temporary jobs are removed", async () => {
  const f = sqliteD1();
  vi.useFakeTimers();
  try {
    const pending = sourceControl(f.db, "owner", {
      kind: "session_control",
      action: "status",
    });
    await vi.advanceTimersByTimeAsync(27000);
    expect(await pending).toMatchObject({
      state: "unavailable",
      reason: "runner_offline",
      qr: null,
    });
    expect((await sourceSessionSnapshot(f.db)).checkedAt).toBeNull();
    expect(
      f.sqlite
        .prepare("SELECT count(*) n FROM agent_external_search_jobs")
        .get()?.n,
    ).toBe(0);
  } finally {
    vi.useRealTimers();
    f.close();
  }
});
