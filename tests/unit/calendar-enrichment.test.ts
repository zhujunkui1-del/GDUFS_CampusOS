import { it, expect, vi } from "vitest";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import {
  enrichCalendar,
  calendarMedia,
} from "@/lib/server/calendar/enrichment";
import { dateGateFixture } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { runCalendarBatch } from "@/lib/server/calendar/processor";
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
it("stops automatic attempts after two and never adds a review gate", async () => {
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
    expect(run.mock.calls.length).toBeLessThanOrEqual(2);
    expect(
      f.sqlite
        .prepare(
          "SELECT calendar_attempts,calendar_status FROM document_article_analysis WHERE document_id=?",
        )
        .get(d.id),
    ).toEqual({ calendar_attempts: 2, calendar_status: "excluded" });
    expect(f.visible()).toContain("spring");
  } finally {
    f.close();
  }
});
