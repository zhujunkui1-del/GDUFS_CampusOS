import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";

async function open(page: Page) {
  if (!(await page.locator("#campus-assistant").isVisible())) {
    await page.getByRole("button", { name: "打开校园助理" }).click();
  }
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled({
    timeout: 15000,
  });
}
async function ask(page: Page, question: string) {
  await open(page);
  await page.getByLabel("向校园助理提问").fill(question);
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.locator("#assistant-launcher")).toHaveAttribute(
    "data-busy",
    "false",
    { timeout: 90000 },
  );
}

// Regression for the sequence the owner reported on 2026-10-29: a campus event
// follow-up was refused, a place question failed, and a "recent lectures"
// question returned no search at all.
test("reported campus, map and lecture questions stay answerable", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Requires explicit model-test budget",
  );
  test.setTimeout(240000);
  await installAgentEvidence(page);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60000 },
  );
  for (const question of [
    "秋之声",
    "2026年的秋之声什么时候举行",
    "南苑11栋",
    "查询几个最近的可报名的讲座",
    "从南苑11栋到南苑7栋",
  ]) {
    await ask(page, question);
    await expect(page.locator(".assistant-error")).toHaveCount(0);
    const text = await page
      .locator('[data-message-role="assistant"]')
      .last()
      .innerText();
    if (question === "2026年的秋之声什么时候举行")
      expect(text).not.toContain("只负责广外");
    if (question === "查询几个最近的可报名的讲座") {
      expect(text).not.toContain("没有检索到");
      expect(text).toContain("讲座");
    }
    if (question === "从南苑11栋到南苑7栋")
      await expect(page.locator(".assistant-route-card").last()).toContainText(
        "南苑11栋",
      );
  }
  const evidence = await readAgentEvidence(page);
  const place = evidence.find((item) => item.prompt === "南苑11栋");
  expect(place?.tools).toEqual(
    expect.arrayContaining(["search_places", "control_map"]),
  );
  const lecture = evidence.find(
    (item) => item.prompt === "查询几个最近的可报名的讲座",
  );
  expect(lecture?.tools).toContain("search_campus_events");
  const dir = "test-results/assistant-reported-regressions";
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${info.project.name}.png` });
  await writeFile(
    `${dir}/${info.project.name}.json`,
    JSON.stringify({ browser: browser.version(), evidence }, null, 2) + "\n",
  );
});

// Fixed regression for "最近 + 雷达 tag": every category must return 3-5
// publication-dated rows, newest first, and never fall back to a refusal.
test("recent radar tags stay dated, ordered and bounded", async ({ page }) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Requires explicit model-test budget",
  );
  test.setTimeout(300000);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60000 },
  );
  const cases = [
    ["最近的讲座", "讲座"],
    ["最近的竞赛", "竞赛"],
    ["最近的文体活动", "文体活动"],
  ] as const;
  for (const [question, label] of cases) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await open(page);
    await ask(page, question);
    await expect(page.locator(".assistant-error")).toHaveCount(0);
    const text = await page
      .locator('[data-message-role="assistant"]')
      .last()
      .innerText();
    expect(text, question).not.toContain("没有检索到");
    expect(text, question).toContain("最近广外");
    expect(text, question).toContain(label);
    const rows = text
      .split("\n")
      .filter((line) => /^\d+\. \d{4}-\d{2}-\d{2} 发布｜/.test(line));
    expect(rows.length, `${question} rows`).toBeGreaterThanOrEqual(3);
    expect(rows.length, `${question} rows`).toBeLessThanOrEqual(5);
    const dates = rows.map((line) => line.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "");
    expect(dates, `${question} sorted`).toEqual([...dates].sort().reverse());
  }
});
