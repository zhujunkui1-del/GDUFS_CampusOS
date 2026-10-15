import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test("an AI route has direct clear controls on its card and the map", async ({
  page,
  isMobile,
}, info) => {
  const capture = process.env.E2E_CAPTURE_DIR || "test-results/s2-d";
  await mkdir(capture, { recursive: true });
  const prefix = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
  const response = await page.request.post("/api/map/skills/plan_route", {
    data: {
      input: {
        start: { type: "place", placeId: "osm-way-312536955" },
        endPlaceId: "osm-way-307250998",
        mode: "walking",
      },
    },
  });
  expect(response.ok()).toBe(true);
  const route = (await response.json()).data.data;
  const card = {
    kind: "route",
    routeId: route.routeId,
    startName: route.start.name,
    endName: route.end.name,
    distanceMeters: route.distanceMeters,
    estimatedMinutes: route.estimatedMinutes,
    expiresAt: route.expiresAt,
    device: false,
  };
  await page.route("**/api/agent/session", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: {
          scopeKey: "isolated-history-with-real-route",
          kind: "guest",
          model: { ready: true },
          history: {
            conversationId: randomUUID(),
            selectedPlaceId: null,
            activeRouteId: route.routeId,
            messages: [
              {
                id: "test-history",
                role: "assistant",
                text: "",
                cards: [card],
              },
            ],
          },
        },
      },
    }),
  );
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  async function open() {
    if (!(await page.locator("#campus-assistant").isVisible()))
      await page.getByRole("button", { name: "打开校园助理" }).click();
    await expect(page.locator(".assistant-route-card")).toBeVisible();
  }
  await open();
  await page
    .locator(".assistant-route-card")
    .getByRole("button", { name: "显示路线", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(page.locator(".route-endpoint")).toHaveCount(2);
  await open();
  await page.screenshot({
    path: `${capture}/${prefix}-route-clear-before.png`,
  });
  await page
    .locator(".assistant-route-card")
    .getByRole("button", { name: "清除路线", exact: true })
    .click({ timeout: 3000 });
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await expect(page.locator(".assistant-route-card")).toBeVisible();
  await page.screenshot({ path: `${capture}/${prefix}-route-clear-after.png` });
  await page
    .locator(".assistant-route-card")
    .getByRole("button", { name: "显示路线", exact: true })
    .click();
  if (isMobile) await expect(page.locator("#campus-assistant")).toBeHidden();
  else if (await page.locator("#campus-assistant").isVisible())
    await page.getByRole("button", { name: "收起校园助理" }).click();
  await page
    .locator(".map-controls")
    .getByRole("button", { name: "清除路线", exact: true })
    .click();
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
});
