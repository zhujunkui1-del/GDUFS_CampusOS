import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const manifest = JSON.parse(
  await readFile(
    "src/features/campus-map/data/local-map-manifest.json",
    "utf8",
  ),
);

// Real local renderer. No supplier fixtures, external requests or API keys required.
test("real browser map starts north and responds to drag and zoom", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const started = Date.now();
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.hostname.includes("amap.com") ||
      /\/api\/map\/(config|coordinates)/.test(url.pathname)
    )
      providerRequests.push(url.hostname + url.pathname);
  });
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  const loadMs = Date.now() - started;
  const initialBearing = Number(await map.getAttribute("data-bearing"));
  expect(providerRequests).toEqual([]);
  const box = await map.boundingBox();
  expect(box?.height).toBe(page.viewportSize()!.height);
  const initialExtent = JSON.parse(
    (await map.getAttribute("data-campus-extent"))!,
  );
  expect.soft(initialExtent[0]).toBeGreaterThanOrEqual(0);
  expect.soft(initialExtent[1]).toBeGreaterThanOrEqual(0);
  expect.soft(initialExtent[2]).toBeLessThanOrEqual(box!.width);
  expect.soft(initialExtent[3]).toBeLessThanOrEqual(box!.height);
  const dir = "docs/screenshots/s1/map-feedback";
  await mkdir(dir, { recursive: true });
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${testInfo.project.name}`;
  await page.screenshot({ path: `${dir}/${name}-initial.jpg`, type: "jpeg" });
  // Soft assertion keeps the interaction probe running when north is wrong.
  expect.soft(initialBearing).toBe(0);
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await page
    .locator(".place-result")
    .filter({ hasText: "图书馆" })
    .first()
    .click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await page.getByRole("button", { name: "切换为2D", exact: true }).click();
  await page.getByRole("button", { name: "放大地图", exact: true }).click();
  const beforeZoom = Number(await map.getAttribute("data-zoom"));
  await page.getByRole("button", { name: "放大地图", exact: true }).click();
  await expect
    .poll(async () => Number(await map.getAttribute("data-zoom")))
    .toBeGreaterThan(beforeZoom);
  // A campus marker is a real renderer position, not a simulated camera value.
  const marker = page.getByRole("button", { name: "查看图书馆", exact: true });
  await expect(marker).toBeVisible();
  const before = await marker.boundingBox();
  const ground = await page.evaluate(() => {
    const w = innerWidth,
      h = innerHeight;
    for (const y of [h * 0.6, h * 0.75, h * 0.5])
      for (const x of [w * 0.55, w * 0.65, w * 0.45]) {
        const target = document.elementFromPoint(x, y);
        if (
          target?.closest('[data-testid="campus-map"]') &&
          !target.closest("button")
        )
          return { x, y };
      }
    return null;
  });
  expect(ground, "map ground must receive pointer events").not.toBeNull();
  const dragStarted = Date.now();
  await page.mouse.move(ground!.x, ground!.y);
  await page.mouse.down();
  await page.mouse.move(ground!.x + 100, ground!.y + 45, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const after = await marker.boundingBox();
        return after && before
          ? Math.hypot(after.x - before.x, after.y - before.y)
          : 0;
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(25);
  const dragResponseMs = Date.now() - dragStarted;
  await page.screenshot({ path: `${dir}/${name}-drag.jpg`, type: "jpeg" });
  for (const mode of ["2.5D", "2D"]) {
    await page
      .getByRole("button", { name: `切换为${mode}`, exact: true })
      .click();
    for (let i = 0; i < 8; i++)
      await page.getByRole("button", { name: "缩小地图", exact: true }).click();
    await page
      .getByRole("button", { name: "顺时针旋转地图", exact: true })
      .click();
    for (const dx of [-600, 600]) {
      await page.mouse.move(ground!.x, ground!.y);
      await page.mouse.down();
      await page.mouse.move(ground!.x + dx, ground!.y + 160, { steps: 15 });
      await page.mouse.up();
      const corners: number[][] = JSON.parse(
        (await map.getAttribute("data-ground-corners"))!,
      );
      for (const [lon, lat] of corners) {
        expect(lon).toBeGreaterThanOrEqual(manifest.bounds[0]);
        expect(lon).toBeLessThanOrEqual(manifest.bounds[2]);
        expect(lat).toBeGreaterThanOrEqual(manifest.bounds[1]);
        expect(lat).toBeLessThanOrEqual(manifest.bounds[3]);
      }
    }
  }
  await writeFile(
    `${dir}/${name}-metrics.json`,
    JSON.stringify(
      {
        browser: process.env.PLAYWRIGHT_CHANNEL,
        viewport: testInfo.project.name,
        loadMs,
        initialBearing,
        dragResponseMs,
        sdk: "real MapLibre GL 6.14.0 / local OSM snapshot",
        network: "same-origin only during map loading",
        providerRequestsBeforeOnlineAction: providerRequests.length,
        fixtures: false,
      },
      null,
      2,
    ) + "\n",
  );
});
