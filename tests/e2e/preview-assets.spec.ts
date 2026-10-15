import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { selectMapMode } from "./helpers/map-mode";
test("public HTTPS assets retain the fixed map, model hash and cache validators", async ({
  page,
}, info) => {
  const hosts = new Set<string>();
  const mapAssets = new Set<string>();
  page.on("request", (r) => {
    const url = new URL(r.url());
    hosts.add(url.hostname);
    if (/\/maps\/campus-.*\.geojson$/.test(url.pathname))
      mapAssets.add(url.pathname);
  });
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await expect(map).toHaveAttribute("data-engine", "maplibre-local");
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await selectMapMode(page, "3D");
  await expect(map).toHaveAttribute("data-model-state", "ready");
  expect([...hosts].some((h) => /amap|autonavi/.test(h))).toBe(false);
  expect(mapAssets.size).toBeGreaterThan(0);
  const assets = [];
  for (const path of [
    ...mapAssets,
    "/fonts/campus-ui-sc.woff2",
    "/models/nanyuan7/nanyuan7-v2-54cc55342ae5.glb",
  ]) {
    const r = await page.request.get(path);
    expect(r.status()).toBe(200);
    const bytes = await r.body();
    const etag = r.headers().etag;
    const second = etag
      ? await page.request.get(path, { headers: { "If-None-Match": etag } })
      : null;
    if (second) expect(second.status()).toBe(304);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (path.endsWith(".glb"))
      expect(sha).toBe(
        "54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a",
      );
    assets.push({
      path,
      bytes: bytes.length,
      etagPresent: !!etag,
      conditionalStatus: second?.status(),
      cacheControl: r.headers()["cache-control"],
      contentType: r.headers()["content-type"],
      ...(path.endsWith(".glb") ? { sha256: sha } : {}),
    });
  }
  const dir = process.env.E2E_CAPTURE_DIR || "test-results/s2-e";
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-assets.json`,
    JSON.stringify(
      {
        actualCloud: true,
        actualPhone: false,
        hosts: [...hosts],
        mapVersion: await map.getAttribute("data-map-version"),
        assets,
      },
      null,
      2,
    ),
  );
});
