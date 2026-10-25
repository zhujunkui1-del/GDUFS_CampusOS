import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RegistrationBadge } from "@/features/content/registration-badge";
import { dateGateFixture, command } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { readPublicContent } from "@/lib/server/console/public-content";
import {
  readPublicActivities,
  readPublicAnalysis,
} from "@/lib/server/console/public-analysis";

it("the registration badge uses category theme and an expired deadline does not remove it", () => {
  const html = renderToStaticMarkup(
    createElement(RegistrationBadge, { show: true, category: "competition" }),
  );
  expect(html).toContain(">报</span>");
  expect(html).toContain("--feed-accent");
  expect(html).toContain("article-registration-badge");
  expect(
    renderToStaticMarkup(createElement(RegistrationBadge, { show: false })),
  ).toBe("");
});
it("effective categories preserve public unknown articles and paginate them without campus notice fallback", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: d.title,
        body: d.body,
        bodyFormat: "reading_html",
      }),
    );
    const grouped = await readPublicContent(f.db, {
      surface: "radar",
      grouped: "1",
    });
    expect(grouped.counts.unclassified).toBe(1);
    expect(grouped.groups?.unclassified[0].id).toBe("spring");
    const known = await readPublicContent(f.db, {
      surface: "knowledge",
      grouped: "1",
    });
    expect(known.total).toBe(2);
    expect(
      (
        await readPublicContent(f.db, {
          surface: "radar",
          category: "unclassified",
        })
      ).items[0].primaryDestination,
    ).toBe("unknown");
  } finally {
    f.close();
  }
});
it("indexed activities expose source evidence and disappear immediately on manual withdrawal", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    const input = {
      title: "隔离讲座报名通知",
      body: "讲座时间：2026年11月5日15:00；报名时间：2026年10月1日10:00至2026年11月3日17:00。地点：大学城图书馆。",
      publishedAt: "2026-10-01",
    };
    await f.db.batch(
      await analysisStatements(
        f.db,
        d.id,
        d.contentRevision,
        d.inputHash!,
        input,
      ),
    );
    const r = await readPublicActivities(
      f.db,
      { after: "2026-11-01", before: "2026-11-10", registration: "open" },
      "2026-10-25T12:00:00+08:00",
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].sources[0].originalUrl).toBe(d.url);
    expect(r.items[0].activity.registrationWindows[0].end?.evidence.text).toBe(
      "2026年11月3日17:00",
    );
    await f.store.publish(
      d.id,
      { ...command(d.version), note: "下架测试" },
      true,
    );
    expect(
      (await readPublicActivities(f.db, {}, "2026-10-25T12:00:00+08:00")).items,
    ).toEqual([]);
    await expect(readPublicAnalysis(f.db, d.id)).rejects.toThrow(
      "此文章尚未公开或已下架",
    );
  } finally {
    f.close();
  }
});
it("a warm grouped result rechecks visibility and invalidates counts after a withdrawal", async () => {
  const f = await dateGateFixture();
  try {
    const initial = await readPublicContent(f.db, {
      surface: "knowledge",
      grouped: "1",
    });
    expect(initial.total).toBe(3);
    const warm = await readPublicContent(f.db, {
      surface: "knowledge",
      grouped: "1",
    });
    expect(warm).toEqual(initial);
    const d = await f.store.document("spring");
    await f.store.publish(
      d.id,
      { ...command(d.version), note: "缓存下架核对" },
      true,
    );
    const after = await readPublicContent(f.db, {
      surface: "knowledge",
      grouped: "1",
    });
    expect(after.total).toBe(2);
    expect(after.items.map((d) => d.id)).not.toContain("spring");
  } finally {
    f.close();
  }
});
it("does not merge same-title activities at the same venue on the same day but different times", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "讲座汇总",
        publishedAt: "2026-10-25",
        body: "活动名称：人工智能讲座\n讲座时间：2026年11月5日15:00\n地点：大学城图书馆\n活动名称：人工智能讲座\n讲座时间：2026年11月5日19:00\n地点：大学城图书馆",
      }),
    );
    const results = await readPublicActivities(f.db, {
      after: "2026-11-05",
      before: "2026-11-05",
    });
    expect(results.items).toHaveLength(2);
  } finally {
    f.close();
  }
});
