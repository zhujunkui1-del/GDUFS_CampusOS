import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { tokenHash } from "@/lib/server/assistant/crypto";
import { readJson } from "@/lib/server/assistant/http-context";
import {
  AssistantHistorySchema,
  ConversationListSchema,
  historyForClient,
} from "@/domain/agent/assistant-contracts";
import { AssistantStore } from "@/lib/server/assistant/store";
import { SharedRouteStore } from "@/lib/server/assistant/routes";
import {
  CampusMapService,
  MAP_VERSIONS,
} from "@/lib/server/maps/campus-map-service";
import {
  blankConversation,
  conversationTitle,
  afterConversationDelete,
  acceptsConversationResult,
} from "@/features/assistant/conversation-state";

let fixture: ReturnType<typeof sqliteD1>, now: number, store: AssistantStore;
beforeEach(() => {
  fixture = sqliteD1();
  now = Date.parse("2026-10-16T00:00:00Z");
  store = new AssistantStore(fixture.db, () => now);
});
afterEach(() => fixture.close());
const identity = () =>
  store.identity(new Request("https://campus.invalid/api/agent/session"));
const ctx = (owner: string) => ({
  requestId: "isolated",
  sessionId: owner,
  user: null,
  permissions: [],
  campusId: "gdufs_university_town" as const,
});
const routeInput = {
  start: { type: "place" as const, placeId: "osm-way-312536955" },
  endPlaceId: "osm-way-307250998",
  mode: "walking" as const,
};

