import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { selectMapMode } from "./helpers/map-mode";

type Sample = { viewport: number[]; buffer: number[] };
declare global {
  interface Window {
    modelViewportSamples: Sample[];
  }
}
type SampleWindow = Window;

async function watchModelViewport(page: Page) {
  await page.addInitScript(() => {
    (window as SampleWindow).modelViewportSamples = [];
    function capture(gl: WebGL2RenderingContext, instances: number) {
      const viewport = Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array);
      // Seven V2 floor instances; exclude the 512px shadow pass.
      if (instances === 7 && !(viewport[2] === 512 && viewport[3] === 512)) {
        const samples = (window as SampleWindow).modelViewportSamples;
        samples.push({
          viewport,
          buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        });
        if (samples.length > 40) samples.shift();
      }
    }
    const draw = WebGL2RenderingContext.prototype.drawElementsInstanced;
    WebGL2RenderingContext.prototype.drawElementsInstanced = function (
      ...args
    ) {
      capture(this, args[4]);
      return draw.apply(this, args);
    };
    const arrays = WebGL2RenderingContext.prototype.drawArraysInstanced;
    WebGL2RenderingContext.prototype.drawArraysInstanced = function (...args) {
      capture(this, args[3]);
      return arrays.apply(this, args);
    };
  });
}
async function loadModel(page: Page) {
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-state", "ready");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  return map;
}

test("3D stays aligned with the map after resizing and then dragging", async ({
  page,
}, info) => {
  await watchModelViewport(page);
  const map = await loadModel(page);
  const directory =
    process.env.E2E_RESIZE_CAPTURE_DIR ||
    "docs/screenshots/s1/nanyuan7-v2-resize";
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  await mkdir(directory, { recursive: true });
  const evidence: { stage: string; sample: Sample }[] = [];
  async function verify(stage: string) {
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as SampleWindow).modelViewportSamples.length,
        ),
      )
      .toBeGreaterThan(0);
    const sample = await page.evaluate(() =>
      (window as SampleWindow).modelViewportSamples.at(-1)!,
    );
    evidence.push({ stage, sample });
    await page.screenshot({ path: `${directory}/${name}-${stage}.png` });
    await writeFile(
      `${directory}/${name}-viewport.json`,
      JSON.stringify(evidence, null, 2),
    );
    expect(sample.viewport).toEqual([0, 0, ...sample.buffer]);
  }
  await verify("before");
  await page.evaluate(() => {
    (window as SampleWindow).modelViewportSamples = [];
  });
  await page.setViewportSize({ width: 780, height: 520 });
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await verify("resized");
  await page.evaluate(() => {
    (window as SampleWindow).modelViewportSamples = [];
  });
  await page.mouse.move(300, 420);
  await page.mouse.down();
  await page.mouse.move(360, 455, { steps: 10 });
  await page.mouse.up();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await verify("dragged");
  await page.evaluate(() => {
    (window as SampleWindow).modelViewportSamples = [];
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await verify("narrow");
});

test("native browser window resizing keeps the 3D viewport synchronized", async ({
  browserName,
}, info) => {
  test.skip(
    process.env.E2E_MODEL_NATIVE !== "1" ||
      info.project.name !== "desktop" ||
      browserName !== "chromium",
    "Explicit native window regression",
  );
  const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
  const context = await chromium.launchPersistentContext("", {
    channel,
    headless: false,
    viewport: null,
    deviceScaleFactor: undefined,
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
  });
  try {
    const page = await context.newPage();
    await watchModelViewport(page);
    const map = await loadModel(page);
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    const directory = `docs/screenshots/s1/nanyuan7-v2-resize/native-${channel}`;
    await mkdir(directory, { recursive: true });
    const evidence = [];
    for (const [width, height] of [
      [1000, 800],
      [780, 560],
      [1120, 850],
    ]) {
      const before = await page.evaluate(() => [innerWidth, innerHeight]);
      await page.evaluate(() => {
        window.modelViewportSamples = [];
      });
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width, height },
      });
      await page.waitForFunction(
        (before) => innerWidth !== before[0] || innerHeight !== before[1],
        before,
      );
      await expect(map).toHaveAttribute("data-camera-moving", "false");
      await expect
        .poll(() => page.evaluate(() => window.modelViewportSamples.length))
        .toBeGreaterThan(0);
      const sample = await page.evaluate(() =>
        window.modelViewportSamples.at(-1)!,
      );
      evidence.push({ window: [width, height], sample });
      await page.screenshot({ path: `${directory}/${width}-${height}.png` });
      expect(sample.viewport).toEqual([0, 0, ...sample.buffer]);
    }
    await writeFile(
      `${directory}/viewport.json`,
      JSON.stringify(evidence, null, 2),
    );
  } finally {
    await context.close();
  }
});
