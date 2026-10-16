import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test("real cloud model queries verified dormitory details", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1" ||
      process.env.E2E_CLOUD_ACCEPTANCE !== "1",
    "Explicit cloud model budget required",
  );
  test.setTimeout(60000);
  await installAgentEvidence(page);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  await expect(input).toBeEnabled();
  await input.fill(
    "查询南苑7栋的详细资料：它属于哪个区域、有多少层、高约多少米？请先查询地点详情，再按已核实资料回答。",
  );
  await input.press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "true",
  );
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 45000 },
  );
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  const records = await readAgentEvidence(page);
  expect(records[0]).toMatchObject({
    tools: expect.arrayContaining(["get_place_details"]),
  });
  // A successful focus action collapses the phone sheet. Reopen the same
  // assistant before asserting its actual answer; retain all tool/text checks.
  if (!(await page.locator("#campus-assistant").isVisible())) {
    if (await page.locator(".place-details-frame").isVisible())
      await page
        .locator(".place-details-frame")
        .getByRole("button", { name: "问 AI", exact: true })
        .click();
    else await page.getByRole("button", { name: "打开校园助理" }).click();
  }
  const answer = page.locator('[data-message-role="assistant"]').last();
  await expect(answer).toContainText(/(?:7|七)\s*层/);
  await expect(answer).toContainText(/21\s*米/);
  const dir = process.env.E2E_LIVE_CAPTURE_DIR || "test-results/s2-e";
  await mkdir(dir, { recursive: true });
  const prefix = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
  await page.screenshot({ path: `${dir}/${prefix}-verified-details.png` });
  await writeFile(
    `${dir}/${prefix}-details-live.json`,
    JSON.stringify(
      {
        realModel: true,
        realCloud: true,
        browser: browser.version(),
        viewport: page.viewportSize(),
        records,
      },
      null,
      2,
    ),
  );
});
