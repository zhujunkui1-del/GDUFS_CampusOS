import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test("reported canteen question uses a collapsed, minimal source list", async ({
  page,
}, info) => {
  test.skip(process.env.E2E_LIVE_AGENT !== "1", "Live model budget required");
  test.setTimeout(120000);
  const dir =
    "docs/verification/assistant-source-disclosure/" + info.project.name;
  await mkdir(dir, { recursive: true });
  await installAgentEvidence(page);
  await page.goto("/map");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  await input.fill(process.env.E2E_SOURCES_PROMPT || "广外一饭有什么好吃的");
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
  const message = page.locator('[data-message-role="assistant"]').last();
  const disclosure = message.locator(".assistant-sources");
  try {
    const citation = message.locator("sup.assistant-citation a").first();
    await expect(citation).toHaveText("【来源】");
    await expect(citation).toHaveAttribute("href", /^https:\/\//);
    await expect(disclosure).toHaveCount(1);
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(
      disclosure.locator(".assistant-source-card").first(),
    ).not.toBeVisible();
    await page.screenshot({ path: dir + "/collapsed.png" });
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    const entries = disclosure.locator(".assistant-source-card");
    expect(await entries.count()).toBeGreaterThan(0);
    for (const entry of await entries.all()) {
      await expect(entry.locator("a")).toHaveCount(1);
      await expect(entry.locator("span")).toHaveCount(1);
      await expect(entry.locator("small,p,details")).toHaveCount(0);
      await expect(entry).not.toContainText(
        /查看证据|正文证据|有效性待确认|原文摘录/,
      );
    }
    await entries.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: dir + "/expanded.png" });
    await disclosure.locator("summary").click();
    await expect(
      disclosure.locator(".assistant-source-card").first(),
    ).not.toBeVisible();
  } finally {
    await writeFile(
      dir + "/live.json",
      JSON.stringify(
        {
          viewport: page.viewportSize(),
          records: await readAgentEvidence(page),
          answer: await message.innerText(),
        },
        null,
        2,
      ),
    );
  }
});
