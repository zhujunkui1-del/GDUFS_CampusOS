import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test.use({ trace: "off", video: "off" });
test("verified S4 user executes a real named-place route through Agent and MapAction", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.S4_LIVE !== "1" ||
      info.project.name !== "desktop" ||
      !existsSync(".map-tools/history-sync/accounts.json"),
    "Controlled live account fixture",
  );
  test.setTimeout(150000);
  const state = JSON.parse(
      readFileSync(".map-tools/history-sync/accounts.json", "utf8"),
    ),
    base = String(info.project.use.baseURL);
  const auth = await context.request.post(base + "/api/auth/login", {
    headers: { Origin: base },
    data: { identifier: state.a.username, password: state.a.password },
  });
  expect(auth.status()).toBe(200);
  await installAgentEvidence(page);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "打开校园助理", exact: true }).click();
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page
    .locator(
      `.assistant-history-row[data-conversation-id="${state.ids[2]}"] .assistant-history-open`,
    )
    .click();
  await page
    .getByLabel("向校园助理提问")
    .fill("从南苑7栋到图书馆怎么走？帮我在地图上显示路线。");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect
    .poll(async () => (await readAgentEvidence(page)).at(-1)?.completeMs, {
      timeout: 110000,
    })
    .toBeTruthy();
  const record = (await readAgentEvidence(page)).at(-1)!;
  mkdirSync("verification/account-history-2026-11-01", { recursive: true });
  writeFileSync(
    ".map-tools/history-sync/map-contract-real.json",
    JSON.stringify(record, null, 2),
  );
  expect((record.result as { error?: unknown }).error).toBeUndefined();
  expect(record.tools).toContain("plan_route");
  expect(record.actions.length).toBeGreaterThan(0);
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-route-extent",
    /.+/,
  );
  await page.screenshot({
    path: "verification/account-history-2026-11-01/account-map-route.png",
  });
  writeFileSync(
    "verification/account-history-2026-11-01/map-contract-real.json",
    JSON.stringify(record, null, 2),
  );
});
