import { it, expect } from "vitest";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { upcomingEvents } from "@/lib/server/assistant/upcoming-events";
import { dateGateFixture } from "../fixtures/date-gate";

const NOW = Date.parse("2026-11-21T00:00:00+08:00");
const SAMPLES = [
  [
    "open-far",
    "开放报名活动",
    "活动时间：2026年12月30日。地点：大学城校区。报名开始：2026年11月1日。报名截止：2026年12月10日。",
  ],
  [
    "walk-in",
    "无需报名活动",
    "活动时间：2026年11月26日。地点：大学城校区。无需报名，直接参加。",
  ],
  [
    "closed",
    "已截止活动",
    "活动时间：2026年11月26日。地点：大学城校区。报名截止：2026年11月1日。",
  ],
  [
    "not-started",
    "未开放活动",
    "活动时间：2026年12月2日。地点：大学城校区。报名开始：2026年12月1日。",
  ],
  [
    "unknown-reg",
    "报名未知活动",
    "活动时间：2026年11月27日。地点：大学城校区。",
  ],
  [
    "exhibition",
    "多日展览",
    "活动时间：2026年11月24日至12月25日。地点：大学城校区图书馆。",
  ],
  [
    "ended",
    "已结束活动",
    "活动时间：2026年10月1日。地点：大学城校区。无需报名。",
  ],
  [
    "notice",
    "广外停课通知",
    "活动时间：2026年11月21日。地点：大学城校区。",
  ],
  [
    "cfp",
    "征文启事 | 第七届国际商务论坛征文通知",
    "活动时间：2026年11月22日。地点：白云山校区。",
  ],
] as const;

async function fixture() {
  const f = await dateGateFixture();
  for (const [id, title, body] of SAMPLES) {
    await f.article(id, "2026-11-20", title, body);
    const d = await f.store.document(id);
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title,
        body,
      }),
    );
  }
  return f;
}

it("distinguishes open, walk-in, mixed, unknown and unrestricted registration questions", async () => {
  const f = await fixture();
  try {
    const open = await upcomingEvents(f.db, "最近有什么可以报名的活动", undefined, NOW);
    expect(open?.text).toContain("开放报名活动");
    expect(open?.text).toContain("报名中");
    expect(open?.text).not.toContain("无需报名活动");
    expect(open?.text).not.toContain("已截止活动");
    // The event is 39 days out; the registration deadline is what makes it
    // discoverable, so the event-date window must not hide it.
    expect(open?.text).toContain("2026-12-30");

    const walkIn = await upcomingEvents(
      f.db,
      "最近有什么不用报名就能参加的活动",
      undefined,
      NOW,
    );
    expect(walkIn?.text).toContain("无需报名活动");
    expect(walkIn?.text).toContain("无需报名");
    expect(walkIn?.text).not.toContain("开放报名活动");

    const mixed = await upcomingEvents(
      f.db,
      "最近有什么可以报名或不用报名就可以参加的活动",
      undefined,
      NOW,
    );
    expect(mixed?.text).toContain("正在报名和无需报名");
    expect(mixed?.text).toContain("开放报名活动");
    expect(mixed?.text).toContain("无需报名活动");

    const any = await upcomingEvents(
      f.db,
      "最近有什么活动可以参加",
      undefined,
      NOW,
    );
    expect(any?.text).toContain("多日展览");
    expect(any?.text).toContain("报名未知活动");
    expect(any?.text).not.toContain("已截止活动");
    expect(any?.text).not.toContain("已结束活动");
    expect(any?.text).not.toContain("停课通知");
    expect(any?.text).not.toContain("征文启事");

    const unknown = await upcomingEvents(
      f.db,
      "最近有什么活动，报名要求不确定的也列出来",
      undefined,
      NOW,
    );
    expect(unknown?.text).toContain("报名未知活动");
    expect(unknown?.text).toContain("报名要求未注明");
    expect(unknown?.text).toContain("无需报名活动");

    const more = await upcomingEvents(f.db, "还有其他活动吗", undefined, NOW);
    expect(more?.text).toContain("多日展览");
    expect(more?.cards.length).toBeGreaterThan(0);
  } finally {
    f.close();
  }
});

it("does not call an expired registration open, and says why a list can be empty", async () => {
  const f = await fixture();
  try {
    const all = await upcomingEvents(f.db, "最近有什么活动", undefined, NOW);
    expect(all?.text).toContain("已截止活动 · 2026-11-26");
    expect(all?.text).toContain("报名已截止");
    expect(all?.text).not.toContain("已截止活动 · 2026-11-26 · 报名中");

    const none = await upcomingEvents(
      f.db,
      "最近有什么可以报名的活动",
      undefined,
      Date.parse("2026-12-15T00:00:00+08:00"),
    );
    expect(none?.text).toContain("没有找到");
    expect(none?.text).toContain("不代表学校没有此类活动");
  } finally {
    f.close();
  }
});
