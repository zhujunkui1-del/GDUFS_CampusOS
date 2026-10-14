import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { selectMapMode } from "./helpers/map-mode";

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
  await expect(map).toHaveAttribute("data-model-volume", "none");
  await expect(map).toHaveAttribute(
    "data-model-volume-version",
    "nanyuan7-2026-10-14.1",
  );
  await expect(map).toHaveAttribute(
    "data-model-version",
    "nanyuan7-v2-2026-10-14",
  );
  await expect(page.getByTestId("map-mode-trigger")).toHaveCount(1);
  await expect(page.getByTestId("map-mode-trigger")).toHaveText("2D");
  expect(assets).toHaveLength(0);
  const dir =
    process.env.E2E_CAPTURE_DIR || "docs/screenshots/s1/nanyuan7-model";
  await mkdir(dir, { recursive: true });
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  await selectMapMode(page, "2D");
  await expect(map).toHaveAttribute("data-model-volume", "none");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-2d.png` });
  await selectMapMode(page, "2.5D");
  await expect(map).toHaveAttribute("data-model-volume", "visible");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-2.5d.png` });
  await selectMapMode(page, "3D");
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
  expect(assets[0]).toContain("nanyuan7-v2-54cc55342ae5.glb");
  await expect(map).toHaveAttribute(
    "data-model-asset-sha",
    "54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a",
  );
  await expect(page.getByTestId("map-mode-trigger")).toHaveText("3D");
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
        volumeVersion: el.dataset.modelVolumeVersion,
        assetSha256: el.dataset.modelAssetSha,
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
  await selectMapMode(page, "2.5D");
  await expect(map).toHaveAttribute("data-model-volume", "visible");
  await expect(map).toHaveAttribute("data-model-detailed", "none");
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-detailed", "visible");
  expect(assets).toHaveLength(1);
  await selectMapMode(page, "2D");
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
  await selectMapMode(page, "3D", true);
  await expect(map).toHaveAttribute("data-model-state", "error", {
    timeout: 30000,
  });
  await expect(map).toHaveAttribute("data-mode", "2.5d");
  await expect(map).toHaveAttribute("data-model-volume", "visible");
  await selectMapMode(page, "2D");
  await expect(map).toHaveAttribute("data-model-volume", "none");
  await page.unroute("**/models/nanyuan7/*.glb");
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-state", "ready", {
    timeout: 30000,
  });
  await expect(map).toHaveAttribute("data-model-detailed", "visible");
});

test("one mode button starts in 2D and cycles with keyboard without a menu", async ({
  page,
}) => {
  const map = await focusDorm(page);
  const trigger = page.getByTestId("map-mode-trigger");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("2.5D");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(map).toHaveAttribute("data-mode", "2.5d");
  await page.keyboard.press("Enter");
  await expect(map).toHaveAttribute("data-mode", "3d");
  await page.keyboard.press("Enter");
  await expect(map).toHaveAttribute("data-mode", "2d");
  expect(await trigger.evaluate((el) => getComputedStyle(el).color)).toBe(
    "rgb(29, 29, 31)",
  );
});

test("2D remains selectable during 3D loading and late completion does not restore 3D", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/models/nanyuan7/*.glb", async (route) => {
    requests++;
    await gate;
    await route.continue();
  });
  try {
    const map = await focusDorm(page);
    await selectMapMode(page, "3D");
    await expect(map).toHaveAttribute("data-model-state", "loading");
    await page.getByTestId("map-mode-trigger").click();
    await expect(map).toHaveAttribute("data-mode", "2d");
    release();
    await expect(map).toHaveAttribute("data-model-state", "ready", {
      timeout: 30000,
    });
    await expect(map).toHaveAttribute("data-mode", "2d");
    await expect(map).toHaveAttribute("data-model-detailed", "none");
    await expect(map).toHaveAttribute("data-model-volume", "none");
    await selectMapMode(page, "3D");
    await expect(map).toHaveAttribute("data-model-detailed", "visible");
    expect(requests).toBe(1);
  } finally {
    release();
  }
});

test("closing details keeps the cycle button usable", async ({ page }) => {
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  for (const mode of ["2D", "2.5D", "2D"] as const) {
    await page.getByLabel("搜索校园地点").fill("");
    await page.getByLabel("搜索校园地点").fill("南苑7栋");
    await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
    await page.getByRole("button", { name: "关闭地点详情" }).click();
    // Open during the drawer's closing transition, then let its focus cleanup finish.
    await expect(page.locator(".place-details-panel")).toHaveCount(0);
    await selectMapMode(page, mode);
    await expect(page.getByTestId("map-mode-trigger")).toHaveText(mode);
  }
});

test("cached building shadows recover with the map WebGL context", async ({
  page,
}) => {
  const map = await focusDorm(page);
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-state", "ready");
  const before = Number(await map.getAttribute("data-model-frame-count"));
  const supported = await page.evaluate(() => {
    const canvas =
      document.querySelector<HTMLCanvasElement>(".maplibregl-canvas")!;
    const extension = canvas
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 450);
    return true;
  });
  test.skip(!supported, "Browser does not expose context recovery testing");
  await expect(map).toHaveAttribute("data-render-state", "context-lost");
  await expect(map).toHaveAttribute("data-render-state", "ready");
  await expect
    .poll(async () => Number(await map.getAttribute("data-model-frame-count")))
    .toBeGreaterThan(before);
  await expect(map).toHaveAttribute("data-model-detailed", "visible");
});
