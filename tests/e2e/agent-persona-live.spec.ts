import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test.skip(
  process.env.AGENT_PERSONA_LIVE !== "1",
  "Explicit Preview persona acceptance only",
);
test.use({ trace: "off" });
test.setTimeout(180000);
test("real Preview preserves persona controls and renders a grounded Agent answer", async ({
  page,
}, info) => {
  await installAgentEvidence(page);
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("向校园助理提问");
  await expect(async () => {
    if (!(await input.isVisible()))
      await page.getByRole("button", { name: "打开校园助理" }).click();
    await expect(input).toBeVisible({ timeout: 2000 });
  }).toPass({ intervals: [1000, 2000], timeout: 20000 });
  async function ask(text: string) {
    const before = (await readAgentEvidence(page)).length;
    await input.fill(text);
    await input.press("Enter");
    await expect
      .poll(
        async () => {
          const evidence = (await readAgentEvidence(page)) as {
            result: unknown;
          }[];
          return evidence.length > before && evidence[before].result !== null;
        },
        { timeout: 100000 },
      )
      .toBe(true);
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "false",
      { timeout: 10000 },
    );
    const last = page.locator('[data-message-role="assistant"]').last();
    await expect(last).not.toBeEmpty();
    return last;
  }
  try {
    await ask("给你小鱼干");
    const off = await ask("别演了");
    await expect(off).toContainText("正常语气");
    const plain = await ask("给你小鱼干");
    await expect(plain).not.toContainText("本鱼");
    await ask("恢复刚才的说话方式");
    const fish = await ask("给你小鱼干");
    await expect(fish).toContainText("本鱼");
    await ask("查询广外讲座资料，按原文说明举办时间，只用内部资料回答");
    await expect(page.locator(".assistant-error")).toHaveCount(0);
  } finally {
    await mkdir("docs/verification/agent-persona-2026-10-27", {
      recursive: true,
    });
    await page.screenshot({
      path: `docs/verification/agent-persona-2026-10-27/preview-${info.project.name}.png`,
      fullPage: false,
    });
    await writeFile(
      `docs/verification/agent-persona-2026-10-27/ui-${info.project.name}.json`,
      JSON.stringify(await readAgentEvidence(page), null, 2),
    );
  }
});
