import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";

const baseline = process.env.E2E_NAVIGATION_BASELINE === "1";
const capture =
  process.env.E2E_LIVE_CAPTURE_DIR || "test-results/navigation-live";
async function open(page: Page) {
  if (!(await page.locator("#campus-assistant").isVisible())) {
    const detail = page.locator(".place-details-frame");
    if (await detail.isVisible())
      await detail.getByRole("button", { name: "问 AI", exact: true }).click();
    else await page.getByRole("button", { name: "打开校园助理" }).click();
  }
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled({
    timeout: 15000,
  });
}
async function ask(page: Page, question: string) {
  await open(page);
  await page.getByLabel("向校园助理提问").fill(question);
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "true",
  );
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 70000 },
  );
}
test.beforeEach(async ({ page }) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Requires explicit model-test budget",
  );
  await installAgentEvidence(page);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60000 },
  );
});
test.afterEach(async ({ page, browser }, info) => {
  if (process.env.E2E_LIVE_AGENT !== "1") return;
  await mkdir(capture, { recursive: true });
  const stem = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-${info.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-")}`;
  await page.screenshot({ path: `${capture}/${stem}.png` });
  await writeFile(
    `${capture}/${stem}.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        baseline,
        status: info.status,
        records: await readAgentEvidence(page),
      },
      null,
      2,
    ) + "\n",
  );
});

for (const question of ["南苑7到语心桥", "南苑7栋到语心桥"]) {
  test(`named route in a fresh conversation: ${question}`, async ({ page }) => {
    test.setTimeout(100000);
    let locationRequests = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/agent/location/challenge")) locationRequests++;
    });
    await ask(page, question);
    await open(page);
    if (baseline) {
      await expect(
        page.locator('[data-message-role="assistant"]').last(),
      ).toContainText(/起点|出发|位置|从哪/);
      await expect(page.locator(".route-endpoint")).toHaveCount(0);
    } else {
      await expect(page.locator(".assistant-error")).toHaveCount(0);
      await expect(page.locator(".assistant-route-card").last()).toContainText(
        "南苑7栋 → 语心桥",
      );
      await expect(page.locator(".assistant-route-card").last()).toContainText(
        "806 米",
      );
      await expect(page.getByTestId("campus-map")).toHaveAttribute(
        "data-route-extent",
        /.+/,
      );
      expect((await readAgentEvidence(page)).at(-1)).toMatchObject({
        tools: expect.arrayContaining(["plan_route", "control_map"]),
        result: { metrics: { timings: { mapActionMs: expect.any(Number) } } },
      });
      const clear = page.locator(".map-controls .clear-route-button");
      await expect(clear).toHaveCSS("background-color", "rgb(217, 45, 32)");
      await expect(clear).toHaveCSS("color", "rgb(255, 255, 255)");
    }
    expect(locationRequests).toBe(0);
  });
}

test("destination-only navigation uses authorized location and retains destination after denial", async ({
  page,
  context,
}) => {
  test.skip(baseline);
  test.setTimeout(180000);
  // A controlled browser permission denial; no hardware GPS claim.
  await page.evaluate(() => {
    const realLocation = navigator.geolocation;
    Object.defineProperty(window, "__testRealGeo", { value: realLocation });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_ok: unknown, fail: (e: { code: number }) => void) {
          fail({ code: 1 });
        },
      },
    });
  });
  await ask(page, "我想去北苑5");
  await open(page);
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  const denied = (await readAgentEvidence(page)).at(-1) as { tools: string[] };
  expect(denied.tools).toEqual([]);
  await mkdir(capture, { recursive: true });
  await writeFile(
    `${capture}/${process.env.PLAYWRIGHT_CHANNEL}-denial.json`,
    JSON.stringify(
      {
        permissionDenialBranchSimulated: true,
        actualHardwareGPS: false,
        record: denied,
      },
      null,
      2,
    ) + "\n",
  );
  // Refresh forces the pending user request to recover from real D1 history.
  await page.reload();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 23.0615765,
    longitude: 113.390146,
    accuracy: 8,
  });
  await ask(page, "我的位置");
  await open(page);
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "北苑5栋",
  );
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "我的位置",
  );
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-route-extent",
    /.+/,
  );
  expect((await readAgentEvidence(page)).at(-1)).toMatchObject({
    tools: expect.arrayContaining(["plan_route", "control_map"]),
    result: { metrics: { timings: { mapActionMs: expect.any(Number) } } },
  });
});

test("a first destination-only request directly plans from authorized device location", async ({
  page,
  context,
}) => {
  test.skip(baseline);
  test.setTimeout(100000);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 23.0615765,
    longitude: 113.390146,
    accuracy: 8,
  });
  await ask(page, "我想去北苑5");
  await open(page);
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "我的位置 → 北苑5栋",
  );
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-route-extent",
    /.+/,
  );
  expect((await readAgentEvidence(page)).at(-1)).toMatchObject({
    tools: expect.arrayContaining(["plan_route", "control_map"]),
    result: { metrics: { timings: { mapActionMs: expect.any(Number) } } },
  });
});
