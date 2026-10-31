import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test.skip(
  process.env.CALENDAR_LIVE !== "1",
  "Explicit real calendar/Agent check",
);
test.use({ trace: "off" });
test.setTimeout(150000);
test("Agent retrieves actual-day events from the shared calendar and opens their details", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "one paid real conversation");
  await installAgentEvidence(page);
  await page.goto("/calendar?date=2026-11-07", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("选择日期")).toHaveValue("2026-11-07");
  await page.getByRole("button", { name: "打开校园助理" }).click();
  const input = page.getByLabel("向校园助理提问");
  await input.fill("今天有哪些校园活动");
  await input.press("Enter");
  try {
    await expect
      .poll(
        async () => {
          const rows = (await readAgentEvidence(page)) as { result: unknown }[];
          return !!rows[0]?.result;
        },
        { timeout: 100000 },
      )
      .toBe(true);
    const row = (await readAgentEvidence(page))[0] as {
      tools: string[];
      cards: {
        kind: string;
        calendarLinks?: { href: string; title: string }[];
      }[];
      response: string;
      result: { error?: unknown; metrics?: unknown };
    };
    expect(row.result.error).toBeUndefined();
    expect(row.tools).toContain("search_campus_events");
    const links = row.cards.flatMap((c) => c.calendarLinks || []);
    expect(links.length).toBeGreaterThan(0);
    expect(row.response.trim()).not.toBe("");
    const href = links[0].href;
    await page.locator(".assistant-calendar-links a").first().click();
    await expect(page.getByLabel("选择日期")).toHaveValue(
      new URL("https://example.invalid" + href).searchParams.get("date")!,
    );
    await expect(page.locator(".public-article-dialog")).toBeVisible({
      timeout: 15000,
    });
  } finally {
    await fs.mkdir(".map-tools/calendar-20261030", { recursive: true });
    await fs.writeFile(
      ".map-tools/calendar-20261030/agent-live.json",
      JSON.stringify(await readAgentEvidence(page), null, 2),
    );
    await fs.mkdir("docs/verification/calendar-2026-10-30", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/calendar-2026-10-30/agent.png",
      fullPage: false,
    });
  }
});
