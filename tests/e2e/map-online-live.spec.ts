import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test("controlled real online services on the fixed local map", async ({
  page,
  isMobile,
}) => {
  test.skip(
    process.env.CAMPUS_LIVE_SERVICES !== "1" || isMobile,
    "Explicit controlled provider integration only",
  );
  test.setTimeout(90000);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await page
    .getByRole("button", { name: "查询高德在线地点", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "查询高德在线地点", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  expect(await page.locator(".place-result").count()).toBeGreaterThan(1);
  const error = page.locator(".map-search-results .inline-error");
  await expect(error).toHaveCount(0);
  await page
    .locator(".place-result")
    .filter({ hasText: "图书馆" })
    .first()
    .click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await page.getByRole("button", { name: "切换为2D", exact: true }).click();
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page.getByLabel("导航起点").fill("图书馆");
  await page
    .getByRole("region", { name: "起点地点建议" })
    .getByRole("button", { name: /图书馆/ })
    .click();
  await page.getByLabel("导航终点").fill("教学楼D栋");
  await page
    .getByRole("region", { name: "终点地点建议" })
    .getByRole("button", { name: /教学楼D栋/ })
    .click();
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible({ timeout: 30000 });
  const dir = "docs/screenshots/s1/map-feedback";
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/local-map-real-online-route.jpg`,
    type: "jpeg",
  });
  await writeFile(
    `${dir}/real-online-service-result.json`,
    JSON.stringify(
      {
        source:
          "real AMap PlaceSearch + actual local CampusOS route, user-triggered only",
        mocks: false,
        routeSummary: await page.locator(".route-result").innerText(),
        condition:
          "typed library -> teaching building D; actual supplier path to nearby roads; current access / entrances not field verified",
      },
      null,
      2,
    ) + "\n",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const raw = await page
        .getByTestId("campus-map")
        .getAttribute("data-route-extent");
      const panel = await page.locator(".route-planner").boundingBox();
      if (!raw || !panel) return false;
      const [left, top, right, bottom] = JSON.parse(raw);
      return left >= 0 && top >= 0 && right <= 390 && bottom < panel.y;
    })
    .toBe(true);
  await page.screenshot({
    path: `${dir}/mobile-real-online-route.jpg`,
    type: "jpeg",
  });
});
