import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: unknown[];
};
type History = {
  conversationId: string;
  title: string;
  messages: Message[];
  selectedPlaceId: string | null;
  activeRouteId: string | null;
  updatedAt: number;
};
async function fixture(page: Page) {
  const first = randomUUID(),
    second = randomUUID();
  const histories = new Map<string, History>();
  const make = (id: string, title: string, updatedAt: number): History => ({
    conversationId: id,
    title,
    messages: [
      { id: randomUUID(), role: "user", text: title, cards: [] },
      {
        id: randomUUID(),
        role: "assistant",
        text: `模拟历史：${title}`,
        cards: [],
      },
    ],
    selectedPlaceId: null,
    activeRouteId: null,
    updatedAt,
  });
  histories.set(first, make(first, "南苑7栋", Date.now() - 2000));
  histories.set(second, make(second, "图书馆", Date.now() - 1000));
  let failDelete = false,
    requests = 0;
  let scopeKey = "isolated-conversation-ui-fixture";
  let failHistory = false;
  const history = (h: History | undefined) => {
    if (!h) return null;
    return {
      conversationId: h.conversationId,
      title: h.title,
      messages: h.messages,
      selectedPlaceId: h.selectedPlaceId,
      activeRouteId: h.activeRouteId,
    };
  };
  await page.route("**/api/agent/session", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: {
          scopeKey,
          kind: "guest",
          model: { ready: true },
          history: history(
            [...histories.values()].sort(
              (a, b) => b.updatedAt - a.updatedAt,
            )[0],
          ),
        },
      },
    }),
  );
  await page.route(/\/api\/agent\/conversations(?:\?.*)?$/, (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: {
          conversations: [...histories.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((h) => ({
              id: h.conversationId,
              title: h.title,
              updatedAt: h.updatedAt,
            })),
          nextCursor: null,
        },
      },
    }),
  );
  await page.route(/\/api\/agent\/conversations\/[^/?]+$/, (r) => {
    const id = r.request().url().split("/").at(-1)!,
      h = histories.get(id);
    if (!h)
      return r.fulfill({
        status: 404,
        json: { ok: false, error: { message: "对话不存在或已删除。" } },
      });
    if (r.request().method() === "DELETE") {
      if (failDelete)
        return r.fulfill({
          status: 503,
          json: { ok: false, error: { message: "服务暂不可用。" } },
        });
      histories.delete(id);
      return r.fulfill({ json: { ok: true, data: { deleted: true } } });
    }
    if (failHistory)
      return r.fulfill({
        status: 503,
        json: { ok: false, error: { message: "临时故障" } },
      });
    return r.fulfill({ json: { ok: true, data: history(h) } });
  });
  await page.route("**/api/agent/cancel", (r) =>
    r.fulfill({ json: { ok: true, data: { cancelled: true } } }),
  );
  await page.route("**/api/agent/chat", async (r) => {
    requests++;
    const body = r.request().postDataJSON(),
      id = body.conversationId || randomUUID(),
      run = randomUUID();
    const h: History = histories.get(id) || {
      conversationId: id,
      title: body.message,
      messages: [],
      selectedPlaceId: null,
      activeRouteId: null,
      updatedAt: Date.now(),
    };
    h.messages.push(
      { id: randomUUID(), role: "user", text: body.message, cards: [] },
      {
        id: randomUUID(),
        role: "assistant",
        text: `模拟回复：${body.message}`,
        cards: [],
      },
    );
    h.updatedAt = Date.now();
    histories.set(id, h);
    const event = (type: string, payload: unknown, n: number) =>
      `data: ${JSON.stringify({ runId: run, eventId: run + ":" + n, timestamp: new Date().toISOString(), type, payload })}\n\n`;
    await r.fulfill({
      contentType: "text/event-stream",
      body:
        event("artifact.ready", { started: true, conversationId: id }, 1) +
        event("message.delta", { text: `模拟回复：${body.message}` }, 2) +
        event("run.completed", { conversationId: id }, 3),
    });
  });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
  await expect(page.getByRole("log")).toContainText("模拟历史：图书馆");
  return {
    first,
    second,
    histories,
    failDelete: (v: boolean) => {
      failDelete = v;
    },
    requests: () => requests,
    changeIdentity: () => {
      scopeKey = "different-isolated-identity";
      histories.clear();
    },
    failHistory: (value: boolean) => {
      failHistory = value;
    },
  };
}
async function historyList(page: Page) {
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await expect(page.getByLabel("历史对话列表")).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByLabel("向校园助理提问").fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(`模拟回复：${text}`);
}
test("Mock transient history failure preserves the current view and can recover", async ({
  page,
}) => {
  const f = await fixture(page);
  f.failHistory(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".assistant-error")).toContainText("对话暂不可用");
  await expect(page.getByRole("log")).toContainText("模拟历史：图书馆");
  f.failHistory(false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".assistant-error")).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("模拟历史：图书馆");
});
test("Mock identity: an old AI map display stays isolated after new chat and clears on identity change", async ({
  page,
}) => {
  const f = await fixture(page);
  const result = await page.request.post("/api/map/skills/plan_route", {
    data: {
      input: {
        start: { type: "place", placeId: "osm-way-312536955" },
        endPlaceId: "osm-way-307250998",
        mode: "walking",
      },
    },
  });
  expect(result.ok()).toBe(true);
  const route = (await result.json()).data.data;
  f.histories.get(f.second)!.messages.push({
    id: randomUUID(),
    role: "assistant",
    text: "隔离路线夹具",
    cards: [
      {
        kind: "route",
        routeId: route.routeId,
        startName: route.start.name,
        endName: route.end.name,
        distanceMeters: route.distanceMeters,
        estimatedMinutes: route.estimatedMinutes,
        expiresAt: route.expiresAt,
        device: false,
      },
    ],
  });
  await page.route(`**/api/agent/routes/${route.routeId}`, (r) =>
    r.fulfill({ json: { ok: true, data: route } }),
  );
  await page.reload();
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await page
    .locator(".assistant-route-card")
    .getByRole("button", { name: "显示路线", exact: true })
    .click();
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  if (!(await page.locator("#campus-assistant").isVisible()))
    await page.getByRole("button", { name: "打开校园助理" }).click();
  await page.getByRole("button", { name: "新对话" }).click();
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  f.changeIdentity();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(map).not.toHaveAttribute("data-route-extent", /.+/);
  await expect(page.getByRole("log")).toBeEmpty();
});
test("Mock UI: a new conversation keeps an independently planned map route", async ({
  page,
  isMobile,
}) => {
  // The existing narrow navigation UI deliberately hides the AI launcher.
  // Open both on the wide layout, then verify the retained mobile drawer too.
  if (isMobile) await page.setViewportSize({ width: 1100, height: 900 });
  await fixture(page);
  await page.getByRole("button", { name: "收起校园助理" }).click();
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  for (const [which, name] of [
    ["起点", "南苑7栋"],
    ["终点", "图书馆"],
  ]) {
    await page.getByLabel("导航" + which).fill(name);
    await page
      .getByRole("region", { name: which + "地点建议" })
      .getByRole("button", { name: new RegExp(name) })
      .first()
      .click();
  }
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await page.getByRole("button", { name: "打开校园助理" }).click();
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "新对话" }).click();
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(page.locator(".route-endpoint")).toHaveCount(2);
  await expect(page.getByLabel("导航起点")).toHaveValue("南苑7栋");
  await expect(page.getByLabel("导航终点")).toHaveValue("图书馆");
  await expect(map).toHaveAttribute("data-mode", "2d");
  await send(page, "独立地图不等于AI上下文");
  await expect(map).toHaveAttribute("data-route-extent", /.+/);
  await expect(page.locator(".route-endpoint")).toHaveCount(2);
});
test("Mock location: starting anew while awaiting GPS ignores the old callback", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/agent/location/challenge", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: {
          challenge: "isolated-browser-challenge-not-a-real-grant",
          serverTime: Date.now(),
        },
      },
    }),
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: (p: unknown) => void) {
          (
            window as unknown as { releaseLocation: () => void }
          ).releaseLocation = () =>
            success({
              coords: {
                longitude: 113.390146,
                latitude: 23.0615765,
                accuracy: 8,
              },
              timestamp: Date.now(),
            });
        },
      },
    }),
  );
  await page.getByLabel("向校园助理提问").fill("我想去北苑5");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("status")).toContainText("等待定位");
  await page.getByRole("button", { name: "新对话" }).click();
  await page.evaluate(() =>
    (window as unknown as { releaseLocation: () => void }).releaseLocation(),
  );
  await expect(page.getByRole("log")).toBeEmpty();
  await expect(page.locator(".assistant-status")).toHaveCount(0);
  await send(page, "新定位回调没有覆盖我");
});
test("Mock UI: new conversation, history switching and refresh keep separate histories", async ({
  page,
  isMobile,
}, info) => {
  const f = await fixture(page);
  await page.getByRole("button", { name: "收起校园助理" }).click();
  await page.getByLabel("搜索校园地点").fill("南苑7栋");
  await page.locator(".map-search-results .place-result").first().click();
  await page
    .locator(".place-details-frame")
    .getByRole("button", { name: "问 AI", exact: true })
    .click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("log")).toBeEmpty();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("log")).toBeEmpty();
  expect(f.histories.size).toBe(2);
  if (isMobile)
    await expect(page.getByLabel("向校园助理提问")).not.toBeFocused();
  else await expect(page.getByLabel("向校园助理提问")).toBeFocused();
  let submitted: unknown;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/agent/chat")) submitted = r.postDataJSON();
  });
  await send(page, "新的独立问题");
  expect(submitted).toMatchObject({
    message: "新的独立问题",
    mapContext: { activeRouteId: null },
  });
  expect(
    (submitted as { conversationId?: string }).conversationId,
  ).toBeUndefined();
  expect(
    (submitted as { mapContext: { selectedPlaceId?: string } }).mapContext
      .selectedPlaceId,
  ).toBeUndefined();
  await historyList(page);
  await expect(page.locator(".assistant-history-open").first()).toContainText(
    "新的独立问题",
  );
  await page
    .locator(".assistant-history-open")
    .filter({ hasText: "南苑7栋" })
    .click();
  await expect(page.getByRole("log")).toContainText("模拟历史：南苑7栋");
  await expect(page.getByRole("log")).not.toContainText("新的独立问题");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("log")).toContainText("模拟历史：南苑7栋");
  await historyList(page);
  const dir =
    process.env.E2E_CONVERSATION_CAPTURE_DIR || "test-results/conversations";
  await mkdir(dir, { recursive: true });
  await expect(page.locator("#campus-assistant")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-history.png`,
  });
  await page.reload();
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByRole("log")).toContainText("新的独立问题");
});
test("Mock UI: delete cancel, failure retry, other/current deletion and empty lazy state", async ({
  page,
}, info) => {
  const f = await fixture(page);
  await historyList(page);
  const first = page
    .locator(".assistant-history-row")
    .filter({ hasText: "南苑7栋" });
  await first.getByRole("button", { name: "删除对话" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "删除后，这段对话及其历史消息将无法恢复。",
  );
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(f.histories.size).toBe(2);
  await first.getByRole("button", { name: "删除对话" }).click();
  f.failDelete(true);
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("alertdialog").getByRole("alert")).toContainText(
    "删除失败",
  );
  expect(f.histories.size).toBe(2);
  f.failDelete(false);
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(".assistant-history-row")).toHaveCount(1);
  expect(f.histories.has(f.second)).toBe(true);
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("模拟历史：图书馆");
  await historyList(page);
  await page.getByRole("button", { name: "删除对话" }).click();
  const dir =
    process.env.E2E_CONVERSATION_CAPTURE_DIR || "test-results/conversations";
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-delete-confirm.png`,
  });
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("log")).toBeEmpty();
  expect(f.histories.size).toBe(0);
  expect(f.requests()).toBe(0);
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  expect(f.histories.size).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.getByRole("log")).toBeEmpty();
});
for (const transition of ["switch", "new", "delete"] as const)
  test(`Mock partial SSE: ${transition} rejects late text/actions`, async ({
    page,
  }) => {
    const f = await fixture(page);
    const packetId = randomUUID();
    await page.route(`**/api/agent/actions/${packetId}/claim`, (r) =>
      r.fulfill({
        json: {
          ok: true,
          data: {
            id: packetId,
            conversationId: f.second,
            actions: [{ type: "SET_VIEW_MODE", mode: "3d" }],
            routes: [],
          },
        },
      }),
    );
    await page.evaluate(
      ({ id, packet, run }) => {
        const original = window.fetch.bind(window),
          encoder = new TextEncoder();
        window.fetch = async (...args) => {
          if (!String(args[0]).endsWith("/api/agent/chat"))
            return original(...args);
          const event = (type: string, payload: unknown, n: number) =>
            encoder.encode(
              `data: ${JSON.stringify({ runId: run, eventId: run + ":" + n, timestamp: new Date().toISOString(), type, payload })}\n\n`,
            );
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  event(
                    "artifact.ready",
                    { started: true, conversationId: id },
                    1,
                  ),
                );
                controller.enqueue(
                  event("message.delta", { text: "模拟未完成流" }, 2),
                );
                (window as unknown as { releaseLate: () => void }).releaseLate =
                  () => {
                    try {
                      controller.enqueue(
                        event(
                          "artifact.ready",
                          {
                            conversationId: id,
                            cards: [],
                            routes: [],
                            packet: {
                              id: packet,
                              actions: [{ type: "SET_VIEW_MODE", mode: "3d" }],
                            },
                          },
                          3,
                        ),
                      );
                      controller.enqueue(
                        event("message.delta", { text: "迟到内容" }, 4),
                      );
                      controller.enqueue(event("run.completed", {}, 5));
                      controller.close();
                    } catch {}
                  };
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        };
      },
      { id: f.second, packet: packetId, run: randomUUID() },
    );
    await page.getByLabel("向校园助理提问").fill("继续");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("log")).toContainText("模拟未完成流");
    if (transition === "switch") {
      await historyList(page);
      await page
        .locator(".assistant-history-open")
        .filter({ hasText: "南苑7栋" })
        .click();
      await expect(page.getByRole("log")).toContainText("模拟历史：南苑7栋");
    } else if (transition === "new")
      await page.getByRole("button", { name: "新对话" }).click();
    else {
      await historyList(page);
      await page
        .locator(".assistant-history-row")
        .filter({ hasText: "图书馆" })
        .getByRole("button", { name: "删除对话" })
        .click();
      await page.getByRole("button", { name: "删除", exact: true }).click();
    }
    await page.evaluate(() =>
      (window as unknown as { releaseLate: () => void }).releaseLate(),
    );
    await expect(page.getByRole("log")).not.toContainText("迟到内容");
    await expect(page.locator(".assistant-error")).toHaveCount(0);
    await expect(page.getByTestId("campus-map")).toHaveAttribute(
      "data-mode",
      "2d",
    );
    await page.getByRole("button", { name: "新对话" }).click();
    await expect(page.getByRole("log")).toBeEmpty();
  });
