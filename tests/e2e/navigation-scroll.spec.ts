import { test, expect } from "@playwright/test";

test("navigation scrolls inside a fixed frame and keeps its close button visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 608, height: 440 });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page.getByLabel("导航起点", { exact: true }).fill("教学");
  const frame = page.locator(".route-planner");
  const scroll = page.locator(".route-planner-scroll");
  await expect(frame).toHaveCSS("overflow-y", "clip");
  await expect(scroll).toHaveCSS("overflow-y", "auto");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(0);
  const close = page.getByRole("button", { name: "关闭导航面板", exact: true });
  const before = await close.boundingBox();
  await page
    .getByRole("button", { name: "在地图上选择终点", exact: true })
    .press("End");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const after = await close.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  expect(
    await frame.evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThan(2);
  await close.click();
  await expect(frame).toHaveCount(0);
});
