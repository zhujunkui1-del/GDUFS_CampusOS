import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test("real 3D control waits for the loaded model and settled camera receipt", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit live API budget required",
  );
  test.setTimeout(60000);
  await installAgentEvidence(page);
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".place-result").filter({ hasText: "南苑7栋" }).click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  await expect(input).toBeEnabled();
  await input.fill("把地图切换成3D。");
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
  await expect(map).toHaveAttribute("data-mode", "3d");
  await expect(map).toHaveAttribute("data-model-state", "ready");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const dir = process.env.E2E_LIVE_CAPTURE_DIR || "test-results/s2-d";
  await mkdir(dir, { recursive: true });
  const prefix = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
  await page.screenshot({ path: `${dir}/${prefix}-settled-3d.png` });
  await writeFile(
    `${dir}/${prefix}-mode-live.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        realPhone: false,
        realModel: true,
        records: await readAgentEvidence(page),
      },
      null,
      2,
    ),
  );
});
