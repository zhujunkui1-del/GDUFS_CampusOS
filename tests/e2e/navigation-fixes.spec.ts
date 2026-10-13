import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
const campus: { places: { name: string; coordinate: [number, number] }[] } =
  JSON.parse(
    await readFile("src/features/campus-map/data/campus.json", "utf8"),
  );

test("place focus avoids the open mobile assistant drawer", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Mobile bottom drawer");
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await page.getByLabel("搜索校园地点").fill("实验楼C栋");
  const before = Number(
    await page
      .getByTestId("campus-map")
      .getAttribute("data-camera-animation-count"),
  );
  await page.locator(".place-result").filter({ hasText: "实验楼C栋" }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("campus-map")
          .getAttribute("data-camera-animation-count"),
      ),
    )
    .toBeGreaterThan(before);
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  const point = await page
    .getByRole("button", { name: "查看实验楼C栋", exact: true })
    .boundingBox();
  const ai = await page.locator(".assistant-panel").boundingBox();
  expect(point!.x).toBeGreaterThan(10);
  expect(point!.x + point!.width).toBeLessThan(390);
  expect(point!.y + point!.height).toBeLessThan(ai!.y);
});

test("narrow Chrome and Edge render route, clear exit and keep canvas full screen", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 608, height: 871 });
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  for (const [which, name] of [
    ["起点", "教学楼B栋"],
    ["终点", "实验楼C栋"],
  ]) {
    await page.getByLabel("导航" + which).fill(name);
    await page
      .getByRole("region", { name: which + "地点建议" })
      .getByRole("button", { name: new RegExp(name) })
      .first()
      .click();
    await expect(map).toHaveAttribute("data-camera-moving", "false");
  }
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const startButton = await page
    .getByRole("button", { name: "开始步行导航", exact: true })
    .boundingBox();
  const planner = await page.locator(".route-planner").boundingBox();
  expect(startButton!.y + startButton!.height).toBeLessThan(
    planner!.y + planner!.height,
  );
  await expect(page.getByRole("button", { name: "打开校园助理" })).toBeHidden();
  const dir =
    process.env.E2E_CAPTURE_DIR || "docs/screenshots/s1/navigation-fixes";
  await mkdir(dir, { recursive: true });
  const prefix = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  const screenshot = await page.screenshot({
    path: `${dir}/${prefix}-b-to-c.png`,
  });
  const { data, info: pixels } = await sharp(screenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let longestGreyRun = 0;
  for (let y = 0; y < pixels.height; y++) {
    let run = 0;
    for (let x = 0; x < pixels.width; x++) {
      const i = (y * pixels.width + x) * 3;
      run =
        data[i] === 236 && data[i + 1] === 240 && data[i + 2] === 239
          ? run + 1
          : 0;
      longestGreyRun = Math.max(longestGreyRun, run);
    }
  }
  expect(longestGreyRun).toBeLessThan(
    80 * (info.project.name === "mobile" ? 3 : 1),
  );
  const evidence = await page.evaluate(() => {
    const canvas =
      document.querySelector<HTMLCanvasElement>(".maplibregl-canvas")!;
    const bounds = canvas.getBoundingClientRect();
    return {
      bounds: bounds.toJSON(),
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      canvas: [canvas.getAttribute("width"), canvas.getAttribute("height")],
      alpha: canvas.getContext("webgl2")?.getContextAttributes()?.alpha,
      greyElements: [...document.querySelectorAll("*")]
        .filter(
          (el) => getComputedStyle(el).backgroundColor === "rgb(236, 240, 239)",
        )
        .map((el) => ({
          tag: el.tagName,
          classes: el.className,
          bounds: el.getBoundingClientRect().toJSON(),
        })),
    };
  });
  await writeFile(
    `${dir}/${prefix}-render.json`,
    JSON.stringify(
      {
        ...evidence,
        longestGreyRun,
        route: await page.locator(".route-result h3").innerText(),
        routeMock: false,
      },
      null,
      2,
    ),
  );
  expect(evidence.bounds.width).toBe(608);
  expect(evidence.bounds.height).toBe(871);
  expect(evidence.alpha).toBe(true); // MapLibre requires the alpha buffer.
  await expect(page.locator(".route-result")).toContainText("经过语心桥");
  await expect(
    page.locator(".source-caption, .place-position, .place-source"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关闭导航面板" }).click();
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await expect(page.locator(".campus-marker.selected")).toHaveCount(0);
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
});

test("device start uses a dashed approach and clears on navigation exit", async ({
  page,
  context,
}, info) => {
  const origin = campus.places.find((p) => p.name === "北苑1栋")!.coordinate;
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    longitude: origin[0],
    latitude: origin[1],
    accuracy: 10,
  });
  const providerRequests: string[] = [];
  page.on("request", (r) => {
    if (/amap\.com|\/api\/map\/(config|coordinates)/.test(r.url()))
      providerRequests.push(r.url());
  });
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page
    .getByRole("button", { name: "我的位置作起点", exact: true })
    .click();
  await expect(page.getByLabel("导航起点")).toHaveValue("我的位置");
  await page.getByLabel("导航终点").fill("实验楼C栋");
  await page
    .getByRole("region", { name: "终点地点建议" })
    .getByRole("button", { name: /实验楼C栋/ })
    .click();
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toContainText("前往最近步道");
  await expect(map).toHaveAttribute("data-route-approach", "dashed");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({
    path: `${process.env.E2E_CAPTURE_DIR || "docs/screenshots/s1/navigation-fixes"}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-device-start.png`,
  });
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "步行导航模式" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出步行导航", exact: true }).click();
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await expect(page.locator(".campus-marker.selected")).toHaveCount(0);
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await expect(map).not.toHaveAttribute("data-route-approach", /.+/);
  await expect(page.getByLabel("导航起点")).toHaveValue("");
  expect(providerRequests).toHaveLength(0);
});

