import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { AssistantStore } from "@/lib/server/assistant/store";
import { tokenHash } from "@/lib/server/assistant/crypto";
import { SharedRouteStore } from "@/lib/server/assistant/routes";
import {
  CampusMapService,
  MAP_VERSIONS,
} from "@/lib/server/maps/campus-map-service";
import { campusData } from "@/features/campus-map/data/campus";

const secret = "isolated-test-signing-secret-only";
const start = Date.parse("2026-10-15T00:00:00Z");
let fixture: ReturnType<typeof sqliteD1>, now: number;
beforeEach(() => {
  fixture = sqliteD1();
  now = start;
});
afterEach(() => fixture.close());
const request = (cookie = "") =>
  new Request("https://campus.invalid/api/agent/chat", {
    headers: { Cookie: cookie },
  });
const context = (owner: string) => ({
  requestId: "test-only",
  sessionId: owner,
  user: null,
  campusId: "gdufs_university_town" as const,
  permissions: [],
});
const routeInput = {
  start: { type: "place" as const, placeId: "osm-way-312536955" },
  endPlaceId: "osm-way-307250998",
  mode: "walking" as const,
};

describe("D1-backed identity, history and shared budgets (isolated SQLite)", () => {
  it("restores a guest through a new store instance, without trusting forged identity", async () => {
    const a = await new AssistantStore(fixture.db, () => now).identity(
      request("userId=admin; campusos_assistant=admin"),
    );
    const next = new AssistantStore(fixture.db, () => now);
    const b = await next.identity(request(a.cookie.split(";")[0]));
    expect(b.owner).toBe(a.owner);
    expect(b.user).toBeNull();
    expect(
      fixture.sqlite.prepare("SELECT token_hash FROM assistant_sessions").get()
        ?.token_hash,
    ).not.toBe(a.cookie.split("=")[1]);
  });
  it("isolates guest, verified login and revoked/forged login cookies", async () => {
    const store = new AssistantStore(fixture.db, () => now);
    const guest = await store.identity(request());
    const conversation = await store.conversation(guest);
    const loginToken = "test-only-login-token-with-enough-length";
    fixture.sqlite
      .prepare(
        "INSERT INTO users(id,display_name) VALUES('test-user','Isolated user')",
      )
      .run();
    fixture.sqlite
      .prepare(
        "INSERT INTO login_sessions(session_hash,user_id,expires_at) VALUES(?, 'test-user', ?)",
      )
      .run(await tokenHash(loginToken), new Date(now + 3600000).toISOString());
    const user = await store.identity(
      request(`campusos_session=${loginToken}; ${guest.cookie.split(";")[0]}`),
    );
    expect(user.user?.id).toBe("test-user");
    expect(user.owner).not.toBe(guest.owner);
    await expect(store.history(user, conversation.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const privateConversation = await store.conversation(user);
    const restored = await new AssistantStore(fixture.db, () => now).identity(
      request(`campusos_session=${loginToken}; ${user.cookie.split(";")[0]}`),
    );
    expect(restored.owner).toBe(user.owner);
    fixture.sqlite
      .prepare("UPDATE login_sessions SET revoked_at=?")
      .run(new Date(now).toISOString());
    const revoked = await store.identity(
      request(`campusos_session=${loginToken}; ${user.cookie.split(";")[0]}`),
    );
    expect(revoked.user).toBeNull();
    await expect(
      store.history(revoked, privateConversation.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("restores bounded history and cannot read another visitor's conversation", async () => {
    const store = new AssistantStore(fixture.db, () => now),
      a = await store.identity(request()),
      b = await store.identity(request());
    const conversation = await store.conversation(a);
    for (let i = 0; i < 25; i++)
      await store.append(conversation, "user", "公开测试 " + i);
    const restored = await new AssistantStore(fixture.db, () => now).history(
      a,
      conversation.id,
    );
    expect(restored.messages).toHaveLength(20);
    expect(restored.messages[0].text).toBe("公开测试 5");
    await expect(store.history(b, conversation.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("reserves only one concurrent run across independent DAO instances", async () => {
    const a = new AssistantStore(fixture.db, () => now),
      b = new AssistantStore(fixture.db, () => now);
    const identity = await a.identity(request());
    const conversation = await a.conversation(identity);
    const result = await Promise.allSettled([
      a.reserve(identity, conversation, crypto.randomUUID(), "isolated-ip"),
      b.reserve(identity, conversation, crypto.randomUUID(), "isolated-ip"),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
    const runId = (
      result.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<string>
    ).value;
    await a.finish(identity, runId, "completed", {}, 100);
    expect(
      await b.reserve(
        identity,
        conversation,
        crypto.randomUUID(),
        "isolated-ip",
      ),
    ).toBeTruthy();
  });
  it("enforces shared guest count quotas and unique request IDs", async () => {
    const store = new AssistantStore(fixture.db, () => now),
      identity = await store.identity(request());
    const conversation = await store.conversation(identity);
    const firstRequest = crypto.randomUUID();
    for (let i = 0; i < 20; i++) {
      const run = await store.reserve(
        identity,
        conversation,
        i === 0 ? firstRequest : crypto.randomUUID(),
        "isolated-ip",
      );
      await store.finish(identity, run, "completed", {}, 100);
    }
    await expect(
      new AssistantStore(fixture.db, () => now).reserve(
        identity,
        conversation,
        crypto.randomUUID(),
        "isolated-ip",
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    now += 3600001;
    await expect(
      store.reserve(identity, conversation, firstRequest, "isolated-ip"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("keeps a conservative charge for unknown/cancelled usage and expires abandoned leases", async () => {
    const store = new AssistantStore(fixture.db, () => now),
      identity = await store.identity(request());
    const conversation = await store.conversation(identity);
    const id = crypto.randomUUID();
    const run = await store.reserve(identity, conversation, id, "isolated-ip");
    await store.cancel(identity, id);
    await expect(store.running(identity.owner, run)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(
      fixture.sqlite
        .prepare("SELECT charged_tokens FROM agent_runs WHERE id=?")
        .get(run)?.charged_tokens,
    ).toBe(250000);
    await store.reserve(
      identity,
      conversation,
      crypto.randomUUID(),
      "isolated-ip",
    );
    now += 120001;
    await expect(
      store.reserve(identity, conversation, crypto.randomUUID(), "isolated-ip"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("requires a live or completed owned run to claim an action and rejects replay", async () => {
    const store = new AssistantStore(fixture.db, () => now),
      a = await store.identity(request()),
      b = await store.identity(request());
    const conversation = await store.conversation(a);
    const run = await store.reserve(
      a,
      conversation,
      crypto.randomUUID(),
      "isolated-ip",
    );
    const packet = await store.action(a, conversation, run, [
      { type: "CLEAR_ROUTE" },
    ]);
    expect(await store.execution(a.owner, packet.id, run)).toBeNull();
    await expect(
      store.execution(b.owner, packet.id, run),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await store.finish(a, run, "completed", {}, 1);
    await expect(
      store.execution(a.owner, packet.id, run),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(store.claim(b, packet.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await store.claim(a, packet.id)).actions).toEqual([
      { type: "CLEAR_ROUTE" },
    ]);
    await expect(store.claim(a, packet.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await store.receipt(a, packet.id, true, "路线已清除");
  });
  it("consumes a short-lived, owner-bound location challenge once", async () => {
    const store = new AssistantStore(fixture.db, () => now),
      a = await store.identity(request()),
      b = await store.identity(request());
    const nonce = await store.locationChallenge(a);
    const grant = {
      challenge: nonce,
      coordinate: [113.390146, 23.0615765] as [number, number],
      accuracyMeters: 20,
      capturedAt: now,
    };
    await expect(store.consumeLocation(b, grant)).rejects.toMatchObject({
      code: "LOCATION_REQUIRED",
    });
    expect((await store.consumeLocation(a, grant)).consent).toBe(
      "browser_geolocation",
    );
    await expect(store.consumeLocation(a, grant)).rejects.toMatchObject({
      code: "LOCATION_REQUIRED",
    });
  });
  it("revokes claimed and pending actions when a run fails or is cancelled late", async () => {
    const store = new AssistantStore(fixture.db, () => now);
    const identity = await store.identity(request());
    const conversation = await store.conversation(identity);
    const requestId = crypto.randomUUID();
    const run = await store.reserve(
      identity,
      conversation,
      requestId,
      "isolated-ip",
    );
    const claimed = await store.action(identity, conversation, run, [
      { type: "CLEAR_ROUTE" },
    ]);
    await store.claim(identity, claimed.id);
    await store.finish(identity, run, "failed", {}, 1, "MODEL_TIMEOUT");
    await expect(
      store.receipt(identity, claimed.id, true, "map updated"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const nextRequest = crypto.randomUUID();
    const next = await store.reserve(
      identity,
      conversation,
      nextRequest,
      "isolated-ip",
    );
    const pending = await store.action(identity, conversation, next, [
      { type: "CLEAR_ROUTE" },
    ]);
    await store.finish(identity, next, "completed", {}, 1);
    await store.cancel(identity, nextRequest);
    await expect(store.claim(identity, pending.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("restorable shared routes and location privacy", () => {
  it("restores a public route in a fresh store and enforces identity/version/expiry", async () => {
    const routes = new SharedRouteStore(fixture.db, secret, () => now);
    const service = new CampusMapService(routes, () => now);
    const route = await service.plan(routeInput, context("guest-a"));
    const next = new SharedRouteStore(fixture.db, secret, () => now);
    expect(
      (await next.get("guest-a", route.routeId, MAP_VERSIONS)).distanceMeters,
    ).toBe(route.distanceMeters);
    await expect(
      next.get("guest-b", route.routeId, MAP_VERSIONS),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      next.get("guest-a", route.routeId, {
        ...MAP_VERSIONS,
        mapVersion: "old",
      }),
    ).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    now += 600001;
    await expect(
      next.get("guest-a", route.routeId, MAP_VERSIONS),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("never persists precise device-route geometry, but a signed page-memory ticket restores it", async () => {
    const routes = new SharedRouteStore(fixture.db, secret, () => now);
    const service = new CampusMapService(routes, () => now);
    const coordinate = campusData.places.find(
      (p) => p.id === routeInput.start.placeId,
    )!.coordinate;
    const route = await service.plan(
      { ...routeInput, start: { type: "device_location" } },
      {
        ...context("guest-a"),
        map: {
          requiresDeviceOrigin: true,
          authorizedLocation: {
            coordinate,
            accuracyMeters: 20,
            capturedAt: now,
            expiresAt: now + 30000,
            consent: "browser_geolocation",
          },
        },
      },
    );
    expect(
      fixture.sqlite
        .prepare("SELECT payload_json FROM assistant_route_refs WHERE id=?")
        .get(route.routeId)?.payload_json,
    ).toBeNull();
    const ticket = await routes.ticket("guest-a", route);
    const next = new SharedRouteStore(fixture.db, secret, () => now);
    await expect(
      next.get("guest-a", route.routeId, MAP_VERSIONS),
    ).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    await next.hydrate("guest-a", ticket);
    expect(
      (await next.get("guest-a", route.routeId, MAP_VERSIONS)).approachPath,
    ).not.toBeNull();
    await expect(next.hydrate("guest-b", ticket)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      next.hydrate("guest-a", ticket.slice(0, -4) + "AAAA"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
