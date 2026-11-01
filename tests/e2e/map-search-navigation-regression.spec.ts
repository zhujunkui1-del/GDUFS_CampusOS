import { test, expect } from "@playwright/test";
test.use({ trace: "off", video: "off" });
test("empty search closes the panel and removed online controls never appear", async ({
  page,
}) => {
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 30000 },
  );
  const input = page.getByLabel("搜索校园地点");
  await input.fill("图书馆");
  await expect(page.locator("#campus-search-results")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查询高德在线地点" }),
  ).toHaveCount(0);
  await input.fill("");
  await expect(page.locator("#campus-search-results")).toHaveCount(0);
  await input.press("Enter");
  await expect(page.locator("#campus-search-results")).toHaveCount(0);
  await input.fill("   ");
  await expect(page.locator("#campus-search-results")).toHaveCount(0);
});
test("navigation exposes the real map canvas to drag and zoom", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: () => 1,
        clearWatch() {},
        getCurrentPosition() {},
      },
    }),
  );
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 30000 });
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  for (const [which, name] of [
    ["起点", "图书馆"],
    ["终点", "友苑"],
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
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(page.locator(".focused-navigation")).toBeVisible();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const point = await page.evaluate(() => {
    const top = document
        .querySelector(".navigation-direction")!
        .getBoundingClientRect().bottom,
      bottom = document
        .querySelector(".navigation-summary")!
        .getBoundingClientRect().top;
    return { x: innerWidth * 0.45, y: (top + bottom) / 2 };
  });
  const target = await page.evaluate(
    (p) => document.elementFromPoint(p.x, p.y)?.className,
    point,
  );
  expect(String(target)).toContain("maplibregl-canvas");
  const marker = page.locator(".route-start-marker");
  const before = await marker.boundingBox();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 25, { steps: 12 });
  await page.mouse.up();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await expect
    .poll(async () => Math.abs((await marker.boundingBox())!.x - before!.x))
    .toBeGreaterThan(5);
  const zoom = Number(await map.getAttribute("data-zoom"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -250);
  await expect
    .poll(async () => Number(await map.getAttribute("data-zoom")))
    .toBeGreaterThan(zoom);
  if (info.project.name === "mobile") {
    const pinchZoom = Number(await map.getAttribute("data-zoom"));
    const cdp = await page.context().newCDPSession(page);
    const touches = (r: number) => [
      { x: point.x - r, y: point.y, id: 1 },
      { x: point.x + r, y: point.y, id: 2 },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touches(24),
    });
    for (let i = 1; i <= 6; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touches(24 + i * 8),
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await expect
      .poll(async () => Number(await map.getAttribute("data-zoom")))
      .toBeGreaterThan(pinchZoom);
  }
  if (process.env.E2E_CAPTURE_DIR) {
    await page.screenshot({
      path: `${process.env.E2E_CAPTURE_DIR}/${info.project.name}-navigation.png`,
    });
  }
});
