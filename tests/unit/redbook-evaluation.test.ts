import { it, expect, vi } from "vitest";
import { evaluateRedbook } from "../../scripts/evaluate-redbook.mjs";
const state = {
  cookies: ["a1", "web_session", "webId"].map((name) => ({
    name,
    value: "fixture-only-private",
    domain: ".xiaohongshu.com",
    path: "/",
    expires: -1,
  })),
};
it("does not interpret an ambiguous identity response as an expired login", async () => {
  const searchNotes = vi.fn();
  const r = await evaluateRedbook({
    state,
    makeClient: async () => ({
      getSelfInfo: async () => ({ user_id: "fixture-unknown" }),
      searchNotes,
    }),
  });
  expect(r.status).toBe("identity_unconfirmed");
  expect(searchNotes).not.toHaveBeenCalled();
});
it("can test public guest access without claiming login, and respects a source permission denial", async () => {
  const searchNotes = vi.fn(async () => {
    throw Object.assign(new Error("fixture denied"), { code: -104 });
  });
  const r = await evaluateRedbook({
    state,
    allowGuestSearch: true,
    makeClient: async () => ({
      getSelfInfo: async () => ({ guest: true, user_id: "fixture-guest" }),
      searchNotes,
    }),
  });
  expect(searchNotes).toHaveBeenCalledOnce();
  expect(r).toMatchObject({
    authenticated: false,
    guestSearchAttempted: true,
    status: "search_permission_denied",
    searchVerified: false,
  });
});
it("stops before search when the source confirms a guest session", async () => {
  const searchNotes = vi.fn();
  const r = await evaluateRedbook({
    state,
    makeClient: async () => ({
      getSelfInfo: async () => ({ guest: true, user_id: "fixture-guest" }),
      searchNotes,
    }),
  });
  expect(r.status).toBe("login_required");
  expect(searchNotes).not.toHaveBeenCalled();
  expect(JSON.stringify(r)).not.toContain("fixture-only-private");
  expect(JSON.stringify(r)).not.toContain("fixture-guest");
});
it("refuses write paths and restores the process transport on failure", async () => {
  const previous = globalThis.fetch,
    transport = vi.fn();
  const r = await evaluateRedbook({
    state,
    transport,
    makeClient: async () => ({
      getSelfInfo: () =>
        fetch("https://edith.xiaohongshu.com/api/sns/web/v1/note/like", {
          method: "POST",
        }),
    }),
  });
  expect(r.status).toBe("unavailable");
  expect(transport).not.toHaveBeenCalled();
  expect(globalThis.fetch).toBe(previous);
});
it("counts real transport invocations and keeps search results separate from body evidence", async () => {
  const transport = vi.fn(async () =>
    Response.json({ success: true, code: 0 }),
  );
  const invoke = (path: string, method = "GET") =>
    fetch("https://edith.xiaohongshu.com" + path, { method });
  const r = await evaluateRedbook({
    state,
    transport,
    makeClient: async () => ({
      getSelfInfo: async () => {
        await invoke("/api/sns/web/v2/user/me");
        return { guest: false, user_id: "fixture-auth" };
      },
      searchNotes: async () => {
        await invoke("/api/sns/web/v1/search/notes", "POST");
        return {
          items: [
            {
              id: "fixture-note",
              xsec_token: "fixture-public-note-token",
              note_card: { display_title: "Fixture only" },
            },
          ],
        };
      },
      getNoteById: async () => {
        await invoke("/api/sns/web/v1/feed", "POST");
        return { items: [{ note_card: { desc: "Fixture evidence" } }] };
      },
    }),
  });
  expect(r).toMatchObject({
    authenticated: true,
    searchVerified: true,
    bodyVerified: true,
    httpRequests: 3,
    requestCounts: { authentication: 1, search: 1, noteDetail: 1 },
  });
  expect(r.items[0].snippet).toBe("Fixture evidence");
  expect(JSON.stringify(r)).not.toContain("fixture-auth");
});
