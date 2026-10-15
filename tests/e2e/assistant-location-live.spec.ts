import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";

test("real model uses an explicitly granted browser location, navigation, rejection and cancellation", async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit live API budget required",
  );
  test.setTimeout(180000);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    longitude: 113.390146,
    latitude: 23.0615765,
    accuracy: 10,
  });
  await installAgentEvidence(page);
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  async function open() {
    if (!(await page.locator("#campus-assistant").isVisible())) {
      if (await page.locator(".place-details-frame").isVisible())
        await page
          .locator(".place-details-frame")
          .getByRole("button", { name: "问 AI", exact: true })
          .click();
      else await page.getByRole("button", { name: "打开校园助理" }).click();
    }
    await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
  }
  await open();
  await page
    .getByLabel("向校园助理提问")
    .fill("从我现在的位置到图书馆怎么走？");
  await page.getByLabel("向校园助理提问").press("Enter");
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
  await expect(map).toHaveAttribute("data-route-approach", "dashed");
  const dir = process.env.E2E_LIVE_CAPTURE_DIR || "test-results/s2-c-live";
  await mkdir(dir, { recursive: true });
  const name = `${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  await page.screenshot({ path: `${dir}/${name}-device-route.png` });
  await open();
  await page
    .locator(".assistant-route-card")
    .last()
    .getByRole("button", { name: "开始导航" })
    .click();
  await expect(
    page.getByRole("button", { name: "退出步行导航", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${dir}/${name}-navigation.png` });
  await page.getByRole("button", { name: "退出步行导航", exact: true }).click();
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(
          _success: unknown,
          fail: (e: { code: number }) => void,
        ) {
          fail({ code: 1 });
        },
        clearWatch() {},
      },
    }),
  );
  await open();
  await page.getByLabel("向校园助理提问").fill("从我的位置到图书馆怎么走？");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "true",
  );
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 40000 },
  );
  await expect(
    page.locator('[data-message-role="assistant"]').last(),
  ).toContainText(/起点|授权|定位|从哪|出发/);
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await page.getByLabel("向校园助理提问").fill("从南苑7栋去图书馆。");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await expect
    .poll(async () => (await readAgentEvidence(page)).length)
    .toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "停止回复" }).click();
  await expect(page.locator(".assistant-error")).toContainText("已停止回复");
  await page.waitForTimeout(1000);
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await writeFile(
    `${dir}/${name}-location.json`,
    JSON.stringify(
      {
        realModel: true,
        browser: browser.version(),
        viewport: page.viewportSize(),
        controlledPublicCampusLocation: true,
        actualHardwareGPS: false,
        permissionDenialBranchSimulated: true,
        realRequestCancellation: true,
        records: await readAgentEvidence(page),
      },
      null,
      2,
    ) + "\n",
  );
});
