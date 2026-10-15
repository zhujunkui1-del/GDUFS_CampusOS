import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/agent/session", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          scopeKey: "isolated-ui-fixture",
          kind: "guest",
          history: null,
          model: { ready: true },
        },
      },
    }),
  );
  await page.route("**/api/agent/cancel", (route) =>
    route.fulfill({ json: { ok: true, data: { cancelled: true } } }),
  );
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
});
test("Mock HTTP model failure leaves the public map usable", async ({
  page,
}) => {
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      status: 503,
      json: {
        ok: false,
        error: {
          code: "MODEL_SERVICE_UNAVAILABLE",
          message: "AI 暂不可用，请重试。",
        },
      },
    }),
  );
  await page.getByLabel("向校园助理提问").fill("帮我找到南苑7栋");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.locator(".assistant-error")).toContainText("AI 暂不可用");
  await page.getByRole("button", { name: "收起校园助理" }).click();
  await expect(page.getByLabel("搜索校园地点")).toBeEnabled();
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await expect(
    page.locator(".place-result").filter({ hasText: "图书馆" }),
  ).toBeVisible();
});
test("Mock network disconnect is shown as interruption without map actions", async ({
  page,
}) => {
  const runId = randomUUID();
  const event = {
    runId,
    eventId: runId + ":1",
    timestamp: new Date().toISOString(),
    type: "tool.started",
    payload: { name: "search_places" },
  };
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(event)}\n\n`,
    }),
  );
  await page.getByLabel("向校园助理提问").fill("帮我找到南苑7栋");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.locator(".assistant-error")).toContainText("连接已中断");
  await expect(page.getByTestId("campus-map")).not.toHaveAttribute(
    "data-route-extent",
    /.+/,
  );
});
test("cancelling an outstanding request ignores its late response", async ({
  page,
}) => {
  let release!: () => void;
  await page.route("**/api/agent/chat", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({ contentType: "text/event-stream", body: "" })
      .catch(() => {});
  });
  await page.getByLabel("向校园助理提问").fill("从南苑7栋去图书馆");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await expect.poll(() => typeof release).toBe("function");
  await page.getByRole("button", { name: "停止回复" }).click();
  release();
  await expect(page.locator(".assistant-error")).toContainText("已停止回复");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  await expect(page.getByTestId("campus-map")).not.toHaveAttribute(
    "data-route-extent",
    /.+/,
  );
});
test("Mock control action never reports success when the real 3D asset fails", async ({
  page,
}) => {
  await page.route("**/models/nanyuan7/*.glb", (route) =>
    route.fulfill({ status: 503, body: "isolated asset failure" }),
  );
  const runId = randomUUID(),
    packetId = randomUUID();
  const action = { type: "SET_VIEW_MODE", mode: "3d" };
  await page.route("**/api/agent/actions/*/claim", (route) =>
    route.fulfill({
      json: { ok: true, data: { id: packetId, actions: [action], routes: [] } },
    }),
  );
  await page.route("**/api/agent/actions/*/receipt", (route) =>
    route.fulfill({ json: { ok: true, data: { saved: true } } }),
  );
  const event = (type: string, payload: unknown, n: number) =>
    `data: ${JSON.stringify({ runId, eventId: runId + ":" + n, timestamp: new Date().toISOString(), type, payload })}\n\n`;
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        event(
          "artifact.ready",
          {
            cards: [],
            packet: { id: packetId, actions: [action] },
            routes: [],
          },
          1,
        ) + event("run.completed", {}, 2),
    }),
  );
  await page.getByLabel("向校园助理提问").fill("切换3D");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect(page.locator(".assistant-error")).toContainText("3D", {
    timeout: 20000,
  });
  await expect(page.getByTestId("campus-map")).not.toHaveAttribute(
    "data-mode",
    "3d",
  );
});

test("a new map tag selection interrupts a delayed assistant action", async ({
  page,
}) => {
  const runId = randomUUID(),
    packetId = randomUUID();
  const action = { type: "FOCUS_PLACE", placeId: "osm-way-312536955" };
  let release!: () => void;
  await page.route("**/api/agent/actions/*/claim", (route) =>
    route.fulfill({
      json: { ok: true, data: { id: packetId, actions: [action], routes: [] } },
    }),
  );
  await page.route("**/api/agent/actions/*/receipt", (route) =>
    route.fulfill({ json: { ok: true, data: { saved: true } } }),
  );
  await page.route("**/api/agent/chat", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    const event = (type: string, payload: unknown, n: number) =>
      `data: ${JSON.stringify({ runId, eventId: runId + ":" + n, timestamp: new Date().toISOString(), type, payload })}\n\n`;
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        event(
          "artifact.ready",
          {
            cards: [],
            routes: [],
            packet: { id: packetId, actions: [action] },
          },
          1,
        ) + event("run.completed", {}, 2),
    });
  });
  await page.getByLabel("向校园助理提问").fill("找南苑7栋");
  await page.getByLabel("向校园助理提问").press("Enter");
  await expect.poll(() => typeof release).toBe("function");
  await page.getByRole("button", { name: "收起校园助理" }).click();
  await page.getByRole("button", { name: "查看图书馆", exact: true }).click();
  release();
  await expect(page.locator(".assistant-error")).toContainText("新的选择");
  await expect(page.locator(".place-details-heading")).toContainText("图书馆");
});
