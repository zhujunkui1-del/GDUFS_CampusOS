import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test("persistent source session answers the actual canteen question and explicit followup", async ({
  page,
}) => {
  test.skip(process.env.E2E_LIVE_AGENT !== "1", "Live model budget required");
  test.setTimeout(180000);
  const dir = "docs/verification/xhs-persistent-session/browser";
  await mkdir(dir, { recursive: true });
  await installAgentEvidence(page);
  await page.goto("/map");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  try {
    for (const [index, prompt] of [
      "广外南校一饭有什么好吃的",
      "调用小红书来查",
    ].entries()) {
      await expect(input).toBeEnabled();
      await input.fill(prompt);
      await input.press("Enter");
      await expect(page.locator("#assistant-launcher")).toHaveAttribute(
        "data-busy",
        "true",
      );
      await expect(page.locator("#assistant-launcher")).toHaveAttribute(
        "data-busy",
        "false",
        { timeout: 90000 },
      );
      await expect(page.locator(".assistant-error")).toHaveCount(0);
      const msg = page.locator('[data-message-role="assistant"]').last();
      const disclosure = msg.locator(".assistant-sources");
      await expect(disclosure).toHaveCount(1);
      await disclosure.locator("summary").click();
      await expect(
        msg
          .locator('.assistant-source-card a[href*="xiaohongshu.com"]')
          .first(),
      ).toBeVisible();
      await page.screenshot({ path: dir + "/" + index + ".png" });
      const records = (await readAgentEvidence(page)) as {
        tools: string[];
        result?: {
          metrics?: {
            timings?: {
              externalSearch?: {
                providers: {
                  provider: string;
                  status: string;
                  count: number;
                }[];
              }[];
            };
          };
        };
      }[];
      expect(records[index].tools).toContain("search_external_campus_info");
      expect(
        records[index].result?.metrics?.timings?.externalSearch
          ?.flatMap((x) => x.providers)
          .some(
            (p) =>
              p.provider === "xiaohongshu_browser_local" &&
              p.status === "ok" &&
              p.count > 0,
          ),
      ).toBe(true);
    }
  } finally {
    await writeFile(
      dir + "/live.json",
      JSON.stringify(
        {
          viewport: page.viewportSize(),
          records: await readAgentEvidence(page),
          answers: await page
            .locator('[data-message-role="assistant"]')
            .allInnerTexts(),
        },
        null,
        2,
      ),
    );
  }
});
