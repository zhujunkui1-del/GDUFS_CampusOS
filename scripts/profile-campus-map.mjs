// Real application control: no test replicas, no private location, no provider requests.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const directory =
  process.env.PROFILE_OUTPUT ||
  "docs/performance/dormitory-2026-10-15/real-map-before";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: false,
  args: [
    "--enable-precise-memory-info",
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
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.addInitScript(() => {
      window.campusProfile = {
        draws: 0,
        running: false,
        frames: [],
        start() {
          cancelAnimationFrame(this.frame);
          this.frames = [];
          this.draws = 0;
          this.running = true;
          let previous;
          const tick = (time) => {
            if (!this.running) return;
            if (this.draws) {
              this.frames.push({
                dt: previous ? time - previous : 0,
                draws: this.draws,
              });
              previous = time;
              this.draws = 0;
            }
            this.frame = requestAnimationFrame(tick);
          };
          this.frame = requestAnimationFrame(tick);
        },
        stop() {
          this.running = false;
          cancelAnimationFrame(this.frame);
          return this.frames;
        },
      };
      for (const name of [
        "drawElements",
        "drawArrays",
        "drawElementsInstanced",
        "drawArraysInstanced",
      ]) {
        const draw = WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name] = function (...args) {
          window.campusProfile.draws++;
          return draw.apply(this, args);
        };
      }
    });
    const start = Date.now();
    await page.goto("http://127.0.0.1:3000/map");
    await page.bringToFront();
    await page.getByTestId("campus-map").waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="campus-map"]').dataset.status ===
        "ready",
    );
    const readyMs = Date.now() - start;
    await page.getByLabel("搜索校园地点").fill("南苑7栋");
    await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
    await page.getByRole("button", { name: "关闭地点详情" }).click();
    await page.locator(".place-details-panel").waitFor({ state: "detached" });
    const select = async (mode) => {
      const trigger = page.getByTestId("map-mode-trigger");
      for (let i = 0; i < 4 && (await trigger.innerText()) !== mode; i++)
        await trigger.click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="campus-map"]').dataset
            .cameraMoving === "false",
      );
      if (mode === "3D")
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="campus-map"]').dataset
              .modelState === "ready",
        );
    };
    for (const mode of ["2D", "2.5D", "3D"]) {
      await select(mode);
      for (const overlay of ["normal", "labels-off", "ai-open"]) {
        await page
          .getByRole("button", { name: "地图朝北", exact: true })
          .click();
        await page
          .getByRole("button", { name: "缩小地图", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="campus-map"]').dataset
              .cameraMoving === "false",
        );
        await page.getByLabel("搜索校园地点").fill("");
        await page.getByLabel("搜索校园地点").fill("南苑7栋");
        await page
          .locator(".place-result")
          .filter({ hasText: "南苑7栋" })
          .click();
        await page.getByRole("button", { name: "关闭地点详情" }).click();
        await page
          .locator(".place-details-panel")
          .waitFor({ state: "detached" });
        await select(mode);
        if (overlay === "labels-off") {
          await page
            .getByRole("button", { name: "地图图层", exact: true })
            .click();
          for (const checkbox of await page.getByRole("checkbox").all())
            await checkbox.uncheck();
          await page
            .getByRole("button", { name: "地图图层", exact: true })
            .click();
        }
        if (overlay === "ai-open")
          await page
            .getByRole("button", { name: "打开校园助理", exact: true })
            .click();
        const memoryBefore = await cdp.send("Performance.getMetrics");
        const actions = [];
        for (const action of ["drag", "zoom", "rotate"]) {
          if (overlay === "ai-open" && action !== "drag") continue;
          await page.evaluate(() => window.campusProfile.start());
          const actionStart = Date.now();
          if (action === "drag") {
            const point = await page.evaluate(() => {
              for (const y of [
                innerHeight * 0.3,
                innerHeight * 0.45,
                innerHeight * 0.6,
              ])
                for (const x of [
                  innerWidth * 0.45,
                  innerWidth * 0.3,
                  innerWidth * 0.6,
                ]) {
                  const target = document.elementFromPoint(x, y);
                  if (
                    target?.closest('[data-testid="campus-map"]') &&
                    !target.closest("button")
                  )
                    return { x, y };
                }
              throw new Error("No unobstructed map for pointer profile");
            });
            const { x, y } = point;
            await page.mouse.move(x, y);
            await page.mouse.down();
            for (let i = 0; i < 40; i++) {
              await page.mouse.move(x + i * 1.2, y + i * 0.6);
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
            await page.mouse.up();
          } else {
            const label = action === "zoom" ? "放大地图" : "顺时针旋转地图";
            await page
              .getByRole("button", { name: label, exact: true })
              .click();
          }
          await page.waitForTimeout(750);
          const frames = await page.evaluate(() => window.campusProfile.stop());
          actions.push({ action, elapsedMs: Date.now() - actionStart, frames });
        }
        const memoryAfter = await cdp.send("Performance.getMetrics");
        records.push({
          viewport,
          mode,
          overlay,
          readyMs,
          memoryBefore: memoryBefore.metrics,
          memoryAfter: memoryAfter.metrics,
          actions,
          modelCalls: await page
            .getByTestId("campus-map")
            .getAttribute("data-model-draw-calls"),
        });
        await writeFile(
          directory + "/metrics.json",
          JSON.stringify(
            {
              date: "2026-10-15",
              browser: browser.version(),
              actualPhone: false,
              records,
            },
            null,
            2,
          ),
        );
        await page.screenshot({
          path: `${directory}/${viewport.name}-${mode}-${overlay}.png`,
        });
        console.log(`${viewport.name} ${mode} ${overlay} profiled`);
        if (overlay === "ai-open")
          await page.getByRole("button", { name: "收起校园助理" }).click();
        if (overlay === "labels-off") {
          await page
            .getByRole("button", { name: "地图图层", exact: true })
            .click();
          for (const checkbox of await page.getByRole("checkbox").all())
            await checkbox.check();
          await page
            .getByRole("button", { name: "地图图层", exact: true })
            .click();
        }
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
