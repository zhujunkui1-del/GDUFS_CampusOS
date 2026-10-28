import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
import {
  containsToolProtocol,
  asksForSearchPermission,
} from "../../src/lib/assistant-output";
test.skip(
  process.env.FOOD_AGENT_LIVE !== "1",
  "Explicit real Preview food/search acceptance",
);
test.use({ trace: "off" });
test.setTimeout(240000);
test("food answers use related evidence and real searches without pseudo tool calls", async ({
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
  async function ask(message: string) {
    const index = (await readAgentEvidence(page)).length;
    await input.fill(message);
    await input.press("Enter");
    await expect
      .poll(
        async () => {
          const rows = (await readAgentEvidence(page)) as { result: unknown }[];
          return rows.length > index && rows[index].result !== null;
        },
        { timeout: 105000 },
      )
      .toBe(true);
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "false",
      { timeout: 10000 },
    );
    const row = (await readAgentEvidence(page))[index] as {
      response: string;
      tools: string[];
      cards: { title: string; kind: string; evidenceKind?: string }[];
      result: {
        error?: unknown;
        metrics: {
          answerMode: string;
          modelFailureCode?: string;
          timings: {
            externalSearch: {
              providers: { provider: string; status: string; count: number }[];
            }[];
          };
        };
      };
    };
    expect(row.result.error).toBeUndefined();
    expect(row.response.trim()).not.toBe("");
    expect(containsToolProtocol(row.response)).toBe(false);
    expect(asksForSearchPermission(row.response)).toBe(false);
    if (row.result.metrics.answerMode !== "evidence_excerpt")
      expect(row.response).not.toMatch(
        /本鱼.{0,8}(?:逛遍|吃过|去过)|性价比之王|基本不踩雷/,
      );
    return row;
  }
  try {
    const first = await ask("有什么好吃的吗");
    expect(first.cards.map((c) => c.title).join(" ")).not.toMatch(
      /LSE|主题书展|新书速递|GESP考试|校园卡充值/,
    );
    expect(first.tools).toContain("search_external_campus_info");
    const second = await ask("广外大学城校区有几个食堂，第一食堂有什么好吃的");
    expect(second.tools).toContain("search_external_campus_info");
    expect(
      second.cards.some(
        (c) =>
          c.kind === "external_source" && c.evidenceKind === "page_excerpt",
      ),
    ).toBe(true);
    expect(
      second.result.metrics.timings.externalSearch
        .flatMap((r) => r.providers)
        .some(
          (p) =>
            p.provider === "xiaohongshu_redbook_cloud" &&
            p.status === "ok" &&
            p.count > 0,
        ),
    ).toBe(true);
    await ask("帮我找下广外的二次元社团");
    await expect(page.locator(".assistant-error")).toHaveCount(0);
  } finally {
    await mkdir("docs/verification/agent-food-2026-10-28", { recursive: true });
    await page.screenshot({
      path: `docs/verification/agent-food-2026-10-28/${info.project.name}.png`,
      fullPage: false,
    });
    await writeFile(
      `.map-tools/agent-food/ui-${info.project.name}-raw.json`,
      JSON.stringify(await readAgentEvidence(page), null, 2),
    );
  }
});
