import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test("Preview internal-first, official web supplement, experiences and ordinary Internet query", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit live model budget required",
  );
  test.setTimeout(300000);
  const internalOnly = process.env.E2E_EXTERNAL_INTERNAL_ONLY === "1";
  const experienceOnly = process.env.E2E_EXTERNAL_EXPERIENCE_ONLY === "1";
  const dir =
    "docs/verification/external-search/" +
    (internalOnly
      ? "internal-browser"
      : experienceOnly
        ? "experience-browser"
        : "browser");
  await mkdir(dir, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installAgentEvidence(page);
  await page.goto("/radar");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  const outcomes: unknown[] = [];
  async function ask(prompt: string, name: string) {
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
    const last = page.locator('[data-message-role="assistant"]').last();
    await expect(last).toBeVisible();
    const sources = await last
      .locator(".assistant-source-card a")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          title: n.textContent,
          url: (n as HTMLAnchorElement).href,
        })),
      );
    outcomes.push({ prompt, answer: await last.innerText(), sources });
    await page.screenshot({ path: dir + "/" + name + ".png" });
    return page
      .locator('[data-message-role="assistant"]')
      .nth((await page.locator('[data-message-role="assistant"]').count()) - 1);
  }
  try {
    if (experienceOnly) {
      const noteAnswer = await ask(
        "广外大学城哪个食堂的饭好吃？请查学生体验，资料年代不明要说明。",
        "experience",
      );
      await expect(
        noteAnswer
          .locator(".assistant-source-card")
          .filter({ has: page.locator('a[href*="xiaohongshu.com"]') })
          .filter({ hasText: "原文摘录" })
          .first(),
      ).toBeVisible();
      const records = (await readAgentEvidence(page)) as {
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
      expect(
        records[0].result?.metrics?.timings?.externalSearch
          ?.flatMap((r) => r.providers)
          .some(
            (p) =>
              p.provider === "xiaohongshu_mcp_local" &&
              p.status === "ok" &&
              p.count > 0,
          ),
      ).toBe(true);
      expect(errors).toEqual([]);
      return;
    }
    await ask(
      "广外图书馆怎么借书？只用内部文章概述借书操作，不要联网。",
      "internal",
    );
    if (internalOnly) {
      const records = (await readAgentEvidence(page)) as { tools: string[] }[];
      expect(records[0].tools).toEqual(["search_campus_knowledge"]);
      expect(errors).toEqual([]);
      return;
    }
    const official = await ask(
      "请联网查询广外图书馆读者借阅权限表中本科生的借阅上限和借期，以官方原文为准。",
      "official",
    );
    const noteAnswer = await ask(
      "广外大学城哪个食堂的饭好吃？请查学生体验，资料年代不明要说明。",
      "experience",
    );
    await expect(
      noteAnswer
        .locator(".assistant-source-card")
        .filter({ has: page.locator('a[href*="xiaohongshu.com"]') })
        .filter({ hasText: "原文摘录" })
        .first(),
    ).toBeVisible();
    await ask(
      "JavaScript 的 AbortSignal 是什么？请联网找真实资料简要说明。",
      "general",
    );
    await expect(
      official
        .locator('.assistant-source-card a[href*="gdufs.edu.cn"]')
        .first(),
    ).toBeVisible();
    const records = (await readAgentEvidence(page)) as { tools: string[] }[];
    expect(records).toHaveLength(4);
    for (const r of records) expect(r.tools[0]).toBe("search_campus_knowledge");
    for (const r of records.slice(1))
      expect(r.tools).toContain("search_external_campus_info");
    const experience = records[2] as unknown as {
      result?: {
        metrics?: {
          timings?: {
            externalSearch?: {
              providers: { provider: string; status: string; count: number }[];
            }[];
          };
        };
      };
    };
    expect(
      experience.result?.metrics?.timings?.externalSearch
        ?.flatMap((r) => r.providers)
        .some(
          (p) =>
            p.provider === "xiaohongshu_mcp_local" &&
            p.status === "ok" &&
            p.count > 0,
        ),
    ).toBe(true);
    expect(records[0].tools).not.toContain("search_external_campus_info");
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      dir + "/live.json",
      JSON.stringify(
        {
          browser: browser.version(),
          realModel: true,
          preview: true,
          outcomes,
          records: await readAgentEvidence(page),
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  }
});
