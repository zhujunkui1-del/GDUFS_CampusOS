import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test.skip(
  process.env.AGENT_PERSONA_LIVE !== "1",
  "Explicit Preview persona acceptance only",
);
test.use({ trace: "off" });
test.setTimeout(180000);
test("real Preview preserves persona controls and renders a grounded Agent answer", async ({
  page,
}, info) => {
  const responses: unknown[] = [];
  page.on("response", async (r) => {
    if (!r.url().endsWith("/api/agent/chat")) return;
    const text = await r.text().catch(() => "");
    const events = text.split("\n\n").flatMap((frame) => {
      const data = frame.split("\n").find((l) => l.startsWith("data:"));
      try {
        return data ? [JSON.parse(data.slice(5))] : [];
      } catch {
        return [];
      }
    });
    responses.push({
      http: r.status(),
      answer: events
        .filter((e) => e.type === "message.delta")
        .map((e) => e.payload.text)
        .join(""),
      tools: events
        .filter((e) => e.type === "tool.started")
        .map((e) => e.payload),
      final: events.find(
        (e) => e.type === "run.completed" || e.type === "run.failed",
      )?.payload,
    });
  });
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("向校园助理提问");
  if (!(await input.isVisible()))
    await page.getByRole("button", { name: "打开校园助理" }).click();
  async function ask(text: string) {
    const incoming = page.waitForResponse((r) =>
      r.url().endsWith("/api/agent/chat"),
    );
    await input.fill(text);
    await input.press("Enter");
    await (await incoming).finished();
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "false",
      { timeout: 100000 },
    );
    const last = page.locator('[data-message-role="assistant"]').last();
    await expect(last).not.toBeEmpty();
    return last;
  }
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
  await mkdir("docs/verification/agent-persona-2026-10-27", {
    recursive: true,
  });
  await page.screenshot({
    path: `docs/verification/agent-persona-2026-10-27/preview-${info.project.name}.png`,
    fullPage: false,
  });
  await writeFile(
    `docs/verification/agent-persona-2026-10-27/ui-${info.project.name}.json`,
    JSON.stringify(responses, null, 2),
  );
});
