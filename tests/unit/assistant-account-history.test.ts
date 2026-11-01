import { it, expect } from "vitest";
import { accountFixture } from "../fixtures/account";
import { AssistantStore } from "@/lib/server/assistant/store";
import { requestConversationId } from "@/domain/agent/conversation-key";
const req = (cookie = "") =>
  new Request("https://campus.example/api/agent/session", {
    headers: { Cookie: cookie },
  });

it("the same client request ID is isolated between two authenticated accounts", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("namespace_a"),
      b = await f.register("namespace_b"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token)),
      v = await s.identity(req("campusos_session=" + b.token)),
      key = crypto.randomUUID();
    const aid = await requestConversationId(u.owner, key),
      bid = await requestConversationId(v.owner, key);
    expect(aid).not.toBe(bid);
    expect(await requestConversationId(u.owner, key)).toBe(aid);
    const ca = await s.conversation(u, undefined, aid),
      cb = await s.conversation(v, undefined, bid);
    await s.reserve(u, ca, key, "fixture");
    await s.reserve(v, cb, key, "fixture");
    await s.append(ca, "user", "A", [], key);
    await s.append(cb, "user", "B", [], key);
    expect((await s.history(u, ca.id)).messages[0].text).toBe("A");
    expect((await s.history(v, cb.id)).messages[0].text).toBe("B");
  } finally {
    f.close();
  }
});

it("a new login after expiry restores account history but old sessions cannot read it", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("history_expiry"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token)),
      c = await s.conversation(u);
    await s.append(c, "user", "long lived");
    f.advance(35 * 86400000);
    await s.cleanup();
    const expired = await s.identity(req("campusos_session=" + a.token));
    expect(expired.user).toBeNull();
    await expect(s.history(expired, c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const renewed = await f.store.login(
      { identifier: a.profile.username, password: "Fixture-Password-Only" },
      f.request(),
      "fixture",
    );
    const next = await s.identity(req("campusos_session=" + renewed.token));
    expect((await s.history(next, c.id)).messages[0].text).toBe("long lived");
  } finally {
    f.close();
  }
});
it("role changes invalidate the account scope and a Console cookie grants no private history", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("history_roles"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token)),
      c = await s.conversation(u);
    await s.append(c, "user", "private");
    f.sqlite
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(a.profile.id);
    for (const cookie of [
      "campusos_session=" + a.token,
      "campusos_console_session=" + a.token,
    ]) {
      const denied = await s.identity(req(cookie));
      expect(denied.user).toBeNull();
      await expect(s.history(denied, c.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  } finally {
    f.close();
  }
});
it("full stored replies and source cards are independent from model context truncation", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("history_content"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token)),
      c = await s.conversation(u);
    await s.append(c, "assistant", "长".repeat(10000), [
      {
        kind: "external_source",
        title: "fixture source",
        sourceName: "fixture",
        originalUrl: "https://campus.example/article",
        publishedAt: null,
        snippet: "fixture",
        authority: "official",
        evidenceKind: "page_excerpt",
        searchMode: "web",
      },
    ]);
    const full = await s.history(u, c.id);
    expect(full.messages[0].text).toHaveLength(10000);
    expect(full.messages[0].cards).toHaveLength(1);
    expect(
      (await s.history(u, c.id, { context: true })).messages[0].text,
    ).toHaveLength(8000);
    const plan = f.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM conversation_messages WHERE conversation_id=? AND sequence<? ORDER BY sequence DESC LIMIT 41",
      )
      .all(c.id, 100);
    expect(JSON.stringify(plan)).toContain("assistant_message_sequence");
  } finally {
    f.close();
  }
});
it("S4 identity wins over a guest cookie without claiming or replacing guest history", async () => {
  const f = accountFixture();
  try {
    const s = new AssistantStore(f.db, f.store.now, true),
      g = await s.identity(req()),
      c = await s.conversation(g);
    await s.append(c, "user", "guest only");
    const a = await f.register("history_a"),
      b = await f.register("history_b");
    const u = await s.identity(
      req(`campusos_session=${a.token}; ${g.cookie.split(";")[0]}`),
    );
    expect(u.owner).toBe("u:" + a.profile.id);
    expect(u.user?.id).toBe(a.profile.id);
    await expect(s.history(u, c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const other = await s.identity(
      req(`campusos_session=${b.token}; ${g.cookie.split(";")[0]}`),
    );
    expect(other.owner).toBe("u:" + b.profile.id);
    expect((await s.identity(req(g.cookie.split(";")[0]))).owner).toBe(g.owner);
  } finally {
    f.close();
  }
});
it("account history survives guest TTL, while visitor history expires", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("history_ttl"),
      s = new AssistantStore(f.db, f.store.now, true);
    const u = await s.identity(req("campusos_session=" + a.token)),
      g = await s.identity(req());
    const c = await s.conversation(u),
      gc = await s.conversation(g);
    await s.append(c, "user", "persist");
    f.advance(3 * 86400000);
    await s.cleanup();
    expect((await s.history(u, c.id)).messages[0].text).toBe("persist");
    await expect(s.history(g, gc.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    f.close();
  }
});
it("stable bounded pages recover all 120 messages without repeats despite later appends", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("history_pages"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token)),
      c = await s.conversation(u);
    for (let i = 0; i < 120; i++)
      await s.append(c, i % 2 ? "assistant" : "user", "message " + i);
    let page = await s.history(u, c.id),
      all = [...page.messages];
    expect(page.messages.length).toBeLessThanOrEqual(40);
    await s.append(c, "user", "concurrent new message");
    while (page.olderCursor) {
      page = await s.history(u, c.id, { before: page.olderCursor });
      all = [...page.messages, ...all];
    }
    expect(all).toHaveLength(120);
    expect(new Set(all.map((x) => x.id)).size).toBe(120);
    expect(all[0].text).toBe("message 0");
    const updates = await s.history(u, c.id, { after: all.at(-1)!.sequence });
    expect(updates.messages.map((x) => x.text)).toEqual([
      "concurrent new message",
    ]);
  } finally {
    f.close();
  }
});
it("request-bound message IDs and requests cannot duplicate or cross owners", async () => {
  const f = accountFixture();
  try {
    const a = await f.register("history_retry"),
      b = await f.register("history_other"),
      s = new AssistantStore(f.db, f.store.now, true),
      u = await s.identity(req("campusos_session=" + a.token)),
      v = await s.identity(req("campusos_session=" + b.token)),
      c = await s.conversation(u),
      requestId = crypto.randomUUID();
    await s.reserve(u, c, requestId, "fixture");
    await s.append(c, "user", "once", [], requestId);
    await s.append(c, "user", "once", [], requestId);
    expect((await s.history(u, c.id)).messages).toHaveLength(1);
    await expect(s.deleteConversation(v, c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(s.history(v, c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    f.close();
  }
});
