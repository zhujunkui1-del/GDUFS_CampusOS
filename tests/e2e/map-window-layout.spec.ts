import { test, expect, chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
const { bounds }: { bounds: number[] } = JSON.parse(
  await readFile(
    "src/features/campus-map/data/local-map-manifest.json",
    "utf8",
  ),
);

test("native browser zoom and short window retain a fully painted map", async ({
  browserName,
}, info) => {
  test.setTimeout(240000);
  test.skip(
    process.env.E2E_WINDOW_LAYOUT !== "1" ||
      info.project.name !== "desktop" ||
      browserName !== "chromium",
    "Explicit desktop native window diagnostic",
  );
  const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
  // A disposable profile keeps native browser zoom separate from viewport emulation.
  const context = await chromium.launchPersistentContext("", {
    channel,
    headless: false,
    viewport: null,
    deviceScaleFactor: undefined,
    isMobile: false,
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
  });
  const page = await context.newPage();
  const cameraWarnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("Map cannot fit within canvas"))
      cameraWarnings.push(msg.text());
  });
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
    await page.goto("/map");
    const map = page.getByTestId("campus-map");
    await expect(map).toHaveAttribute("data-status", "ready");
    const probeStyle = await page.addStyleTag({
      content: ".campus-map-canvas { background: #ff00ff !important; }",
    });
    // The vivid backdrop exposes unpainted areas even when the normal background matches the map.
    const dir =
      process.env.E2E_WINDOW_CAPTURE_DIR ||
      `docs/screenshots/s1/window-layout/${channel}`;
    await mkdir(dir, { recursive: true });
    const measurements: unknown[] = [];
    const inspect = async (name: string) => {
      const metrics = await page.evaluate(() => {
        const el =
          document.querySelector<HTMLCanvasElement>(".maplibregl-canvas")!;
        const gl = el.getContext("webgl2")!;
        const graphics = gl.getExtension("WEBGL_debug_renderer_info");
        const attribution = document.querySelector(".map-attribution")!;
        const credit = attribution.getBoundingClientRect();
        const topElement = document.elementFromPoint(
          credit.x + credit.width / 2,
          credit.y + credit.height / 2,
        );
        return {
          viewport: [innerWidth, innerHeight],
          userAgent: navigator.userAgent,
          renderer: gl.getParameter(
            graphics ? graphics.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
          ),
          contextLost: gl.isContextLost(),
          attributionVisible:
            topElement === attribution ||
            (topElement !== null && attribution.contains(topElement)),
          pitch: document.querySelector<HTMLElement>("[data-testid=campus-map]")
            ?.dataset.pitch,
          groundCorners: JSON.parse(
            document.querySelector<HTMLElement>("[data-testid=campus-map]")
              ?.dataset.groundCorners || "[]",
          ) as number[][],
          pageSize: [
            document.documentElement.scrollWidth,
            document.documentElement.scrollHeight,
          ],
          dpr: devicePixelRatio,
          canvas: el.getBoundingClientRect().toJSON(),
          backing: [el.width, el.height],
          drawing: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          panel: document
            .querySelector(".route-planner")
            ?.getBoundingClientRect()
            .toJSON(),
          endpoints: [...document.querySelectorAll(".route-endpoint")].map(
            (el) => el.getBoundingClientRect().toJSON(),
          ),
        };
      });
      const capture = await page.screenshot({ path: `${dir}/${name}.png` });
      const { data, info: px } = await sharp(capture)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let longest = 0,
        longestGreyRun = 0;
      for (let y = 0; y < px.height; y++) {
        let run = 0,
          greyRun = 0;
        for (let x = 0; x < px.width; x++) {
          const i = (y * px.width + x) * 3;
          run =
            data[i] > 245 && data[i + 1] < 10 && data[i + 2] > 245
              ? run + 1
              : 0;
          longest = Math.max(longest, run);
          greyRun =
            data[i] === 236 && data[i + 1] === 240 && data[i + 2] === 239
              ? greyRun + 1
              : 0;
          longestGreyRun = Math.max(longestGreyRun, greyRun);
        }
      }
      measurements.push({ name, ...metrics, longest, longestGreyRun });
      await writeFile(
        `${dir}/measurements.json`,
        JSON.stringify(measurements, null, 2) + "\n",
      );
      expect(longest, name + " exposes canvas backdrop").toBeLessThan(
        80 * metrics.dpr,
      );
      expect(longestGreyRun, name + " grey rectangle").toBeLessThan(
        80 * metrics.dpr,
      );
      expect(metrics.contextLost, name + " WebGL context").toBe(false);
      expect(
        metrics.attributionVisible,
        name + " map attribution visible",
      ).toBe(true);
      expect(
        metrics.groundCorners,
        name + " measured map corners",
      ).toHaveLength(4);
      for (const [lng, lat] of metrics.groundCorners) {
        expect(lng, name + " coverage west").toBeGreaterThanOrEqual(
          bounds[0] - 1e-6,
        );
        expect(lng, name + " coverage east").toBeLessThanOrEqual(
          bounds[2] + 1e-6,
        );
        expect(lat, name + " coverage south").toBeGreaterThanOrEqual(
          bounds[1] - 1e-6,
        );
        expect(lat, name + " coverage north").toBeLessThanOrEqual(
          bounds[3] + 1e-6,
        );
      }
      expect(
        Math.abs(metrics.canvas.height - metrics.viewport[1]),
        name,
      ).toBeLessThan(2);
      expect(
        metrics.pageSize[1],
        name + " page must not scroll behind the planning panel",
      ).toBeLessThanOrEqual(metrics.viewport[1]);
      expect(
        Math.abs(metrics.canvas.width - metrics.viewport[0]),
        name,
      ).toBeLessThan(2);
      expect(
        Math.abs(metrics.backing[0] - metrics.canvas.width * metrics.dpr),
        name,
      ).toBeLessThan(3);
      expect(
        Math.abs(metrics.backing[1] - metrics.canvas.height * metrics.dpr),
        name,
      ).toBeLessThan(3);
      if (
        !name.endsWith("-selection") &&
        metrics.panel &&
        metrics.endpoints.length
      ) {
        for (const endpoint of metrics.endpoints) {
          expect(
            endpoint.x + endpoint.width / 2,
            name + " endpoint on screen",
          ).toBeGreaterThan(10);
          expect(
            endpoint.x + endpoint.width / 2,
            name + " endpoint on screen",
          ).toBeLessThan(metrics.viewport[0] - 10);
          if (metrics.panel.width > metrics.viewport[0] * 0.75) {
            expect(
              endpoint.bottom,
              name + " endpoint above panel",
            ).toBeLessThan(metrics.panel.top);
          }
        }
      }
    };
    await page
      .getByRole("button", { name: "校园步行导航", exact: true })
      .click();
    await inspect("maximized-100-open");
    const settings = await context.newPage();
    await settings.goto(
      channel === "msedge"
        ? "edge://settings/appearance"
        : "chrome://settings/appearance",
    );
    if (channel === "msedge") {
      await expect(
        settings.locator(".selected-label").filter({ hasText: /%/ }),
      ).toBeVisible();
    }
    const zoom = settings.locator("select#zoomLevel");
    if (channel !== "msedge") await expect(zoom).toBeVisible({ timeout: 5000 });
    const initialDpr = await page.evaluate(() => devicePixelRatio);
    const setZoom = async (percent: string) => {
      await settings.bringToFront();
      if (channel === "msedge") {
        await settings
          .locator(".selected-label")
          .filter({ hasText: /%/ })
          .click();
        await settings
          .locator(".item-title")
          .filter({ hasText: new RegExp("^\\s*" + percent + "%\\s*$") })
          .click();
      } else await zoom.selectOption({ label: percent + "%" });
      await page.bringToFront();
      await expect
        .poll(() => page.evaluate(() => devicePixelRatio))
        .toBeCloseTo((initialDpr * Number(percent)) / 100, 1);
    };
    const plan = async (name: string) => {
      const reset = page.getByRole("button", { name: "重置路线", exact: true });
      if (await reset.count()) await reset.click();
      const tilt = page.getByRole("button", {
        name: "切换为2.5D",
        exact: true,
      });
      if (await tilt.count()) await tilt.click();
      await expect(map).toHaveAttribute("data-camera-moving", "false");
      for (const [which, name] of [
        ["起点", "教学楼B栋"],
        ["终点", "实验楼C栋"],
      ]) {
        await page.getByLabel("导航" + which).fill("");
        await page.getByLabel("导航" + which).fill(name);
        await page
          .getByRole("region", { name: which + "地点建议" })
          .getByRole("button", { name: new RegExp(name) })
          .click({ timeout: 5000 });
        await expect(map).toHaveAttribute("data-camera-moving", "false");
      }
      await inspect(name + "-selection");
      await page
        .getByRole("button", { name: "规划步行路线", exact: true })
        .click();
      await expect(page.locator(".route-result")).toBeVisible();
      await expect(map).toHaveAttribute("data-camera-moving", "false");
      await page.locator(".route-planner").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    };
    for (const percent of process.env.E2E_WINDOW_QUICK === "1"
      ? ["150"]
      : ["110", "125", "150", "175", "200", "250", "300"]) {
      await setZoom(percent);
      await plan("maximized-zoom-" + percent);
      await inspect("maximized-zoom-" + percent);
    }
    await setZoom("100");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    for (const height of process.env.E2E_WINDOW_QUICK === "1"
      ? [450]
      : [800, 650, 550, 500, 450, 400]) {
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width: 1000, height },
      });
      await plan("short-" + height);
      await page.locator(".route-planner").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect(map).toHaveAttribute("data-camera-moving", "false");
      await inspect("short-" + height);
    }
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: 1000, height: 650 },
    });
    await setZoom("150");
    await plan("short-650-zoom-150");
    await inspect("short-650-zoom-150");
    await settings.close();
    await probeStyle.evaluate((el) => el.parentNode?.removeChild(el));
    await page.screenshot({ path: `${dir}/short-window-final.png` });
    await page
      .getByRole("button", { name: "关闭导航面板", exact: true })
      .click();
    await expect(page.locator(".route-planner")).toHaveCount(0);
    await expect(page.locator(".route-endpoint")).toHaveCount(0);
    expect(cameraWarnings).toEqual([]);
    await page.screenshot({ path: `${dir}/short-window-closed.png` });
  } finally {
    await context.close();
  }
});
