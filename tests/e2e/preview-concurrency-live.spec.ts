import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test("cloud duplicate request is rejected once and cancelled actions stay absent", async ({
  page,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1" ||
      process.env.E2E_CLOUD_ACCEPTANCE !== "1",
    "Explicit cloud model budget required",
  );
  await installAgentEvidence(page);
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  await expect(input).toBeEnabled();
  const request = page.waitForRequest((r) =>
    r.url().endsWith("/api/agent/chat"),
  );
  await input.fill("从南苑7栋去图书馆。");
  await input.press("Enter");
  const started = await request;
  await expect.poll(async () => (await readAgentEvidence(page)).length).toBe(1);
  const duplicate = await page.request.post("/api/agent/chat", {
    data: started.postDataJSON(),
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(duplicate.status()).toBe(429);
  expect((await duplicate.json()).error.code).toBe("RATE_LIMITED");
  await page.getByRole("button", { name: "停止回复" }).click();
  await expect(page.locator(".assistant-error")).toContainText("已停止回复");
  await page.waitForTimeout(2000);
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  const dir = process.env.E2E_LIVE_CAPTURE_DIR || "test-results/s2-e";
  await mkdir(dir, { recursive: true });
  const prefix = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
  await page.screenshot({ path: `${dir}/${prefix}-cancelled.png` });
  await writeFile(
    `${dir}/${prefix}-concurrency.json`,
    JSON.stringify(
      {
        realCloud: true,
        duplicateStatus: duplicate.status(),
        realCancellation: true,
        lateRouteAbsent: true,
        records: await readAgentEvidence(page),
      },
      null,
      2,
    ),
  );
});
