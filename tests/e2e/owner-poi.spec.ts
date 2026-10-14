import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const review: { points: { name: string }[] } = JSON.parse(
  await readFile("src/features/campus-map/data/owner-poi-review.json", "utf8"),
);

test("owner gate labels, renamed places and North 1 recharge point are searchable", async ({
  page,
}, info) => {
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  for (const name of [
    ...review.points.map((p) => p.name),
    "B8学术报告厅",
    "又康超市",
  ]) {
    await page.getByLabel("搜索校园地点", { exact: true }).fill(name);
    await page.locator(".place-result").filter({ hasText: name }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(map).toHaveAttribute("data-camera-moving", "false");
    await expect(
      page.getByRole("button", { name: "查看" + name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "关闭地点详情", exact: true })
      .click();
  }
  await page.getByLabel("搜索校园地点", { exact: true }).fill("水电冷充值点");
  await page
    .locator(".place-result")
    .filter({ hasText: "大学城校区水电冷充值点" })
    .click();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await expect(
    page.getByRole("heading", { name: "大学城校区水电冷充值点", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.campus-marker[data-place-id="owner-utilities-recharge"]'),
  ).toBeVisible();
  const dir = process.env.E2E_CAPTURE_DIR || "docs/screenshots/s1/owner-poi";
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}-recharge.png`,
  });
});