describe("owned multi-conversation state and atomic deletion", () => {
  it("returns valid Unicode titles consistently with SQLite character lengths", async () => {
    const a = await identity(),
      c = await store.conversation(a);
    await store.append(c, "user", "🎓".repeat(40));
    const awaited = await store.history(a, c.id);
    expect(awaited.title).toBe("🎓".repeat(40));
    expect(conversationTitle("a".repeat(47) + "🎓x")).toBe(
      "a".repeat(47) + "🎓",
    );
    expect(() => AssistantHistorySchema.parse(awaited)).not.toThrow();
    const list = await store.list(a);
    expect(() => ConversationListSchema.parse(list)).not.toThrow();
  });
  it("isolates authenticated login ownership from the guest and another login", async () => {
    const guest = await identity(),
      g = await store.conversation(guest);
    const users = [];
    for (const id of ["first-user", "second-user"]) {
      fixture.sqlite
        .prepare("INSERT INTO users(id,display_name) VALUES(?,?)")
        .run(id, id);
      const token = `isolated-auth-token-for-${id}`;
      fixture.sqlite
        .prepare(
          "INSERT INTO login_sessions(session_hash,user_id,expires_at) VALUES(?,?,?)",
        )
        .run(await tokenHash(token), id, new Date(now + 3600000).toISOString());
      users.push(
        await store.identity(
          new Request("https://campus.invalid/api/agent/session", {
            headers: {
              Cookie: `campusos_session=${token}`,
            },
          }),
        ),
      );
    }
    const first = await store.conversation(users[0]);
    await store.append(first, "user", "private user history");
    expect(users[0].user?.id).toBe("first-user");
    for (const denied of [guest, users[1]])
      await expect(
        store.deleteConversation(denied, first.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.deleteConversation(users[0], g.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await store.deleteConversation(users[0], first.id);
    expect((await store.conversation(guest, g.id)).id).toBe(g.id);
  });
  it("keeps a literal 新对话 first-message title stable", async () => {
    const a = await identity(),
      c = await store.conversation(a);
    await store.append(c, "user", "新对话");
    await store.append(c, "assistant", "reply");
    await store.append(c, "user", "other");
    expect((await store.history(a, c.id)).title).toBe("新对话");
  });
  it("creates independent IDs, histories and verified context", async () => {
    const a = await identity(),
      first = await store.conversation(a);
    await store.append(first, "user", "找到南苑7栋");
    await store.context(first, "osm-way-312536955", null);
    const second = await store.conversation(a);
    expect(second.id).not.toBe(first.id);
    expect((await store.history(a, second.id)).messages).toEqual([]);
    expect(second.selected_place_id).toBeNull();
    expect((await store.history(a, first.id)).messages[0].text).toBe(
      "找到南苑7栋",
    );
  });
  it("restores the chosen history and stable title, omitting empty conversations", async () => {
    const a = await identity(),
      first = await store.conversation(a);
    await store.append(first, "user", "第一条标题");
    for (let i = 0; i < 41; i++) await store.append(first, "user", `后续${i}`);
    await store.conversation(a);
    expect((await store.latest(a))?.id).toBe(first.id);
    expect((await store.history(a, first.id)).title).toBe("第一条标题");
    expect((await store.history(a, first.id)).messages).toHaveLength(42);
  });
  it("sorts and paginates by update time/id without reading all messages", async () => {
    const a = await identity(),
      ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await store.conversation(a);
      now += 100;
      await store.append(c, "user", `会话${i}`);
      ids.push(c.id);
    }
    const page = await store.list(a, undefined, 3),
      next = await store.list(a, page.nextCursor!, 3);
    expect(
      [...page.conversations, ...next.conversations].map((c) => c.id),
    ).toEqual(ids.reverse());
    expect(next.nextCursor).toBeNull();
    await expect(store.list(a, "bad cursor")).rejects.toThrow();
    await expect(store.list(a, undefined, 21)).rejects.toThrow();
  });
  it("physically removes content, refuses restore and makes deletion idempotent", async () => {
    const a = await identity(),
      c = await store.conversation(a);
    await store.append(c, "user", "private title");
    await store.deleteConversation(a, c.id);
    expect((await store.list(a)).conversations).toEqual([]);
    expect(await store.latest(a)).toBeNull();
    await expect(store.history(a, c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      fixture.sqlite
        .prepare(
          "SELECT count(*) AS n FROM conversation_messages WHERE conversation_id=?",
        )
        .get(c.id)?.n,
    ).toBe(0);
    expect(
      fixture.sqlite
        .prepare("SELECT title,selected_place_id FROM conversations WHERE id=?")
        .get(c.id),
    ).toMatchObject({ title: "已删除", selected_place_id: null });
    await expect(store.deleteConversation(a, c.id)).resolves.toEqual({
      deleted: true,
    });
  });
  it("rejects deletion and read by another guest or forged login", async () => {
    const a = await identity(),
      b = await identity(),
      c = await store.conversation(a);
    await store.append(c, "user", "only a");
    await expect(store.deleteConversation(b, c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await store.list(b)).conversations).toEqual([]);
    const forged = await store.identity(
      new Request("https://campus.invalid/api/agent/session", {
        headers: {
          Cookie:
            "campusos_session=not-an-authenticated-user-token; userId=admin",
        },
      }),
    );
    expect(forged.user).toBeNull();
    await expect(store.history(forged, c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("revokes running requests, actions and late writes without resetting quota", async () => {
    const a = await identity(),
      c = await store.conversation(a);
    await store.append(c, "user", "hello");
    const requestId = crypto.randomUUID(),
      run = await store.reserve(a, c, requestId, "isolated-ip");
    const action = await store.action(a, c, run, [
      { type: "SET_VIEW_MODE", mode: "3d" },
    ]);
    await store.deleteConversation(a, c.id);
    await expect(store.running(a.owner, run)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await expect(store.claim(a, action.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      store.append(c, "assistant", "late response"),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      store.action(a, c, run, [{ type: "CLEAR_ROUTE" }]),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      store.reserve(a, c, crypto.randomUUID(), "isolated-ip"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.finish(a, run, "completed", { text: "late" }, 1),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      fixture.sqlite
        .prepare(
          "SELECT status,charged_tokens,usage_json,tool_calls_json FROM agent_runs WHERE id=?",
        )
        .get(run),
    ).toMatchObject({
      status: "failed",
      charged_tokens: 250000,
      usage_json: null,
      tool_calls_json: "[]",
    });
    const next = await store.conversation(a);
    await store.reserve(a, next, crypto.randomUUID(), "isolated-ip");
    await store.deleteConversation(a, next.id);
    const third = await store.conversation(a);
    await expect(
      store.reserve(a, third, crypto.randomUUID(), "isolated-ip"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("isolates routes between conversations, and invalidates signed tickets on delete", async () => {
    const a = await identity(),
      first = await store.conversation(a),
      second = await store.conversation(a);
    const routes = new SharedRouteStore(
      fixture.db,
      "test-only-high-entropy-signature-secret",
      () => now,
    );
    const one = routes.forConversation(first.id),
      two = routes.forConversation(second.id);
    const r1 = await new CampusMapService(one, () => now).plan(
      routeInput,
      ctx(a.owner),
    );
    const r2 = await new CampusMapService(two, () => now).plan(
      routeInput,
      ctx(a.owner),
    );
    const ticket = await one.ticket(a.owner, r1);
    await expect(
      two.get(a.owner, r1.routeId, MAP_VERSIONS),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await store.deleteConversation(a, first.id);
    await expect(one.hydrate(a.owner, ticket)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await two.get(a.owner, r2.routeId, MAP_VERSIONS)).routeId).toBe(
      r2.routeId,
    );
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) AS n FROM assistant_route_refs WHERE id=?")
        .get(r1.routeId)?.n,
    ).toBe(0);
  });
  it("keeps shared legacy routes until their last conversation reference is deleted", async () => {
    const a = await identity(),
      first = await store.conversation(a),
      second = await store.conversation(a),
      routes = new SharedRouteStore(
        fixture.db,
        "test-only-high-entropy-signature-secret",
        () => now,
      );
    const r = await new CampusMapService(routes, () => now).plan(
      routeInput,
      ctx(a.owner),
    );
    for (const c of [first, second]) await store.context(c, null, r.routeId);
    for (const c of [first, second])
      await routes.forConversation(c.id).get(a.owner, r.routeId, MAP_VERSIONS);
    await store.deleteConversation(a, first.id);
    expect(
      (
        await routes
          .forConversation(second.id)
          .get(a.owner, r.routeId, MAP_VERSIONS)
      ).routeId,
    ).toBe(r.routeId);
  });
  it("rolls the whole delete back on D1 batch failure", async () => {
    const a = await identity(),
      c = await store.conversation(a);
    await store.append(c, "user", "must remain");
    const run = await store.reserve(a, c, crypto.randomUUID(), "isolated");
    const packet = await store.action(a, c, run, [{ type: "CLEAR_ROUTE" }]);
    fixture.sqlite.exec(
      "CREATE TRIGGER test_delete_failure BEFORE DELETE ON conversation_messages BEGIN SELECT RAISE(ABORT,'isolated failure'); END;",
    );
    await expect(store.deleteConversation(a, c.id)).rejects.toThrow();
    expect((await store.history(a, c.id)).messages[0].text).toBe("must remain");
    await expect(store.running(a.owner, run)).resolves.toBeUndefined();
    await expect(store.claim(a, packet.id)).resolves.toMatchObject({
      conversationId: c.id,
    });
  });
  it("checks conversation scope before claiming an action", async () => {
    const a = await identity(),
      c = await store.conversation(a),
      other = await store.conversation(a),
      run = await store.reserve(a, c, crypto.randomUUID(), "isolated");
    const packet = await store.action(a, c, run, [{ type: "CLEAR_ROUTE" }]);
    await expect(store.claim(a, packet.id, other.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(store.claim(a, packet.id, c.id)).resolves.toMatchObject({
      conversationId: c.id,
    });
  });
});
describe("client conversation boundaries", () => {
  it("accepts a platform-provided empty DELETE stream without accepting a missing required JSON body", async () => {
    const empty = () =>
      new Request("https://campus.invalid/api/agent/conversations/test", {
        method: "DELETE",
        body: "",
      });
    await expect(readJson(empty(), 1024, true)).resolves.toBeUndefined();
    await expect(readJson(empty())).rejects.toThrow();
  });
  it("keeps strict old-client response shapes while new clients receive titles", () => {
    const history = {
      conversationId: crypto.randomUUID(),
      messages: [],
      title: "标题",
      selectedPlaceId: null,
      activeRouteId: null,
    };
    const legacy = AssistantHistorySchema.omit({ title: true }).strict();
    expect(legacy.safeParse(historyForClient(history, false)).success).toBe(
      true,
    );
    expect(historyForClient(history, true).title).toBe("标题");
  });
  it("starts blank with no old message or ID", () => {
    expect(blankConversation()).toEqual({ title: "新对话", messages: [] });
  });
  it("deleting current clears it, deleting another preserves the exact view", () => {
    const view = { id: "a", title: "old", messages: [] };
    expect(afterConversationDelete(view, "a")).toEqual(blankConversation());
    expect(afterConversationDelete(view, "b")).toBe(view);
  });
  it("rejects late SSE, aborted card requests and stale history loads", () => {
    expect(acceptsConversationResult(1, 2)).toBe(false);
    expect(acceptsConversationResult(2, 2, true)).toBe(false);
    expect(acceptsConversationResult(2, 2)).toBe(true);
  });
});
