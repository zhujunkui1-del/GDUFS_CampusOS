import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.MODEL_V2_PREVIEW_URL;
test.skip(
  !url,
  "Explicit standalone model review; no production map integration",
);

test("standalone V2 renders four views, fits the viewport and sleeps when idle", async ({
  page,
}, info) => {
  const errors: string[] = [],
    hosts: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => hosts.push(new URL(request.url()).host));
  await page.goto(url!);
  const canvas = page.locator("#model");
  await expect(canvas).toHaveAttribute("data-ready", "true", {
    timeout: 30000,
  });
  await expect(canvas).toHaveAttribute("data-moving", "false");
  await expect(canvas).toHaveAttribute("data-model-draw-calls", "7");
  await expect(canvas).toHaveAttribute("data-map-integrated", "false");
  const folder = "docs/model-previews/nanyuan7-v2/screenshots";
  await mkdir(folder, { recursive: true });
  const name =
    (process.env.PLAYWRIGHT_CHANNEL || "chromium") + "-" + info.project.name;
  for (const [label, view] of [
    ["整体", "overall"],
    ["立面", "facade"],
    ["中庭", "courtyard"],
    ["俯视", "roof"],
  ]) {
    const before = Number(await canvas.getAttribute("data-frames"));
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(canvas).toHaveAttribute("data-view", view);
    await expect(canvas).toHaveAttribute("data-moving", "false");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-frames")))
      .toBeGreaterThan(before);
    if (view !== "courtyard") {
      const extent = JSON.parse(
        (await canvas.getAttribute("data-model-extent"))!,
      );
      expect(extent[0]).toBeGreaterThanOrEqual(10);
      expect(extent[1]).toBeGreaterThanOrEqual(75);
      expect(extent[2]).toBeLessThanOrEqual(page.viewportSize()!.width - 10);
      expect(extent[3]).toBeLessThanOrEqual(page.viewportSize()!.height - 80);
    }
    await page.screenshot({ path: `${folder}/${name}-${view}.png` });
  }
  const frames = Number(await canvas.getAttribute("data-frames"));
  await page.waitForTimeout(700);
  expect(Number(await canvas.getAttribute("data-frames"))).toBe(frames);
  await writeFile(
    `${folder}/${name}-evidence.json`,
    JSON.stringify(
      await canvas.evaluate((el) => ({
        version: el.dataset.modelVersion,
        bytes: el.dataset.modelBytes,
        triangles: el.dataset.modelTriangles,
        modelDrawCalls: el.dataset.modelDrawCalls,
        sceneDrawCalls: el.dataset.drawCalls,
        viewport: [innerWidth, innerHeight],
        devicePixelRatio,
        actualPhone: false,
        standalone: true,
      })),
      null,
      2,
    ) + "\n",
  );
  expect(errors).toEqual([]);
  expect(hosts.every((host) => host === "127.0.0.1:3012")).toBe(true);
});

test("standalone V2 handles a missing GLB without showing fake success", async ({
  page,
}) => {
  await page.route("**/nanyuan7-v2.glb", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.goto(url!);
  await expect(page.locator("#model")).toHaveAttribute("data-ready", "error", {
    timeout: 30000,
  });
  await expect(page.getByRole("status")).toContainText("模型加载失败");
});
