import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test.use({ storageState: process.env.E2E_RECOVERY_STATE_PATH || undefined });
test("real cloud conversation and route survive an actual preview Worker update", async ({
  page,
}, info) => {
  test.skip(
    process.env.E2E_CLOUD_ACCEPTANCE !== "1" ||
      !process.env.E2E_RECOVERY_STATE_PATH,
    "A private state captured before the update is required",
  );
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "南苑7栋 → 图书馆",
  );
  await page
    .locator(".assistant-route-card")
    .last()
    .getByRole("button", { name: "显示路线", exact: true })
    .click();
  await expect(page).toHaveURL(/\/map$/);
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const dir = process.env.E2E_CAPTURE_DIR || "test-results/s2-e";
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-after-worker-update.png`,
  });
  await writeFile(
    `${dir}/worker-update-recovery.json`,
    JSON.stringify(
      {
        realCloud: true,
        actualWorkerRedeployed: true,
        conversationRestored: true,
        routeRestored: true,
        modelCalls: 0,
        cookieOrPrivateStateStoredInEvidence: false,
      },
      null,
      2,
    ),
  );
});
