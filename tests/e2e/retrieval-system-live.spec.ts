import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
import { containsToolProtocol } from "../../src/lib/assistant-output";
test.skip(
  process.env.RETRIEVAL_LIVE !== "1",
  "Explicit real Preview query-system acceptance",
);
test.use({ trace: "off" });
test.setTimeout(360000);
test("real retrieval, official supplements, contextual follow-ups and citations", async ({
  page,
}, info) => {
  await installAgentEvidence(page);
  await page.goto("/radar", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("向校园助理提问");
  await expect(async () => {
    if (!(await input.isVisible()))
      await page.getByRole("button", { name: "打开校园助理" }).click();
    await expect(input).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 25000 });
  async function ask(message: string) {
    const n = (await readAgentEvidence(page)).length;
    await input.fill(message);
    await input.press("Enter");
    await expect
      .poll(
        async () => {
          const r = (await readAgentEvidence(page)) as { result: unknown }[];
          return r.length > n && r[n].result !== null;
        },
        { timeout: 100000 },
      )
      .toBe(true);
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "false",
      { timeout: 10000 },
    );
    const row = (await readAgentEvidence(page))[n] as {
      response: string;
      tools: string[];
      cards: {
        title: string;
        kind: string;
        snippet?: string;
        originalUrl?: string;
      }[];
      result: { error?: unknown; metrics: { answerMode: string } };
    };
    expect(row.result.error).toBeUndefined();
    expect(row.response.trim()).not.toBe("");
    expect(containsToolProtocol(row.response)).toBe(false);
    expect(row.response).not.toMatch(/没有体育比赛的相关信息|均为学科类竞赛/);
    return row;
  }
  try {
    const sports = await ask("广外有什么体育比赛可以参加吗");
    expect(sports.tools).toContain("search_campus_events");
    expect(sports.tools).toContain("search_external_campus_info");
    expect(sports.response).toMatch(/羽毛球|运动会|定向|足球|乒乓球|体育舞蹈/);
    expect(sports.response).toMatch(/[\[【]来源\d/);
    expect(
      sports.cards.some((c) =>
        /体育部|羽毛球|足球|定向|运动会|乒乓/.test(c.title),
      ),
    ).toBe(true);
    expect(
      sports.cards.some((c) => /CFA|信息安全|信息素养/.test(c.title)),
    ).toBe(false);
    if (info.project.name === "desktop") {
      const follow = await ask("那羽毛球呢，现在还能报名吗？");
      expect(
        follow.cards.some((c) => /生活地图|财务管理专业/.test(c.title)),
      ).toBe(false);
      expect(follow.response).toMatch(/羽毛球|报名|截止/);
      expect(follow.response).not.toMatch(/仍在报名|可以直接报名|现在就能报名/);
      const borrowing = await ask("广外图书馆怎么借书？");
      expect(
        borrowing.cards.some((c) =>
          /借阅规则|借还书|新生入馆指南/.test(c.title),
        ),
      ).toBe(true);
      expect(borrowing.cards.some((c) => /热读排行/.test(c.title))).toBe(false);
      const agreement = await ask("广外就业协议怎么办理？");
      expect(agreement.cards.some((c) => /协议|三方/.test(c.title))).toBe(true);
    } else {
      const food = await ask("广外一饭有什么好吃的");
      expect(food.response).toMatch(/饭|面|菜|餐/);
      expect(food.cards.map((c) => c.title).join(" ")).not.toMatch(
        /LSE|主题书展|新书速递/,
      );
    }
  } finally {
    await mkdir(".map-tools/retrieval-general", { recursive: true });
    await writeFile(
      `.map-tools/retrieval-general/ui-${info.project.name}-raw.json`,
      JSON.stringify(await readAgentEvidence(page), null, 2),
    );
    await mkdir("docs/verification/retrieval-general-2026-10-28", {
      recursive: true,
    });
    await page.screenshot({
      path: `docs/verification/retrieval-general-2026-10-28/${info.project.name}.png`,
      fullPage: false,
    });
  }
});
