import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const output =
  process.env.STRESS_OUTPUT || "docs/performance/dormitory-2026-10-15";
const repeats = Number(process.env.STRESS_REPEATS || 3);
const duration = Number(process.env.STRESS_DURATION || 2400);
const variants = (process.env.STRESS_VARIANTS || "baseline,optimized").split(
  ",",
);
const counts = (process.env.STRESS_COUNTS || "1,10,30,60")
  .split(",")
  .map(Number);
await mkdir(output + "/screenshots", { recursive: true });
const asset = await readFile(
  "public/models/nanyuan7/nanyuan7-v2-54cc55342ae5.glb",
);
const browser = await chromium.launch({
  channel: "msedge",
  headless: false,
  args: [
    "--enable-precise-memory-info",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
  ],
});
const browserCdp = await browser.newBrowserCDPSession();
const system = await browserCdp.send("SystemInfo.getInfo");
const results = {
  date: "2026-10-15",
  browser: browser.version(),
  assetSha256: createHash("sha256").update(asset).digest("hex"),
  system,
  repeats,
  duration,
  actualPhone: false,
  cases: [],
};
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900, dpr: 1 },
    { name: "mobile", width: 390, height: 844, dpr: 3 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.dpr,
      isMobile: viewport.name === "mobile",
      hasTouch: viewport.name === "mobile",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const count of counts)
      for (let repeat = 0; repeat < repeats; repeat++) {
        // Alternate order to reduce warm-up/thermal bias while measuring sequentially.
        const order = repeat % 2 ? [...variants].reverse() : variants;
        for (const variant of order) {
          pageErrors.length = 0;
          const navigationStarted = Date.now();
          await page.goto(
            `http://127.0.0.1:3013/?count=${count}&variant=${variant}`,
          );
          await page.bringToFront();
          await page.waitForFunction(() => window.stressLab?.ready, undefined, {
            timeout: 45000,
          });
          const navigationMs = Date.now() - navigationStarted;
          const metadata = await page.evaluate(() => {
            const meta = { ...window.stressLab };
            delete meta.run;
            delete meta.rest;
            delete meta.naturalIdle;
            return meta;
          });
          await cdp.send("HeapProfiler.collectGarbage");
          const memoryBefore = await cdp.send("Performance.getMetrics");
          const actions = [];
          for (const action of (
            process.env.STRESS_ACTIONS || "idle,drag,zoom,rotate,mode"
          ).split(","))
            actions.push(
              await page.evaluate(
                ({ action, duration }) =>
                  window.stressLab.run(action, duration),
                { action, duration },
              ),
            );
          const memoryAfter = await cdp.send("Performance.getMetrics");
          if (repeat === 0) {
            await page.evaluate(() => window.stressLab.rest());
            await page.screenshot({
              path: `${output}/screenshots/${viewport.name}-${count}-${variant}.png`,
            });
          }
          const record = {
            viewport,
            count,
            variant,
            repeat,
            navigationMs,
            metadata,
            memoryBefore: memoryBefore.metrics,
            memoryAfter: memoryAfter.metrics,
            actions,
            errors: [...pageErrors],
          };
          results.cases.push(record);
          await writeFile(
            output + "/raw.json",
            JSON.stringify(results, null, 2),
          );
          console.log(
            `${viewport.name} ${count} ${variant} repeat=${repeat + 1} gpu=${metadata.gpu} errors=${pageErrors.length}`,
          );
        }
      }
    await context.close();
  }
} finally {
  await browser.close();
}
