import { test, expect } from "@playwright/test";
import { selectMapMode } from "./helpers/map-mode";
test.setTimeout(60000);

test("slow detailed GeoJSON does not block place search or the initial campus geometry", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/maps/*.geojson", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto("/map", { waitUntil: "domcontentloaded" });
    const map = page.getByTestId("campus-map");
    await expect(map).toHaveAttribute("data-status", "ready", {
      timeout: 6000,
    });
    expect(await map.getAttribute("data-base-data-state")).not.toBe("ready");
    await page.getByLabel("搜索校园地点").fill("图书馆");
    await page
      .locator(".place-result")
      .filter({ hasText: "图书馆" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "图书馆", exact: true }),
    ).toBeVisible();
    release();
    await expect(map).toHaveAttribute("data-base-data-state", "ready", {
      timeout: 10000,
    });
  } finally {
    release();
  }
});
test("basic map remains usable without WebGL2 (fault injection, not a phone result)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (
        type === "webgl2" ||
        type === "webgl" ||
        type === "experimental-webgl"
      )
        return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const map = page.getByTestId("campus-map");
  await expect
    .poll(async () => map.getAttribute("data-status"), { timeout: 25000 })
    .toMatch(/ready|error/);
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 1000 });
  await expect(page.locator(".basic-map-canvas")).toBeVisible();
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await page
    .locator(".place-result")
    .filter({ hasText: "图书馆" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "图书馆", exact: true }),
  ).toBeVisible();
});

test("low memory is a budget hint; 2.5D and 3D remain usable, with no model downloads in initial 2D", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "deviceMemory", {
      value: 2,
      configurable: true,
    }),
  );
  const models: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(".glb")) models.push(r.url());
  });
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await expect(map).toHaveAttribute("data-renderer", "webgl2");
  expect(models).toHaveLength(0);
  await expect(map).toHaveAttribute("data-render-profile", "conservative");
  await selectMapMode(page, "2.5D");
  await expect
    .poll(
      async () => Number(await map.getAttribute("data-campus-model-count")),
      { timeout: 30000 },
    )
    .toBe(29);
  expect(models.some((url) => url.includes("-3d-"))).toBe(false);
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-state", "ready", {
    timeout: 30000,
  });
  await expect
    .poll(async () =>
      Number(await map.getAttribute("data-campus-model-details")),
    )
    .toBeGreaterThan(0);
  await expect(map).toHaveAttribute("data-campus-model-pending", "0", {
    timeout: 30000,
  });
  expect(Number(await map.getAttribute("data-campus-model-details"))).toBe(28);
  expect(await map.getAttribute("data-campus-model-failed")).toBe("[]");
});

test("unrestored GPU context falls back once and preserves usable search and route planning", async ({
  page,
}) => {
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  const supported = await page.evaluate(() => {
    const gl = document
        .querySelector<HTMLCanvasElement>(".maplibregl-canvas")!
        .getContext("webgl2"),
      ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  expect(supported).toBe(true);
  await expect(map).toHaveAttribute("data-renderer", "canvas2d", {
    timeout: 13000,
  });
  await expect(map).toHaveAttribute("data-status", "ready");
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
  await expect(page.locator(".basic-map-canvas")).toBeVisible();
});

test("broken model payload never disables basic map search", async ({
  page,
}) => {
  await page.route("**/models/**/*.glb", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html>missing model</html>",
    }),
  );
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await selectMapMode(page, "3D", true);
  await expect(map).toHaveAttribute("data-model-state", "error");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await page
    .locator(".place-result")
    .filter({ hasText: "图书馆" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "图书馆", exact: true }),
  ).toBeVisible();
});
