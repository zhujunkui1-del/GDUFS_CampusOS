import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { selectMapMode } from "./helpers/map-mode";

test("record local map operation cadence in three modes without claiming phone hardware FPS", async ({
  page,
  browser,
}, info) => {
  const started = performance.now();
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  const loadMs = Math.round(performance.now() - started);
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const modes = [];
  for (const mode of ["2D", "2.5D", "3D"] as const) {
    const switchStart = performance.now();
    await selectMapMode(page, mode);
    if (mode === "3D")
      await expect(map).toHaveAttribute("data-model-state", "ready");
    await expect(map).toHaveAttribute("data-camera-moving", "false");
    const switchMs = Math.round(performance.now() - switchStart);
    const sample = page.evaluate(
      () =>
        new Promise<{
          frames: number;
          p50Ms: number;
          p95Ms: number;
          longestMs: number;
          visible: boolean;
        }>((resolve) => {
          const start = performance.now();
          let last: number | undefined;
          const gaps: number[] = [];
          const frame = (now: number) => {
            if (last !== undefined && now > last) gaps.push(now - last);
            last = now;
            if (now - start < 1800) requestAnimationFrame(frame);
            else {
              gaps.sort((a, b) => a - b);
              resolve({
                frames: gaps.length,
                p50Ms: gaps[Math.floor(gaps.length * 0.5)],
                p95Ms: gaps[Math.floor(gaps.length * 0.95)],
                longestMs: gaps.at(-1)!,
                visible: document.visibilityState === "visible",
              });
            }
          };
          requestAnimationFrame(frame);
        }),
    );
    const point = await page.evaluate(() => {
      for (let y = 230; y < innerHeight - 180; y += 80)
        for (let x = 150; x < innerWidth - 90; x += 60)
          if (
            document
              .elementFromPoint(x, y)
              ?.classList.contains("maplibregl-canvas")
          )
            return { x, y };
      return { x: innerWidth / 2, y: innerHeight / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 28, point.y + 35, { steps: 8 });
    await page.mouse.up();
    await page.getByRole("button", { name: "放大地图", exact: true }).click();
    await page
      .getByRole("button", { name: "顺时针旋转地图", exact: true })
      .click();
    modes.push({
      mode,
      switchMs,
      ...(await sample),
      model: await map.evaluate((el) =>
        Object.fromEntries(
          [...el.attributes]
            .filter((a) => a.name.startsWith("data-model-"))
            .map((a) => [a.name, a.value]),
        ),
      ),
    });
  }
  const dir = process.env.E2E_CAPTURE_DIR || "test-results/s2-d";
  await mkdir(dir, { recursive: true });
  const prefix = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
  await page.screenshot({ path: `${dir}/${prefix}-performance.png` });
  await writeFile(
    `${dir}/${prefix}-performance.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        realPhone: false,
        measurement:
          "requestAnimationFrame callback cadence during real pointer drag, zoom and rotation; not presented FPS or GPU timing",
        loadMs,
        modes,
      },
      null,
      2,
    ),
  );
});
