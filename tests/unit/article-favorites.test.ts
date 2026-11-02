import { describe, expect, it, vi } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ArticleFavoriteStore } from "@/lib/server/account/favorites";
import { AccountService } from "@/lib/server/account/email";
import { createAccountApi } from "@/lib/server/account/api";

async function favoritesFixture() {
  const f = await dateGateFixture();
  const user = (id: string) => {
    f.sqlite
      .prepare("INSERT INTO users(id,display_name) VALUES(?,?)")
      .run(id, id);
    return id;
  };
  return { ...f, user };
}

describe("article favorites store", () => {
  it("keeps one row per user and article and lists newest first", async () => {
    const f = await favoritesFixture();
    const store = new ArticleFavoriteStore(f.db);
    const user = f.user("favorites-user-a");
    const [spring, autumn, white] = f.ids;
    expect(f.visible()).toEqual(expect.arrayContaining([spring, autumn, white]));

    await store.add(user, spring, { originSurface: "radar" });
    await store.add(user, spring, { originSurface: "calendar" });
    await store.add(user, autumn, { originSurface: "knowledge" });

    const list = await store.list(user, {});
    expect(list.total).toBe(2);
    expect(list.items.map((item) => item.articleId)).toEqual([
      autumn,
      spring,
    ]);
    expect(list.items.find((item) => item.articleId === spring)).toMatchObject({
      originSurface: "radar",
      available: true,
      readable: true,
      sourceName: "隔离来源",
    });

    const status = await store.status(user, {
      articleIds: [spring, white],
    });
    expect(status.favorited).toEqual([spring]);
  });

  it("isolates users and makes duplicate writes idempotent", async () => {
    const f = await favoritesFixture();
    const store = new ArticleFavoriteStore(f.db);
    const a = f.user("favorites-user-a");
    const b = f.user("favorites-user-b");
    const id = f.ids[0];

    await store.add(a, id, { originSurface: "radar" });
    await store.add(a, id, { originSurface: "radar" });
    expect((await store.list(a, {})).total).toBe(1);
    expect((await store.list(b, {})).total).toBe(0);

    await store.remove(b, id);
    expect((await store.list(a, {})).total).toBe(1);
    await store.remove(a, id);
    await store.remove(a, id);
    expect((await store.list(a, {})).total).toBe(0);
  });

  it("rejects invalid or non-public article ids", async () => {
    const f = await favoritesFixture();
    const store = new ArticleFavoriteStore(f.db);
    const user = f.user("favorites-user-a");
    await expect(
      store.add(user, "not a valid id!", { originSurface: "radar" }),
    ).rejects.toThrow();
    await expect(
      store.add(user, "missing-article", { originSurface: "radar" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await store.list(user, {})).total).toBe(0);
  });

  it("keeps unavailable favorites without exposing them as readable", async () => {
    const f = await favoritesFixture();
    const store = new ArticleFavoriteStore(f.db);
    const user = f.user("favorites-user-a");
    const id = f.ids[0];
    await store.add(user, id, { originSurface: "knowledge" });
    f.sqlite
      .prepare("UPDATE knowledge_documents SET publication_status='draft' WHERE id=?")
      .run(id);

    const list = await store.list(user, {});
    expect(list.items[0]).toMatchObject({
      articleId: id,
      available: false,
      readable: false,
    });
    await store.remove(user, id);
    expect((await store.list(user, {})).total).toBe(0);
  });

  it("filters by origin surface and paginates", async () => {
    const f = await favoritesFixture();
    const store = new ArticleFavoriteStore(f.db);
    const user = f.user("favorites-user-a");
    await store.add(user, f.ids[0], { originSurface: "radar" });
    await store.add(user, f.ids[1], { originSurface: "radar" });
    await store.add(user, f.ids[2], { originSurface: "calendar" });

    const radar = await store.list(user, {
      surface: "radar",
      limit: 1,
      page: 1,
    });
    expect(radar.total).toBe(2);
    expect(radar.items).toHaveLength(1);
    expect(radar.hasMore).toBe(true);
    const next = await store.list(user, {
      surface: "radar",
      limit: 1,
      page: 2,
    });
    expect(next.items[0].articleId).not.toBe(radar.items[0].articleId);
  });
});

describe("article favorites API", () => {
  it("requires a session, checks publication and isolates users", async () => {
    const f = await favoritesFixture();
    const service = new AccountService(f.db, {
      origin: "https://campus.example",
      otpSecret: "favorites-fixture-secret-".repeat(3),
    });
    const register = (username: string) =>
      service.register(
        { username, password: "Fixture-Password-Only" },
        new Request("https://campus.example/api/auth/register"),
        username,
      );
    const a = await register("FavoritesApiA");
    const b = await register("FavoritesApiB");
    const api = createAccountApi({
      store: service,
      enabled: true,
      defer: () => {},
    });
    const call = (method: string, path: string, token?: string, body?: unknown) =>
      api(
        new Request("https://campus.example" + path, {
          method,
          headers: {
            ...(token ? { Cookie: "campusos_session=" + token } : {}),
            "Content-Type": "application/json",
            Origin: "https://campus.example",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    const json = async (response: Response) =>
      (await response.json()) as {
        data?: Record<string, unknown>;
        error?: { code: string };
      };

    const anonymous = await call("GET", "/api/me/favorites");
    expect(anonymous.status).toBe(401);

    const invalid = await call(
      "PUT",
      "/api/me/favorites/" + encodeURIComponent("not valid!"),
      a.token,
      { originSurface: "radar" },
    );
    expect((await json(invalid)).error?.code).toBe("INVALID_ARGUMENT");

    const missing = await call("PUT", "/api/me/favorites/missing-article", a.token, {
      originSurface: "radar",
    });
    expect((await json(missing)).error?.code).toBe("NOT_FOUND");

    const articleId = f.ids[0];
    const added = await call("PUT", "/api/me/favorites/" + articleId, a.token, {
      originSurface: "radar",
    });
    expect(added.status).toBe(200);
    expect((await json(added)).data).toMatchObject({
      articleId,
      favorited: true,
      originSurface: "radar",
    });
    await call("PUT", "/api/me/favorites/" + articleId, a.token, {
      originSurface: "calendar",
    });

    const statusA = await call("POST", "/api/me/favorites/status", a.token, {
      articleIds: [articleId],
    });
    expect((await json(statusA)).data).toEqual({ favorited: [articleId] });
    const statusB = await call("POST", "/api/me/favorites/status", b.token, {
      articleIds: [articleId],
    });
    expect((await json(statusB)).data).toEqual({ favorited: [] });

    const listA = await call("GET", "/api/me/favorites", a.token);
    const listData = (await json(listA)).data as {
      total: number;
      items: Array<{ articleId: string }>;
    };
    expect(listData.total).toBe(1);
    expect(listData.items[0].articleId).toBe(articleId);

    const removeB = await call("DELETE", "/api/me/favorites/" + articleId, b.token);
    expect((await json(removeB)).data).toMatchObject({ removed: false });
    expect((await json(await call("GET", "/api/me/favorites", a.token))).data).toMatchObject({
      total: 1,
    });

    const removeA = await call("DELETE", "/api/me/favorites/" + articleId, a.token);
    expect((await json(removeA)).data).toMatchObject({ removed: true });
    expect((await json(await call("GET", "/api/me/favorites", a.token))).data).toMatchObject({
      total: 0,
    });
  });
});
