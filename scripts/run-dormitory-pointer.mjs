import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const output = "docs/performance/dormitory-2026-10-15/pointer";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: false,
  args: [
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
const records = [];
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
    for (const count of [1, 10, 30, 60])
      for (const variant of ["baseline", "optimized"]) {
        await page.goto(
          `http://127.0.0.1:3013/?count=${count}&variant=${variant}`,
        );
        await page.bringToFront();
        await page.waitForFunction(() => window.stressLab?.ready);
        const start = await page.evaluate(() =>
          window.stressLab.startExternal(),
        );
        const x = viewport.width * 0.45,
          y = viewport.height * 0.55;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 0; step < 50; step++) {
          await page.mouse.move(x + step * 0.9, y + step * 0.3);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await page.mouse.up();
        await page.waitForTimeout(300);
        const result = await page.evaluate(
          (start) => window.stressLab.stopExternal(start),
          start,
        );
        records.push({ viewport, count, variant, result });
        await writeFile(
          output + "/metrics.json",
          JSON.stringify({ actualPhone: false, records }, null, 2),
        );
        console.log(`${viewport.name} ${count} ${variant} actual pointer drag`);
      }
    await context.close();
  }
} finally {
  await browser.close();
}
