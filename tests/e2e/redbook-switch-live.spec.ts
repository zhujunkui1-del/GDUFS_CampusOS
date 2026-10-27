import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
import { previewConsoleCredential } from "./helpers/console-credential";
import { publicEvaluationReceipt } from "../../scripts/evaluate-redbook.mjs";

test.skip(
  process.env.REDBOOK_SWITCH_LIVE !== "1",
  "Explicit Preview backend cutover acceptance",
);
test.use({ trace: "off" });
test.setTimeout(150000);
const folder =
  "docs/verification/redbook-switch-2026-10-27" +
  (process.env.REDBOOK_NEXT_ACCOUNT === "1" ? "/next-account" : "");
test("Preview Agent searches real XHS notes through the new cloud backend and renders citations", async ({
  page,
}) => {
  await installAgentEvidence(page);
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("向校园助理提问");
  await expect(async () => {
    if (!(await input.isVisible()))
      await page.getByRole("button", { name: "打开校园助理" }).click();
    await expect(input).toBeVisible({ timeout: 2000 });
  }).toPass({ intervals: [1000, 2000], timeout: 20000 });
  await input.fill(
    "广外南校一饭有什么好吃的？简短说两条，根据实际搜到的学生体验回答并注明来源。",
  );
  await input.press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "true",
  );
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 100000 },
  );
  const last = page.locator('[data-message-role="assistant"]').last();
  const evidence = await readAgentEvidence(page);
  await mkdir(folder, { recursive: true });
  await writeFile(
    ".map-tools/xhs-provider-eval/preview-agent-raw.json",
    JSON.stringify({ evidence, answer: await last.innerText() }, null, 2),
  );
  await writeFile(
    folder + "/preview-agent.json",
    JSON.stringify(
      publicEvaluationReceipt({ evidence, answer: await last.innerText() }),
      null,
      2,
    ),
  );
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  expect(JSON.stringify(evidence)).toContain("xiaohongshu_redbook_cloud");
  expect(JSON.stringify(evidence)).toContain("search_external_campus_info");
  const sources = last.locator(".assistant-sources");
  await sources.locator("summary").click();
  const links = last.locator(
    '.assistant-source-list a[href*="xiaohongshu.com/explore/"]',
  );
  await expect(links.first()).toBeVisible();
  const answer = await last.locator("p").allTextContents();
  expect(answer.join("")).not.toMatch(/外部.*(?:未取得|不可用)|小红书.*未登录/);
  const href = await links.first().getAttribute("href");
  const citations = last.locator('sup a[href*="xiaohongshu.com"]');
  await writeFile(
    folder + "/rendered-citations.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        linkCount: await links.count(),
        firstLink: href,
        inlineCitations: await citations.count(),
        answerSha256: createHash("sha256")
          .update(answer.join("\n"))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: folder + "/preview-agent.png" });
});
test("admin status uses the active new SDK session without reopening the retired account", async ({
  page,
}) => {
  await page.goto("/admin");
  const values = JSON.parse(
    await readFile(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(values));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const panel = page.locator(".console-source-session");
  await expect(
    panel.getByRole("button", { name: "检测登录状态", exact: true }),
  ).toBeEnabled({ timeout: 40000 });
  await expect(panel.locator(".console-session-state")).toHaveText("已登录", {
    timeout: 40000,
  });
  await expect(panel.getByAltText("小红书登录二维码")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /切换后端|回退后端/ }),
  ).toHaveCount(0);
  await mkdir(folder, { recursive: true });
  await writeFile(
    folder + "/admin.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        actualCloudStatus: "logged_in",
        accountProfile:
          process.env.REDBOOK_NEXT_ACCOUNT === "1"
            ? "next-account"
            : "original",
        backendSelectorAdded: false,
      },
      null,
      2,
    ),
  );
  await panel.screenshot({ path: folder + "/admin.png" });
});
