import { it, expect, vi } from "vitest";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import {
  enrichCalendar,
  calendarMedia,
} from "@/lib/server/calendar/enrichment";
import { dateGateFixture } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import {
  runCalendarBatch,
  reserveCalendarModel,
} from "@/lib/server/calendar/processor";
it("defers work when the daily model budget ends without consuming an extraction attempt", async () => {
  const input = {
    title: "2026年学术讲座预告",
    body: "详情见海报，11月5日14:00。",
  };
  const a = await enrichCalendar(
    input,
    analyzeArticle(input),
    { run: vi.fn() },
    async () => false,
  );
  expect(a.metrics.modelCalls).toBe(0);
  expect(a.analysis.calendar?.attempts).toBe(0);
  expect(a.analysis.calendar?.status).toBe("needs_enrichment");
  expect(a.analysis.calendar?.reason).toBe("daily_budget_deferred");
});
it("supplements real source spans through a schema, without accepting invented years", async () => {
  const input = {
    title: "2026年学术讲座预告",
    body: "欢迎参加学术讲座。\n2026年11月5日14:30\n大学城校区报告厅",
    publishedAt: "2026-10-30",
  };
  const run = vi.fn(async () => ({
    response: {
      events: [
        {
          title: input.title,
          sourceId: "body",
          occurrenceQuote: "2026年11月5日14:30",
          dates: ["2026年11月5日14:30"],
          place: "大学城校区报告厅",
          organizer: null,
          nature: "announcement",
        },
      ],
    },
    usage: { prompt_tokens: 100, completion_tokens: 80 },
  }));
  const reserve = vi.fn(async () => true);
  const r = await enrichCalendar(
    input,
    analyzeArticle(input),
    { run },
    reserve,
  );
  expect(
    r.analysis.activities.find((a) => a.calendar?.eligible)?.startsAt?.date,
  ).toBe("2026-11-05");
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0]).toBeDefined();
  expect(r.metrics.modelCalls).toBe(1);
  const unknown = { ...input, title: "学术讲座预告", body: "11月5日14:30" };
  const bad = await enrichCalendar(
    unknown,
    analyzeArticle(unknown),
    {
      run: async () => ({
        response: {
          events: [
            {
              title: unknown.title,
              sourceId: "body",
              occurrenceQuote: unknown.body,
              dates: ["2026年11月5日14:30"],
              place: null,
              organizer: null,
              nature: "announcement",
            },
          ],
        },
      }),
    },
    async () => true,
  );
  expect(bad.analysis.activities.some((a) => a.calendar?.eligible)).toBe(false);
});
it("OCR keeps a real media reference and byte digest; it does not overwrite reading HTML", async () => {
  const input = {
    title: "2026年学术讲座预告",
    bodyFormat: "reading_html" as const,
    body: '<p>详情见海报</p><img src="https://lib.gdufs.edu.cn/poster.png">',
  };
  const run = vi.fn(async () => ({
    response: {
      text: "讲座时间：2026年11月5日14:30。地点：大学城校区报告厅。",
      unreadable: false,
    },
  }));
  const fetcher = vi.fn(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Content-Type": "image/png" },
      }),
  );
  const r = await enrichCalendar(
    input,
    analyzeArticle(input),
    { run },
    async () => true,
    fetcher,
  );
  expect(r.input.body).toBe(input.body);
  expect(r.metrics.ocrCalls).toBe(1);
  expect(r.analysis.calendar?.sources[0].digest).toMatch(/^[a-f0-9]{64}$/);
  expect(r.analysis.activities.some((a) => a.calendar?.eligible)).toBe(true);
  expect(
    r.analysis.activities.find((a) => a.calendar?.eligible)?.calendar
      ?.origins[0].url,
  ).toBe("https://lib.gdufs.edu.cn/poster.png");
});
it("does not promote registration or publication dates proposed as event dates", async () => {
  const input = {
    title: "2026年讲座报名通知",
    body: "报名截止：2026年11月3日。讲座详情稍后发布。",
  };
  const r = await enrichCalendar(
    input,
    analyzeArticle(input),
    {
      run: async () => ({
        response: {
          events: [
            {
              title: input.title,
              sourceId: "body",
              occurrenceQuote: "2026年11月3日",
              dates: ["2026年11月3日"],
              place: null,
              organizer: null,
              nature: "announcement",
            },
          ],
        },
      }),
    },
    async () => true,
  );
  expect(r.analysis.activities.some((a) => a.calendar?.eligible)).toBe(false);
});
it("bounds input media and refuses non-public destinations before any fetch", async () => {
  const input = {
    title: "讲座",
    bodyFormat: "reading_html" as const,
    body: '<img src="http://127.0.0.1/x"><img src="https://example.invalid/x"><img src="https://lib.gdufs.edu.cn/logo.png"><img src="https://mmbiz.qpic.cn/poster">',
  };
  expect(calendarMedia(input)).toEqual([
    { kind: "image", url: "https://mmbiz.qpic.cn/poster", locator: "img[4]" },
  ]);
});
it("stops automatic attempts after three and never adds a review gate", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring"),
      input = { title: "2026年讲座预告", body: "详情见海报。" };
    await f.db.batch(
      await analysisStatements(
        f.db,
        d.id,
        d.contentRevision,
        d.inputHash!,
        input,
      ),
    );
    f.sqlite
      .prepare(
        "UPDATE document_article_analysis SET calendar_status='needs_enrichment' WHERE document_id=?",
      )
      .run(d.id);
    const run = vi.fn(async () => ({ response: { events: [] } }));
    await runCalendarBatch(f.db, { run });
    await runCalendarBatch(f.db, { run });
    await runCalendarBatch(f.db, { run });
    // A thrown step is a transient fault, not a verdict: one bad minute must
    // not park the row forever, so it takes three consecutive failures.
    await runCalendarBatch(f.db, { run });
    expect(run.mock.calls.length).toBeLessThanOrEqual(3);
    expect(
      f.sqlite
        .prepare(
          "SELECT calendar_attempts,calendar_status FROM document_article_analysis WHERE document_id=?",
        )
        .get(d.id),
    ).toEqual({ calendar_attempts: 3, calendar_status: "excluded" });
    expect(f.visible()).toContain("spring");
  } finally {
    f.close();
  }
});

