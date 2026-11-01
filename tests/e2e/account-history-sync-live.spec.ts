import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  installAgentEvidence,
  readAgentEvidence,
} from "./helpers/agent-evidence";
test.use({ trace: "off", video: "off" });

test("S4 history is durable, paginated, isolated, idempotent and shared by Edge, Chrome and mobile sessions", async ({
  context,
  page,
}, info) => {
  test.skip(
    process.env.S4_LIVE !== "1" || info.project.name !== "desktop",
    "Explicit isolated account acceptance",
  );
  test.setTimeout(600000);
  const base = String(info.project.use.baseURL),
    privateDir = ".map-tools/history-sync",
    out =
      process.env.E2E_CAPTURE_DIR || "verification/account-history-2026-11-01";
  mkdirSync(privateDir, { recursive: true });
  mkdirSync(out, { recursive: true });
  const authPath = privateDir + "/accounts.json";
  const state: {
    a: { username: string; password: string };
    b: { username: string; password: string };
    ids?: string[];
    seeded?: boolean;
  } = existsSync(authPath)
    ? JSON.parse(readFileSync(authPath, "utf8"))
    : {
        a: {
          username: "synca_" + randomUUID().replaceAll("-", "").slice(0, 12),
          password: randomUUID(),
        },
        b: {
          username: "syncb_" + randomUUID().replaceAll("-", "").slice(0, 12),
          password: randomUUID(),
        },
      };
  const fresh = !existsSync(authPath);
  writeFileSync(authPath, JSON.stringify(state), { mode: 0o600 });
  const headers = { Origin: base, "X-CampusOS-Conversation-Protocol": "2" };
  async function auth(ctx: BrowserContext, who: "a" | "b", register = false) {
    const a = state[who];
    const r = await ctx.request.post(
      base + "/api/auth/" + (register ? "register" : "login"),
      {
        headers,
        data: register
          ? { username: a.username, password: a.password }
          : { identifier: a.username, password: a.password },
      },
    );
    expect(r.status(), "test-account authentication").toBe(200);
  }
  async function history(ctx: BrowserContext, id: string, cursor?: number) {
    const r = await ctx.request.get(
      base +
        "/api/agent/conversations/" +
        id +
        (cursor ? "?before=" + cursor : ""),
      { headers },
    );
    expect(r.status()).toBe(200);
    return (await r.json()).data;
  }
  async function all(ctx: BrowserContext, id: string) {
    let h = await history(ctx, id),
      messages = h.messages;
    while (h.olderCursor) {
      h = await history(ctx, id, h.olderCursor);
      messages = [...h.messages, ...messages];
    }
    return messages as {
      id: string;
      text: string;
      role: string;
      sequence: number;
      cards: unknown[];
    }[];
  }
  async function send(
    ctx: BrowserContext,
    message: string,
    id?: string,
    requestId: string = randomUUID(),
  ) {
    const r = await ctx.request.post(base + "/api/agent/chat", {
      headers,
      data: {
        message,
        clientRequestId: requestId,
        ...(id ? { conversationId: id } : {}),
      },
      timeout: 120000,
    });
    expect(r.status(), "chat transport").toBe(200);
    const events = (await r.text()).split("\n\n").flatMap((frame) => {
      const line = frame.split("\n").find((x) => x.startsWith("data:"));
      return line ? [JSON.parse(line.slice(5))] : [];
    });
    const failure = events.find((x) => x.type === "run.failed");
    expect(failure?.payload?.error, "chat completed").toBeUndefined();
    const done = events.find((x) => x.type === "run.completed");
    expect(done).toBeTruthy();
    return { id: String(done.payload.conversationId), events, requestId, done };
  }
  const guest = await send(context, "你好");
  await auth(context, "a", fresh);
  const userSession = (
    await (
      await context.request.get(base + "/api/agent/session", { headers })
    ).json()
  ).data;
  expect(userSession.kind).toBe("user");
  expect(
    (
      await context.request.get(base + "/api/agent/conversations/" + guest.id, {
        headers,
      })
    ).status(),
  ).toBe(404);
  const chrome = await chromium.launch({
    channel: "chrome",
    ...(process.env.E2E_PROXY
      ? { proxy: { server: process.env.E2E_PROXY } }
      : {}),
  });
  const second = await chrome.newContext({
      baseURL: base,
      viewport: { width: 1366, height: 900 },
    }),
    mobile = await chrome.newContext({
      baseURL: base,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    other = await chrome.newContext({ baseURL: base });
  try {
    await auth(other, "b", fresh);
    await auth(second, "a");
    await auth(mobile, "a");
    const list = async (ctx: BrowserContext) =>
      (
        await (
          await ctx.request.get(base + "/api/agent/conversations", { headers })
        ).json()
      ).data.conversations as { id: string; title: string }[];
    if (!state.seeded) {
      for (const id of (await list(context)).map((x) => x.id))
        await context.request.delete(base + "/api/agent/conversations/" + id, {
          headers,
        });
      state.ids = [];
      for (let i = 0; i < 3; i++) {
        const first = await send(
          context,
          i === 1 ? "找一篇图书馆的新生入馆指南，只列文章标题即可。" : "你好",
        );
        state.ids.push(first.id);
        writeFileSync(authPath, JSON.stringify(state), { mode: 0o600 });
        await send(context, "谢谢", first.id);
        await send(context, "你好", first.id);
      }
      for (let i = 0; i < 50; i++) await send(context, "谢谢", state.ids[0]);
      state.seeded = true;
      writeFileSync(authPath, JSON.stringify(state), { mode: 0o600 });
    }
    const ids = state.ids!;
    const lists = await Promise.all([
      list(context),
      list(second),
      list(mobile),
    ]);
    for (const l of lists)
      expect(l.map((x) => x.id).sort()).toEqual([...ids].sort());
    const long = await all(second, ids[0]);
    expect(long.length).toBeGreaterThan(100);
    expect(new Set(long.map((x) => x.id)).size).toBe(long.length);
    expect(long.map((x) => x.sequence)).toEqual(
      long.map((x) => x.sequence).sort((a, b) => a - b),
    );
    expect(
      (
        await other.request.get(base + "/api/agent/conversations/" + ids[0], {
          headers,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.request.delete(
          base + "/api/agent/conversations/" + ids[0],
          { headers },
        )
      ).status(),
    ).toBe(404);
    const duplicateId = randomUUID(),
      before = (await all(context, ids[2])).length;
    await send(context, "谢谢", ids[2], duplicateId);
    const replay = await send(context, "谢谢", ids[2], duplicateId);
    expect(replay.done.payload.replayed).toBe(true);
    expect((await all(context, ids[2])).length).toBe(before + 2);
    const concurrent = await Promise.all(
      [0, 1].map(() =>
        context.request.post(base + "/api/agent/chat", {
          headers,
          data: {
            message: "谢谢",
            conversationId: ids[2],
            clientRequestId: randomUUID(),
          },
        }),
      ),
    );
    for (const r of concurrent) expect([200, 429]).toContain(r.status());
    const concurrentMessages = await all(context, ids[2]);
    expect(concurrentMessages.length).toBe(
      before + 2 + concurrent.filter((r) => r.status() === 200).length * 2,
    );
    expect(new Set(concurrentMessages.map((x) => x.id)).size).toBe(
      concurrentMessages.length,
    );
    const secondPage = await second.newPage(),
      mobilePage = await mobile.newPage();
    await installAgentEvidence(secondPage);
    async function open(p: Page, id: string) {
      await p.goto(base + "/account");
      await p
        .getByRole("button", { name: "打开校园助理", exact: true })
        .click();
      await expect(p.getByLabel("向校园助理提问")).toBeEnabled();
      await p.getByRole("button", { name: "历史对话", exact: true }).click();
      await expect(p.locator(".assistant-history-row")).toHaveCount(3);
      await p
        .locator(
          `.assistant-history-row[data-conversation-id="${id}"] .assistant-history-open`,
        )
        .click();
      await expect(p.locator(".chat-message")).not.toHaveCount(0);
    }
    await open(secondPage, ids[1]);
    await secondPage
      .getByLabel("向校园助理提问")
      .fill("再找一下图书馆借书相关指南，列出文章标题即可。");
    await secondPage.getByLabel("向校园助理提问").press("Enter");
    await expect
      .poll(
        async () => (await readAgentEvidence(secondPage)).at(-1)?.completeMs,
        { timeout: 110000 },
      )
      .toBeTruthy();
    const live = (await readAgentEvidence(secondPage)).at(-1)!;
    expect((live.result as { error?: unknown }).error).toBeUndefined();
    expect(live.tools).toContain("search_campus_knowledge");
    const current = await all(context, ids[1]);
    expect(
      current.some(
        (x) => x.text === "再找一下图书馆借书相关指南，列出文章标题即可。",
      ),
    ).toBe(true);
    await secondPage
      .locator(".assistant-sources")
      .last()
      .locator("summary")
      .click();
    const source = secondPage
      .locator(".assistant-sources")
      .last()
      .locator("a[href]")
      .first();
    expect(await source.getAttribute("href")).toMatch(/^https?:/);
    const popupPromise = secondPage.waitForEvent("popup");
    await source.click();
    const popup = await popupPromise;
    await popup.waitForURL(/https?:\/\//);
    const sourceUrl = popup.url();
    await popup.close();
    await secondPage.screenshot({ path: out + "/chrome-sources.png" });
    await open(mobilePage, ids[0]);
    const expand = mobilePage.getByRole("button", {
      name: "展开全屏助理",
      exact: true,
    });
    if (await expand.isVisible()) await expand.click();
    const body = mobilePage.locator(".assistant-body");
    await expect(mobilePage.locator(".chat-message")).toHaveCount(40);
    for (
      let i = 0;
      i < 3 &&
      (await mobilePage
        .getByRole("button", { name: "加载更早消息", exact: true })
        .count());
      i++
    ) {
      const n = await mobilePage.locator(".chat-message").count();
      await body.evaluate((e) => (e.scrollTop = 0));
      await expect
        .poll(() => mobilePage.locator(".chat-message").count())
        .toBeGreaterThan(n);
    }
    await expect(mobilePage.locator(".chat-message")).toHaveCount(long.length);
    await body.evaluate((e) => (e.scrollTop = 150));
    const top = await body.evaluate((e) => e.scrollTop),
      box = await body.boundingBox();
    await mobilePage.touchscreen.tap(box!.x + 30, box!.y + 80);
    await mobilePage.waitForTimeout(150);
    expect(
      Math.abs((await body.evaluate((e) => e.scrollTop)) - top),
    ).toBeLessThan(3);
    await mobilePage.screenshot({ path: out + "/mobile-history.png" });
    await mobilePage.reload();
    await mobilePage
      .getByRole("button", { name: "打开校园助理", exact: true })
      .click();
    await expect(mobilePage.locator(".assistant-heading h2")).toContainText(
      lists[0].find((x) => x.id === ids[0])!.title,
    );
    await send(mobile, "谢谢", ids[1]);
    await secondPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect
      .poll(() => secondPage.locator(".chat-message").count())
      .toBe((await all(context, ids[1])).length);
    // Lost response: server completes a real request, then the network drops it.
    let lost:
      | { message: string; conversationId?: string; clientRequestId: string }
      | undefined;
    await page.goto(base + "/account");
    await page
      .getByRole("button", { name: "打开校园助理", exact: true })
      .click();
    await expect(page.getByLabel("向校园助理提问")).toBeEnabled();
    await page.route("**/api/agent/chat", async (route) => {
      lost = route.request().postDataJSON();
      await route.fetch();
      await route.abort("failed");
    });
    await page.getByLabel("向校园助理提问").fill("谢谢");
    await page.getByLabel("向校园助理提问").press("Enter");
    await expect(page.locator(".assistant-error")).toBeVisible();
    await page.unroute("**/api/agent/chat");
    expect(lost).toBeTruthy();
    const resumed = await send(
      context,
      lost!.message,
      lost!.conversationId,
      lost!.clientRequestId,
    );
    expect(resumed.done.payload.replayed).toBe(true);
    const saved = await all(context, ids[0]);
    expect(new Set(saved.map((x) => x.id)).size).toBe(saved.length);
    await open(secondPage, ids[2]);
    const priorRuns = (await readAgentEvidence(secondPage)).length;
    await secondPage
      .getByLabel("向校园助理提问")
      .fill("从南苑7栋到图书馆怎么走？帮我在地图上显示路线。");
    await secondPage.getByLabel("向校园助理提问").press("Enter");
    await expect
      .poll(
        async () => {
          const r = await readAgentEvidence(secondPage);
          return r.length > priorRuns ? r.at(-1)?.completeMs : null;
        },
        { timeout: 110000 },
      )
      .toBeTruthy();
    const mapped = (await readAgentEvidence(secondPage)).at(-1)!;
    writeFileSync(
      privateDir + "/map-attempt.json",
      JSON.stringify(mapped, null, 2),
    );
    expect((mapped.result as { error?: unknown }).error).toBeUndefined();
    expect(mapped.tools).toContain("plan_route");
    await expect(secondPage.getByTestId("campus-map")).toHaveAttribute(
      "data-route-extent",
      /.+/,
    );
    expect(mapped.actions.length).toBeGreaterThan(0);
    await secondPage.screenshot({ path: out + "/account-map-route.png" });
    expect(
      (
        await context.request.post(base + "/api/auth/logout", {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await context.request.get(base + "/api/agent/conversations/" + ids[0], {
          headers,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await context.request.get(
          base + "/api/agent/conversations/" + guest.id,
          { headers },
        )
      ).status(),
    ).toBe(200);
    await auth(context, "a");
    expect((await all(context, ids[0])).length).toBe(saved.length);
    const aliases = [];
    for (const origin of [
      "https://gdufs.ccwu.cc",
      "https://campusos-preview.zhujunkui1.workers.dev",
    ]) {
      const alias = await chrome.newContext({ baseURL: origin });
      try {
        const r = await alias.request.post(origin + "/api/auth/login", {
          headers: { Origin: origin },
          data: { identifier: state.a.username, password: state.a.password },
        });
        expect(r.status()).toBe(200);
        const listing = await alias.request.get(
          origin + "/api/agent/conversations",
          {
            headers: {
              Origin: origin,
              "X-CampusOS-Conversation-Protocol": "2",
            },
          },
        );
        expect(listing.status()).toBe(200);
        const items = (await listing.json()).data.conversations;
        expect(items.map((x: { id: string }) => x.id).sort()).toEqual(
          [...ids].sort(),
        );
        aliases.push({
          origin,
          status: listing.status(),
          conversationIds: items.map((x: { id: string }) => x.id),
        });
      } finally {
        await alias.close();
      }
    }
    writeFileSync(
      out + "/sync.json",
      JSON.stringify(
        {
          baseURL: base,
          aliases,
          browsers: ["Edge", "Chrome", "Chromium mobile viewport"],
          conversationIds: ids,
          longMessages: long.length,
          uniqueMessages: new Set(long.map((x) => x.id)).size,
          userBRead: 404,
          userBDelete: 404,
          loggedOutPrivateRead: 404,
          guestRetained: true,
          concurrentStatuses: concurrent.map((r) => r.status()),
          completedRequestReplay: replay.done.payload.replayed,
          lostResponseReplay: resumed.done.payload.replayed,
          sourceUrl,
          map: {
            tools: mapped.tools,
            actions: mapped.actions,
            result: mapped.result,
            latencyMs: mapped.completeMs,
          },
          live: {
            tools: live.tools,
            result: live.result,
            latencyMs: live.completeMs,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await second.close();
    await mobile.close();
    await other.close();
    await chrome.close();
  }
});
