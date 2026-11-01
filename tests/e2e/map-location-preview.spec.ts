import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
test.use({ trace: "off", video: "off" });
test("continuous location toggles, updates, resumes and shows only real compass data", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const out =
    process.env.E2E_CAPTURE_DIR || "verification/map-location-2026-11-01";
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => {
    let success: ((p: unknown) => void) | null = null,
      active = false,
      watches = 0,
      clears = 0,
      hidden = false,
      permissions = 0;
    const fixture = window as unknown as {
      __gps: {
        push(lon: number, lat: number): void;
        hide(value: boolean): void;
        heading(alpha: number): void;
        stats(): unknown;
      };
    };
    const position = (lon = 113.39131405, lat = 23.0680465) => ({
      coords: { longitude: lon, latitude: lat, accuracy: 80 },
      timestamp: Date.now(),
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: (
          s: (p: unknown) => void,
          _f: unknown,
          options: PositionOptions,
        ) => {
          if (!options.enableHighAccuracy)
            throw Error("High accuracy not requested");
          success = s;
          active = true;
          watches++;
          setTimeout(() => {
            if (active) s(position());
          }, 0);
          return watches;
        },
        clearWatch: () => {
          active = false;
          clears++;
        },
        getCurrentPosition: (s: (p: unknown) => void) => s(position()),
      },
    });
    Object.defineProperty(DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: async () => {
        permissions++;
        return "granted";
      },
    });
    fixture.__gps = {
      push(lon, lat) {
        success?.(position(lon, lat));
      },
      hide(value) {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      heading(alpha) {
        const e = new Event("deviceorientationabsolute");
        Object.assign(e, { absolute: true, alpha });
        window.dispatchEvent(e);
      },
      stats: () => ({ active, watches, clears, permissions }),
    };
  });
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 30000 });
  const button = page.getByRole("button", {
    name: "定位我的位置",
    exact: true,
  });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.evaluate(() => {
    (
      window as unknown as { __gps: { heading(n: number): void } }
    ).__gps.heading(270);
  });
  const marker = page.locator(".device-heading-marker");
  await expect(marker).toHaveAttribute("data-heading", "90");
  await expect(page.locator(".map-location-notice")).toHaveCount(0);
  const before = await marker.boundingBox();
  await page.evaluate(() => {
    (
      window as unknown as { __gps: { push(lon: number, lat: number): void } }
    ).__gps.push(113.39151405, 23.0680465);
  });
  await expect
    .poll(async () => Math.abs((await marker.boundingBox())!.x - before!.x))
    .toBeGreaterThan(1);
  await page.screenshot({
    path: `${out}/${info.project.name}-location.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  for (const [which, name] of [
    ["起点", "图书馆"],
    ["终点", "体育馆"],
  ]) {
    await page.getByLabel("导航" + which).fill(name);
    await page
      .getByRole("region", { name: which + "地点建议" })
      .getByRole("button", { name: new RegExp(name) })
      .first()
      .click();
  }
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __gps: { push(lon: number, lat: number): void } }
    ).__gps.push(113.39161405, 23.0680465),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-location-notice")).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { __gps: { hide(n: boolean): void } }).__gps.hide(
      true,
    );
  });
  await expect(marker).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { __gps: { hide(n: boolean): void } }).__gps.hide(
      false,
    );
  });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __gps: { stats(): { watches: number } } }
          ).__gps.stats().watches,
      ),
    )
    .toBe(2);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => {
    (
      window as unknown as {
        __gps: {
          push(lon: number, lat: number): void;
          heading(n: number): void;
        };
      }
    ).__gps.push(113.39171405, 23.0680465);
    (
      window as unknown as { __gps: { heading(n: number): void } }
    ).__gps.heading(180);
  });
  await expect(marker).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { __gps: { stats(): { active: boolean } } }
        ).__gps.stats().active,
    ),
  ).toBe(false);
});
test("place card is compact and route planner has no empty lower block", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const out =
    process.env.E2E_CAPTURE_DIR || "verification/map-location-2026-11-01";
  mkdirSync(out, { recursive: true });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 30000 },
  );
  await page.getByLabel("搜索校园地点").fill("师苑1栋");
  await page
    .locator(".place-result")
    .filter({ hasText: "师苑1栋" })
    .first()
    .click();
  const frame = page.locator(".place-details-frame"),
    title = frame.getByRole("heading", { name: "师苑1栋", exact: true }),
    navigate = frame.getByRole("button", { name: "选择导航终点", exact: true });
  await expect(title).toBeVisible();
  await expect(frame.getByRole("button", { name: "问 AI" })).toHaveCount(0);
  await expect(frame.getByText("收藏需登录账号服务")).toHaveCount(0);
  await expect(frame.getByText("查看来源")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".place-details-panel")
        .evaluate(
          (e) =>
            e.getAnimations().filter((a) => a.playState === "running").length,
        ),
    )
    .toBe(0);
  const geometry = await frame.evaluate((e) => {
    const a = e.querySelector("h2")!.getBoundingClientRect(),
      b = e.querySelector(".primary-button")!.getBoundingClientRect();
    return {
      right: a.right,
      buttonLeft: b.left,
      centerDelta: Math.abs(a.y + a.height / 2 - b.y - b.height / 2),
    };
  });
  expect(geometry.buttonLeft).toBeGreaterThanOrEqual(geometry.right);
  expect(geometry.centerDelta).toBeLessThan(8);
  expect((await frame.boundingBox())!.height).toBeLessThan(190);
  await page.screenshot({
    path: `${out}/${info.project.name}-place.png`,
    fullPage: true,
  });
  await navigate.click();
  await expect(page.locator(".route-planner")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const panel = document
            .querySelector(".route-planner")!
            .getBoundingClientRect(),
          content = document
            .querySelector(".route-planner-content")!
            .getBoundingClientRect();
        return panel.bottom - content.bottom;
      }),
    )
    .toBeLessThan(28);
  await page.screenshot({
    path: `${out}/${info.project.name}-route.png`,
    fullPage: true,
  });
  await expect(page.getByLabel("导航终点")).toHaveValue("师苑1栋");
});

test("mode cycling changes rendering without zooming back to the selected building", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const out =
    process.env.E2E_CAPTURE_DIR || "verification/map-location-2026-11-01";
  mkdirSync(out, { recursive: true });
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 30000 });
  await page.getByLabel("搜索校园地点").fill("南苑12栋");
  await page
    .locator(".place-result")
    .filter({ hasText: "南苑12栋" })
    .first()
    .click();
  await page.getByRole("button", { name: "关闭地点详情", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "缩小地图", exact: true }).click();
    await expect(map).toHaveAttribute("data-camera-moving", "false");
  }
  const zoom = Number(await map.getAttribute("data-zoom"));
  expect(zoom).toBeLessThan(17);
  const trigger = page.getByTestId("map-mode-trigger");
  for (const label of ["2.5D", "3D", "2D"]) {
    await trigger.click();
    await expect(trigger).toHaveText(label);
    await expect(map).toHaveAttribute("data-camera-moving", "false");
    const minimum = Number(await map.getAttribute("data-min-zoom"));
    expect(Number(await map.getAttribute("data-zoom"))).toBeLessThanOrEqual(
      Math.max(zoom, minimum) + 0.05,
    );
  }
  await page.screenshot({
    path: `${out}/${info.project.name}-mode-cycle.png`,
    fullPage: true,
  });
});
