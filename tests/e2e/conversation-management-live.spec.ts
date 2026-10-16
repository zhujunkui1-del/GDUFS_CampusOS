import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test.afterEach(async ({ page }, info) => {
  if (process.env.E2E_LIVE_AGENT === "1")
    await writeFile(
      info.outputPath("partial-live.json"),
      JSON.stringify(await readAgentEvidence(page).catch(() => []), null, 2),
    );
});
async function open(page: Page) {
  if (!(await page.locator("#campus-assistant").isVisible())) {
    if (await page.locator(".place-details-frame").isVisible())
      await page
        .locator(".place-details-frame")
        .getByRole("button", { name: "问 AI", exact: true })
        .click();
    else await page.getByRole("button", { name: "打开校园助理" }).click();
  }
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled({
    timeout: 15000,
  });
  await expect(page.locator("#campus-assistant")).toHaveCSS("opacity", "1");
}
test("real AI and owned D1 conversations survive switching, then delete without replay or quota reset", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit live model budget is required",
  );
  test.setTimeout(240000);
  const dir =
    process.env.E2E_CONVERSATION_CAPTURE_DIR ||
    "test-results/conversations-live";
  await mkdir(dir, { recursive: true });
  const stem = `${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
  await installAgentEvidence(page);
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  const submissions: {
    message: string;
    conversationId: string | null;
    selectedPlaceId: string | null;
    activeRouteId: string | null;
    requestId: string;
  }[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/agent/chat")) {
      const b = r.postDataJSON();
      submissions.push({
        message: b.message,
        conversationId: b.conversationId || null,
        selectedPlaceId: b.mapContext?.selectedPlaceId || null,
        activeRouteId: b.mapContext?.activeRouteId || null,
        requestId: b.clientRequestId,
      });
    }
  });
  const session = await page.request.get("/api/agent/session"),
    scope = (await session.json()).data.scopeKey;
  async function ask(text: string) {
    await open(page);
    await page.getByLabel("向校园助理提问").fill(text);
    await page.getByLabel("向校园助理提问").press("Enter");
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "true",
    );
    await expect(page.locator("#assistant-launcher")).toHaveAttribute(
      "data-busy",
      "false",
      { timeout: 70000 },
    );
    await open(page);
    await expect(page.locator(".assistant-error")).toHaveCount(0);
  }
  await ask("帮我找到南苑7栋。");
  await expect(page.locator(".assistant-place-card").last()).toContainText(
    "南苑7栋",
  );
  let list = (await (await page.request.get("/api/agent/conversations")).json())
    .data.conversations;
  const first = list[0].id;
  expect(list).toHaveLength(1);
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("log")).toBeEmpty();
  expect(
    (await (await page.request.get("/api/agent/conversations")).json()).data
      .conversations,
  ).toHaveLength(1);
  await ask("帮我找到图书馆。");
  await expect(page.locator(".assistant-place-card").last()).toContainText(
    "图书馆",
  );
  expect(submissions[1]).toMatchObject({
    conversationId: null,
    selectedPlaceId: null,
    activeRouteId: null,
  });
  list = (await (await page.request.get("/api/agent/conversations")).json())
    .data.conversations;
  const second = list.find((c: { id: string }) => c.id !== first).id;
  expect(list).toHaveLength(2);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await expect(page.locator(".assistant-history-row")).toHaveCount(2);
  await page.screenshot({ path: `${dir}/${stem}-real-history.png` });
  await page
    .locator(".assistant-history-open")
    .filter({ hasText: "南苑7栋" })
    .click();
  await expect(page.getByRole("log")).toContainText("帮我找到南苑7栋。");
  await expect(page.getByRole("log")).not.toContainText("帮我找到图书馆。");
  await expect(page.locator(".route-endpoint")).toHaveCount(0);
  await ask("那从这里去图书馆呢？");
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "南苑7栋 → 图书馆",
  );
  await expect(page.locator(".assistant-route-card").last()).toContainText(
    "848 米",
  );
  const records = (await readAgentEvidence(page)) as {
    tools: string[];
    actions: { type: string; routeId?: string }[];
    result: { metrics: { timings: { mapActionMs: number } } };
  }[];
  expect(records).toHaveLength(3);
  expect(records[2].tools).toEqual(
    expect.arrayContaining(["plan_route", "control_map"]),
  );
  expect(records[2].result.metrics.timings.mapActionMs).toEqual(
    expect.any(Number),
  );
  const routeId = records[2].actions.find(
    (a) => a.type === "SHOW_ROUTE",
  )!.routeId!;
  // Restoring history never replays its old map actions. Display requires an
  // explicit click and a fresh owned/versioned route lookup after reload.
  await page.reload();
  await open(page);
  await expect(page.locator(".assistant-route-card")).toContainText("848 米");
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await page
    .locator(".assistant-route-card")
    .getByRole("button", { name: "显示路线", exact: true })
    .click();
  await expect(page.locator(".route-endpoint")).toHaveCount(2);
  await open(page);
  expect(
    (
      await page.request.delete(`/api/agent/conversations/${first}`, {
        data: { userId: "forged" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await page.request.get(`/api/agent/conversations/${first}`)).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page
    .locator(".assistant-history-row")
    .filter({ hasText: "帮我找到图书馆" })
    .getByRole("button", { name: "删除对话" })
    .click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    (await page.request.get(`/api/agent/conversations/${second}`)).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.locator(".assistant-route-card")).toContainText("848 米");
  await expect(page.locator(".route-endpoint")).toHaveCount(2);
  const other = await browser.newContext();
  expect(
    (
      await other.request.delete(
        new URL(`/api/agent/conversations/${first}`, page.url()).href,
      )
    ).status(),
  ).toBe(404);
  await other.close();
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page.getByRole("button", { name: "删除对话" }).click();
  await page.screenshot({ path: `${dir}/${stem}-real-delete-confirm.png` });
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("log")).toBeEmpty();
  await expect(page.locator(".route-endpoint")).toHaveCount(2);
  expect(
    (await page.request.delete(`/api/agent/conversations/${first}`)).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post(`/api/agent/routes/${routeId}`, {
        data: { conversationId: first },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post(`/api/agent/routes/${routeId}`, { data: {} })
    ).status(),
  ).toBe(404);
  await page.screenshot({ path: `${dir}/${stem}-real-deleted-blank.png` });
  await page.reload();
  await open(page);
  await expect(page.getByRole("log")).toBeEmpty();
  expect(
    (await (await page.request.get("/api/agent/session")).json()).data.scopeKey,
  ).toBe(scope);
  expect(
    (await (await page.request.get("/api/agent/conversations")).json()).data
      .conversations,
  ).toHaveLength(0);
  await writeFile(
    `${dir}/${stem}-live.json`,
    JSON.stringify(
      {
        realModel: true,
        browser: browser.version(),
        viewport: page.viewportSize(),
        unchangedTrustedIdentity: true,
        conversations: [first, second],
        deletedBoth: true,
        routeId,
        lateActionFaultsTestedSeparatelyWithMock: true,
        actualHardwareGPS: false,
        submissions,
        records,
      },
      null,
      2,
    ) + "\n",
  );
});
