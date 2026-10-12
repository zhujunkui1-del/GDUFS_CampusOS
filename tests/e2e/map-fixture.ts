import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

export async function mockAMap(page: Page) {
  await page.route("**/api/map/coordinates", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          coordinatesGcj02: route.request().postDataJSON().coordinates,
          crs: "GCJ-02",
        },
        requestId: "fixture-only",
      },
    }),
  );
  const script = await readFile("tests/fixtures/amap-sdk.js", "utf8");
  await page.route("**/api/map/config", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          configured: true,
          webKey: "fixture-public-js-key",
          securityProxyPath: "/_AMapService",
          sdkVersion: "2.0",
        },
        requestId: "fixture-only",
      },
    }),
  );
  await page.route("https://webapi.amap.com/maps?**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: script }),
  );
}
