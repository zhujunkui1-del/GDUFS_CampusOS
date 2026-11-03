import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test.skip(
  process.env.ASSISTANT_QUALITY_LIVE !== "1",
  "Explicit live Preview model evaluation",
);
test.use({ trace: "off" });
test.setTimeout(300000);
test("real internal answers, citations, search state and map actions", async ({
  page,
}, info) => {
  await installAgentEvidence(page);
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60000 },
  );
  const input = page.getByLabel("向校园助理提问");
  async function open() {
    if (await page.locator(".place-details-frame").isVisible())
      await page.getByRole("button", { name: "关闭地点详情" }).click();
    await expect(async () => {
      if (!(await input.isVisible()))
        await page.getByRole("button", { name: "打开校园助理" }).click();
      await expect(input).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
  }
  async function ask(message: string) {
    await open();
    const before = (await readAgentEvidence(page)).length;
    await input.fill(message);
    await input.press("Enter");
    await expect
      .poll(
        async () => {
          const rows = await readAgentEvidence(page);
          return rows.length > before && rows[before].result !== null;
        },
        { timeout: 110000 },
      )
      .toBe(true);
    const row = (await readAgentEvidence(page))[before];
    expect((row.result as { error?: unknown }).error).toBeUndefined();
    expect(row.tools).not.toContain("search_external_campus_info");
    return row;
  }
  let collected: Awaited<ReturnType<typeof readAgentEvidence>> = [];
  try {
    const recent = await ask("最近有什么竞赛？");
    expect(recent.cards.length).toBeGreaterThanOrEqual(3);
    await expect(
      page.locator(".assistant-markdown").last().locator("ol li"),
    ).toHaveCount(5);
    await expect(page.locator(".assistant-citation a").last()).toHaveAttribute(
      "href",
      /^https?:\/\//,
    );
    await mkdir("docs/verification/assistant-quality-2026-11-03", {
      recursive: true,
    });
    await page.screenshot({
      path: `docs/verification/assistant-quality-2026-11-03/recent-${info.project.name}.png`,
    });
    const more = await ask("还有吗？");
    const ids = (recent.cards as { documentId?: string }[])
      .map((c) => c.documentId)
      .filter(Boolean);
    expect(
      (more.cards as { documentId?: string }[]).some((c) =>
        ids.includes(c.documentId),
      ),
    ).toBe(false);
    const place = await ask("一饭在哪？");
    expect(place.tools).toContain("search_places");
    expect(
      place.actions.some((a) => (a as { type: string }).type === "FOCUS_PLACE"),
    ).toBe(true);
    const navigation = await ask("带我去南苑11栋");
    expect(navigation.response).toMatch(/起点|哪里|出发|定位/);
    await open();
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes("/api/agent/conversations/") &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "智能搜索", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(
      page.getByRole("button", { name: "智能搜索", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    collected = await readAgentEvidence(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await open();
    await expect(
      page.getByRole("button", { name: "智能搜索", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "智能搜索", exact: true }).click();
  } finally {
    const dir = "docs/verification/assistant-quality-2026-11-03";
    await mkdir(dir, { recursive: true });
    await writeFile(
      `${dir}/live-ui-${info.project.name}.json`,
      JSON.stringify(
        collected.length ? collected : await readAgentEvidence(page),
        null,
        2,
      ),
    );
    await page.screenshot({ path: `${dir}/live-ui-${info.project.name}.png` });
  }
});