it("spends the daily budget on the newest articles first", async () => {
  const f = await dateGateFixture();
  try {
    const ids = await Promise.all(
      ["spring", "autumn", "white"].map((id) => f.store.document(id)),
    );
    for (const d of ids) {
      await f.db.batch(
        await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
          title: "2026年讲座预告",
          body: "详情见海报。",
        }),
      );
    }
    f.sqlite
      .prepare(
        "UPDATE document_article_analysis SET calendar_status='needs_enrichment'",
      )
      .run();
    // The fixture publishes spring (2026-04), autumn (2026-10) and white
    // (2026-02). Only autumn is inside the recent window, so it is the one
    // worth spending model calls on; the older two are usually reviews of
    // something that already happened.
    const run = vi.fn(async () => ({ response: { events: [] } }));
    await runCalendarBatch(f.db, { run });
    const touched = f.sqlite
      .prepare(
        "SELECT document_id FROM document_article_analysis WHERE calendar_attempts>0 OR calendar_lease_until_ms>0 ORDER BY document_id",
      )
      .all()
      .map((r) => (r as { document_id: string }).document_id);
    expect(touched).toContain("autumn");
    expect(touched).not.toContain("white");
  } finally {
    f.close();
  }
});
it("honours the operator cap instead of a hard-coded 40", async () => {
  const f = await dateGateFixture();
  try {
    f.sqlite
      .prepare(
        "UPDATE console_engine_settings SET calendar_ai_day='2026-11-10',calendar_ai_calls=5,calendar_ai_cap=5",
      )
      .run();
    expect(await reserveCalendarModel(f.db, "2026-11-10T00:00:00.000Z")).toBe(
      false,
    );
    f.sqlite
      .prepare(
        "UPDATE console_engine_settings SET calendar_ai_calls=0,calendar_ai_cap=200",
      )
      .run();
    expect(await reserveCalendarModel(f.db, "2026-11-10T00:00:00.000Z")).toBe(
      true,
    );
  } finally {
    f.close();
  }
});
