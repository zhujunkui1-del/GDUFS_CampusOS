import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";

test("Preview real article Skills, cross-column answer, follow-up and article-to-map receipt", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit live model budget required",
  );
  test.setTimeout(360000);
  const mapOnly = process.env.E2E_RETRIEVAL_MAP_ONLY === "1";
  const directory = mapOnly
    ? "docs/verification/s3-d/map-only-" + info.project.name
    : "docs/verification/s3-d/browser";
  await mkdir(directory, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installAgentEvidence(page);
  await page.goto("/radar");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  const outcomes: { prompt: string; answer: string; sources: unknown[] }[] = [];
  async function ask(prompt: string, name: string) {
    if (!(await page.locator("#campus-assistant").isVisible())) {
      const detail = page.locator(".place-details-frame");
      if (await detail.isVisible())
        await detail
          .getByRole("button", { name: "问 AI", exact: true })
          .click();
      else await page.getByRole("button", { name: "打开校园助理" }).click();
    }
    await expect(input).toBeEnabled({ timeout: 15000 });
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
    // Mobile intentionally closes the sheet to execute map actions. Reopen it
    // after completion before reading the message; do not wait on hidden DOM.
    if (!(await page.locator("#campus-assistant").isVisible()))
      await page.getByRole("button", { name: "打开校园助理" }).click();
    const last = page.locator('[data-message-role="assistant"]').last();
    await expect(last).toBeVisible({ timeout: 15000 });
    const sources = await last
      .locator(".assistant-source-card a")
      .evaluateAll((nodes) =>
        nodes.map((a) => ({
          title: a.textContent,
          url: (a as HTMLAnchorElement).href,
        })),
      );
    outcomes.push({ prompt, answer: await last.innerText(), sources });
    await page.screenshot({ path: directory + "/" + name + ".png" });
    await writeFile(
      directory + "/live.json",
      JSON.stringify(
        {
          browser: browser.version(),
          viewport: page.viewportSize(),
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
    return last;
  }
  try {
    if (!mapOnly) {
      const knowledge = await ask(
        "广外图书馆怎么借书？请根据真实文章说明，并提供来源。",
        "D2-knowledge",
      );
      await expect(
        knowledge.locator(".assistant-source-card a").first(),
      ).toHaveAttribute("href", /^https:\/\//);
      const events = await ask(
        "请查询真实讲座和竞赛，提供文章来源；无法确认报名时间就明确说明。",
        "D2-events",
      );
      await expect(events.locator(".assistant-source-card")).not.toHaveCount(0);
      await ask(
        "奖学金申请需要满足哪些条件，现在还有哪些开放的申请？请分别提供条件依据和申请通知的来源。",
        "D3-mixed",
      );
      const follow = await ask("那需要准备什么材料？", "D3-followup");
      await expect(follow).toContainText(/奖学金|申请|材料/);
      const records = (await readAgentEvidence(page)) as {
        tools: string[];
        result?: { metrics?: unknown };
      }[];
      expect(records[0].tools).toContain("search_campus_knowledge");
      expect(records[1].tools).toContain("search_campus_events");
      expect(records[2].tools).toEqual(
        expect.arrayContaining([
          "search_campus_knowledge",
          "search_campus_events",
        ]),
      );
      expect(records[3].tools).toContain("search_campus_knowledge");
    }
    await ask(
      "用“金秋阅新｜图书馆2026秋季中文新书展活动”做历史活动技术验收。查出原文举办地点，从南苑7栋规划到那里，并在地图显示路线，明确注明这是历史活动。",
      "D4-map",
    );
    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByTestId("campus-map")).toHaveAttribute(
      "data-route-extent",
      /.+/,
    );
    const final = (await readAgentEvidence(page)) as {
      tools: string[];
      actions: unknown[];
      result?: { metrics?: { timings?: { mapActionMs?: number } } };
    }[];
    expect(final.at(-1)!.tools).toEqual(
      expect.arrayContaining([
        "search_campus_events",
        "search_places",
        "plan_route",
        "control_map",
      ]),
    );
    expect(typeof final.at(-1)!.result?.metrics?.timings?.mapActionMs).toBe(
      "number",
    );
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await writeFile(
      directory + "/live.json",
      JSON.stringify(
        {
          browser: browser.version(),
          viewport: page.viewportSize(),
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
    await page.screenshot({ path: info.outputPath("last-state.png") });
  }
});
