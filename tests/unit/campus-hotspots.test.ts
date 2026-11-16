import { expect, test } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { hotspotAdministration } from "@/lib/server/console/hotspots";
import { readPublicContent } from "@/lib/server/console/public-content";

test("管理员手动添加和撤下热点，雷达保留原有分类与篇数", async () => {
  const { db, actor, visible } = await dateGateFixture();
  const grouped = () =>
    readPublicContent(db, { surface: "radar", grouped: "1" });
  const selected = (q?: string) =>
    readPublicContent(db, {
      surface: "radar",
      category: "campus_hot",
      page: "1",
      q,
    });
  const before = await grouped();
  expect(before.groups?.campus_hot).toEqual([]);
  await expect(
    hotspotAdministration(db, { ...actor, role: "reviewer" }, "POST", "spring"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await hotspotAdministration(db, actor, "POST", "spring");
  await hotspotAdministration(db, actor, "POST", "spring");
  expect(await hotspotAdministration(db, actor, "GET")).toMatchObject({
    items: [{ id: "spring" }],
  });
  expect(await grouped()).toMatchObject({
    total: before.total,
    counts: { campus_hot: 1 },
    groups: { campus_hot: [{ id: "spring" }] },
  });
  expect((await selected("spring")).items).toMatchObject([{ id: "spring" }]);
  expect((await selected("autumn")).items).toEqual([]);
  await hotspotAdministration(db, actor, "DELETE", "spring");
  expect((await grouped()).groups?.campus_hot).toEqual([]);
  expect(visible()).toContain("spring");
});

test("文章下架后从雷达热点隐藏，管理员仍可撤下热点", async () => {
  const { db, actor, gate } = await dateGateFixture();
  await hotspotAdministration(db, actor, "POST", "spring");
  const grouped = () =>
    readPublicContent(db, { surface: "radar", grouped: "1" });
  expect((await grouped()).groups?.campus_hot).toMatchObject([
    { id: "spring" },
  ]);
  await gate("2026-08-01");
  expect((await grouped()).groups?.campus_hot).toEqual([]);
  expect(await hotspotAdministration(db, actor, "GET")).toMatchObject({
    items: [{ id: "spring" }],
  });
  await expect(
    hotspotAdministration(db, actor, "POST", "white"),
  ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await hotspotAdministration(db, actor, "DELETE", "spring");
  expect(await hotspotAdministration(db, actor, "GET")).toEqual({ items: [] });
});
