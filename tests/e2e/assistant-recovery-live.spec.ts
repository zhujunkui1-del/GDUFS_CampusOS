import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";

test("real route receipt keeps endpoints visible and restores owned history from another page", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit live API budget required",
  );
  test.setTimeout(90000);
  await installAgentEvidence(page);
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  await expect(input).toBeEnabled();
  await input.fill("从南苑7栋去图书馆。");
  await input.press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "true",
  );
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 60000 },
  );
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const clearance = await page.locator(".route-endpoint").evaluateAll(
    (markers) =>
      markers.length === 2 &&
      markers.every((marker) => {
        const rect = marker.getBoundingClientRect();
        return [".map-top", ".assistant-panel", ".mobile-navigation"].every(
          (selector) => {
            const obstacle = document
              .querySelector(selector)
              ?.getBoundingClientRect();
            return (
              !obstacle ||
              obstacle.width === 0 ||
              obstacle.height === 0 ||
              rect.right <= obstacle.left ||
              rect.left >= obstacle.right ||
              rect.bottom <= obstacle.top ||
              rect.top >= obstacle.bottom
            );
          },
        );
      }),
  );
  expect(clearance).toBe(true);
  const records = await readAgentEvidence(page);
  const dir = process.env.E2E_LIVE_CAPTURE_DIR || "test-results/s2-c-live";
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}-visible-route.png` });
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
  const card = page.locator(".assistant-route-card").last();
  await expect(card).toContainText("南苑7栋 → 图书馆");
  await card.getByRole("button", { name: "显示路线", exact: true }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({ path: `${dir}/${name}-restored-route.png` });
  await writeFile(
    `${dir}/${name}-recovery.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        realModel: true,
        realPhone: false,
        actualMapActionReceipt: true,
        endpointsAvoidOverlays: clearance,
        historyRestoredAfterReload: true,
        routeRestoredOnMapFromAnotherPage: true,
        records,
      },
      null,
      2,
    ) + "\n",
  );
});
