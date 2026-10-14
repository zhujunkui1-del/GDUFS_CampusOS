import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

async function focusDorm(page: Page) {
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
  await expect(
    page.getByRole("button", { name: "关闭地点详情" }),
  ).toBeVisible();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await expect(page.locator(".place-details-frame")).toHaveCount(0);
  return map;
}

test("South 7 native 2.5D and lazy 3D keep their geography and label semantics", async ({
  page,
}, info) => {
  const errors: string[] = [],
    assets: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".glb")) assets.push(r.url());
  });
  const map = await focusDorm(page);
  await page.getByLabel("搜索校园地点").focus();
  await expect(page.locator(".map-search-results")).toHaveCount(0);
  await page.getByLabel("搜索校园地点").press("ArrowDown");
  await expect(page.locator(".map-search-results")).toBeVisible();
  await page.getByLabel("搜索校园地点").press("Escape");
  await expect(page.locator(".map-search-results")).toHaveCount(0);
  await expect(map).toHaveAttribute("data-model-height", "21");
  await expect(map).toHaveAttribute("data-model-volume", "visible");
  expect(assets).toHaveLength(0);
  const dir =
    process.env.E2E_CAPTURE_DIR || "docs/screenshots/s1/nanyuan7-model";
  await mkdir(dir, { recursive: true });
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  await page.getByRole("button", { name: "切换为2D", exact: true }).click();
  await expect(map).toHaveAttribute("data-model-volume", "none");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-2d.png` });
  await page.getByRole("button", { name: "切换为2.5D", exact: true }).click();
  await expect(map).toHaveAttribute("data-model-volume", "visible");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-2.5d.png` });
  await page.getByRole("button", { name: "切换为3D", exact: true }).click();
  await expect(map).toHaveAttribute("data-model-state", "ready", {
    timeout: 30000,
  });
  await expect(map).toHaveAttribute("data-model-detailed", "visible");
  await expect
    .poll(async () => Number(await map.getAttribute("data-model-frame-count")))
    .toBeGreaterThan(0);
  await expect(map).toHaveAttribute("data-model-volume", "none");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  expect(assets).toHaveLength(1);
  const lod = info.project.name === "mobile" ? "low" : "full";
  await expect(map).toHaveAttribute("data-model-lod", lod);
  expect(Number(await map.getAttribute("data-model-bytes"))).toBeLessThan(
    200 * 1024,
  );
  const extent = JSON.parse((await map.getAttribute("data-model-extent"))!);
  expect(extent[0]).toBeGreaterThanOrEqual(0);
  expect(extent[1]).toBeGreaterThanOrEqual(0);
  expect(extent[2]).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(extent[3]).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: `${dir}/${name}-3d.png` });
  await writeFile(
    `${dir}/${name}-evidence.json`,
    JSON.stringify(
      await map.evaluate((el) => ({
        viewport: [innerWidth, innerHeight],
        devicePixelRatio,
        mode: el.dataset.mode,
        mapVersion: el.dataset.mapVersion,
        modelVersion: el.dataset.modelVersion,
        height: el.dataset.modelHeight,
        lod: el.dataset.modelLod,
        bytes: el.dataset.modelBytes,
        triangles: el.dataset.modelTriangles,
        drawCalls: el.dataset.modelDrawCalls,
        extent: el.dataset.modelExtent,
        cameraDuration: el.dataset.lastCameraDuration,
        actualPhone: false,
      })),
      null,
      2,
    ),
  );
  const pickedBefore = Number(await map.getAttribute("data-model-pick-count"));
  await page.mouse.click((extent[0] + extent[2]) / 2, extent[3] - 12);
  await expect(
    page.getByRole("button", { name: "关闭地点详情" }),
  ).toBeVisible();
  await expect
    .poll(async () => Number(await map.getAttribute("data-model-pick-count")))
    .toBeGreaterThan(pickedBefore);
  await expect(page.locator(".place-details-heading")).toContainText("南苑7栋");
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await expect(page.locator(".place-details-frame")).toHaveCount(0);
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page.getByRole("checkbox", { name: "宿舍楼栋", exact: true }).uncheck();
  await expect(map).toHaveAttribute("data-model-detailed", "visible");
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page
    .getByRole("button", { name: "顺时针旋转地图", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-3d-rotated.png` });
  await page.getByRole("button", { name: "切换为2D", exact: true }).click();
  await expect(map).toHaveAttribute("data-model-detailed", "none");
  expect(errors).toEqual([]);
});

test("failed 3D assets fall back to native volume and can be retried", async ({
  page,
}) => {
  await page.route("**/models/nanyuan7/*.glb", (r) =>
    r.fulfill({ status: 503, body: "unavailable" }),
  );
  const map = await focusDorm(page);
  await page.getByRole("button", { name: "切换为3D", exact: true }).click();
  await expect(map).toHaveAttribute("data-model-state", "error", {
    timeout: 30000,
  });
  await expect(map).toHaveAttribute("data-mode", "2.5d");
  await expect(map).toHaveAttribute("data-model-volume", "visible");
  await page.unroute("**/models/nanyuan7/*.glb");
  await page.getByRole("button", { name: "重试3D", exact: true }).click();
  await expect(map).toHaveAttribute("data-model-state", "ready", {
    timeout: 30000,
  });
  await expect(map).toHaveAttribute("data-model-detailed", "visible");
});