test("camera renders intermediate frames and slows toward an unobstructed endpoint", async ({
  page,
}, info) => {
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page.getByLabel("导航终点").fill("实验楼C栋");
  const frames = page.evaluate(
    () =>
      new Promise<{ t: number; x: number; y: number }[]>((resolve) => {
        const el = document.querySelector<HTMLElement>(
          '[data-place-id="osm-node-3125808994"]',
        )!;
        const start = performance.now(),
          values: { t: number; x: number; y: number }[] = [];
        const sample = () => {
          const t = performance.now() - start;
          const match = [
            ...el.style.transform.matchAll(
              /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/g,
            ),
          ].at(-1);
          if (match)
            values.push({ t, x: Number(match[1]), y: Number(match[2]) });
          if (t < 1100) requestAnimationFrame(sample);
          else resolve(values);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page
    .getByRole("region", { name: "终点地点建议" })
    .getByRole("button", { name: /实验楼C栋/ })
    .click();
  const values = await frames;
  await writeFile(
    `${process.env.E2E_CAPTURE_DIR || "docs/screenshots/s1/navigation-fixes"}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-motion.json`,
    JSON.stringify(
      {
        duration: await map.getAttribute("data-last-camera-duration"),
        cameraFrames: await map.getAttribute("data-camera-frame-count"),
        reducedMotion: await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
        values,
      },
      null,
      2,
    ),
  );
  expect(
    new Set(values.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)).size,
  ).toBeGreaterThan(8);
  const first = values[0],
    last = values.at(-1)!;
  const distance = (p: typeof first) => Math.hypot(p.x - last.x, p.y - last.y);
  const halfway = values.find((p) => distance(p) < distance(first) * 0.5)!;
  const nearly = values.find((p) => distance(p) < distance(first) * 0.05)!;
  const began = values.find((p) => distance(p) < distance(first) * 0.99)!;
  expect(halfway.t).toBeLessThan(nearly.t);
  expect(halfway.t - began.t).toBeLessThan(nearly.t - halfway.t);
  const marker = await page
    .getByRole("button", { name: "查看实验楼C栋", exact: true })
    .boundingBox();
  const panel = await page.locator(".route-planner").boundingBox();
  const search = await page.locator(".map-top").boundingBox();
  expect(marker!.y).toBeGreaterThan(search!.y + search!.height);
  if (info.project.name === "mobile")
    expect(marker!.y + marker!.height).toBeLessThan(panel!.y);
});
