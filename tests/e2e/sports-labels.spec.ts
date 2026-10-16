import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import review from "../../src/features/campus-map/data/owner-sports-label-review.json" with { type: "json" };

test("sports labels use six owner-selected anchors and hide unverified tags", async ({
  page,
}, info) => {
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60000 },
  );
  for (const group of review.groups) {
    await expect(
      page.locator(`.campus-marker[data-place-id="${group.anchorId}"]`),
    ).toHaveCount(1);
    for (const id of group.memberIds.filter((id) => id !== group.anchorId))
      await expect(
        page.locator(`.campus-marker[data-place-id="${id}"]`),
      ).toHaveCount(0);
  }
  for (const id of review.hiddenLabelIds)
    await expect(
      page.locator(`.campus-marker[data-place-id="${id}"]`),
    ).toHaveCount(0);
  await expect(
    page.locator('.campus-marker[aria-label="查看篮球场"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('.campus-marker[aria-label="查看游泳馆"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.campus-marker[aria-label="查看游泳场地"]'),
  ).toHaveCount(0);
  const search = page.getByLabel("搜索校园地点");
  await search.fill("篮球场");
  await expect(page.locator(".map-search-results .place-result")).toHaveCount(
    2,
  );
  const dir = process.env.E2E_CAPTURE_DIR || "test-results/sports-labels";
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-sports.png`,
  });
  await page.locator(".map-search-results .place-result").first().click();
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-sports-south.png`,
  });
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await search.fill("游泳馆");
  await page.locator(".map-search-results .place-result").first().click();
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-sports-north.png`,
  });
});
