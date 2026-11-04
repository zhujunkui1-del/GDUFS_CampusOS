import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const directory = "docs/verification/map-stability-2026-11-04";
await mkdir(directory, { recursive: true });
const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
const browser = await chromium.launch({ channel, headless: true });
const results = [];
try {
  for (const [version, origin] of [
    ["baseline-8895e9a", "http://127.0.0.1:3040"],
    ["repaired", "http://127.0.0.1:3039"],
  ]) {
    for (let round = 0; round < 3; round++) {
      const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        }),
        page = await context.newPage();
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          if (
            document
              .querySelector('[data-testid="campus-map"]')
              ?.getAttribute("data-status") === "ready"
          ) {
            Reflect.set(window, "mapReadyMs", performance.now());
            observer.disconnect();
          }
        });
        observer.observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["data-status"],
        });
      });
      for (const cache of ["cold", "warm"]) {
        await page.goto(origin + "/map", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="campus-map"]')
              ?.getAttribute("data-status") === "ready",
        );
        await page.waitForFunction(() => {
          const state = document
            .querySelector('[data-testid="campus-map"]')
            ?.getAttribute("data-base-data-state");
          return !state || state === "ready";
        });
        const fullBasemapMs = await page.evaluate(() => performance.now());
        await page.waitForTimeout(500);
        const initial = await page.evaluate(() => {
          const resources = performance.getEntriesByType("resource");
          return {
            mapReadyMs: Reflect.get(window, "mapReadyMs"),
            fcpMs: performance.getEntriesByName("first-contentful-paint")[0]
              ?.startTime,
            requests: resources.length,
            transferredBytes: resources.reduce(
              (sum, r) => sum + Reflect.get(r, "transferSize"),
              0,
            ),
            decodedJsBytes: resources
              .filter(
                (r) => r.name.includes("/_next/") && r.name.endsWith(".js"),
              )
              .reduce((sum, r) => sum + Reflect.get(r, "decodedBodySize"), 0),
            modelRequests: resources.filter((r) => r.name.endsWith(".glb"))
              .length,
          };
        });
        const modelTimes = {};
        for (const [label, mode] of [
          ["2.5D", "2.5d"],
          ["3D", "3d"],
        ]) {
          const started = Date.now();
          await page.getByTestId("map-mode-trigger").click();
          await page.waitForFunction(
            (mode) => {
              const d = document.querySelector(
                '[data-testid="campus-map"]',
              ).dataset;
              return (
                d.mode === mode &&
                d.campusModelMode === mode &&
                d.campusModelPending === "0" &&
                Number(d.campusModelCount) > 0 &&
                (mode !== "3d" || d.modelState === "ready")
              );
            },
            mode,
            { timeout: 30000 },
          );
          modelTimes[label] = Date.now() - started;
        }
        const before = await page.evaluate(() => ({
          heap: performance.memory?.usedJSHeapSize,
          models: document
            .querySelector('[data-testid="campus-map"]')
            .getAttribute("data-campus-model-resident-count"),
        }));
        // Three full cycles verify reuse after initial assets settle.
        for (let i = 0; i < 9; i++) {
          await page.getByTestId("map-mode-trigger").click();
          await page.waitForTimeout(90);
        }
        await page.waitForTimeout(250);
        const stats = await page.getByTestId("campus-map").evaluate((el) => ({
          mode: el.dataset.mode,
          profile: el.dataset.renderProfile,
          residents: el.dataset.campusModelResidentCount,
          details: el.dataset.campusModelDetails,
          triangles: el.dataset.campusModelTriangles,
          drawCalls: el.dataset.campusModelDrawCalls,
          contextLosses: Number(el.dataset.contextLosses || 0),
          heap: performance.memory?.usedJSHeapSize,
        }));
        results.push({
          version,
          round,
          cache,
          ...initial,
          fullBasemapMs,
          modelTimes,
          beforeCycles: before,
          afterCycles: stats,
        });
        await writeFile(
          directory + `/performance-${channel}.json`,
          JSON.stringify(
            {
              environment:
                "Windows headless desktop browser; production Next servers over loopback; no network/CPU throttling; V8 heap excludes GPU/native memory",
              channel,
              results,
            },
            null,
            2,
          ),
        );
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ channel, samples: results.length }));
