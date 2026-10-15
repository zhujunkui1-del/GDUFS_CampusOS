import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
const bindings = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => bindings,
}));
import { executeMapSkillHttp } from "@/lib/server/maps/http";

let fixture: ReturnType<typeof sqliteD1>;
beforeEach(() => { fixture = sqliteD1(); bindings.env = { DB: fixture.db, AGENT_SIGNING_SECRET: "isolated-test-secret-not-a-real-key", APP_ENV: "local" }; });
afterEach(() => { fixture.close(); vi.restoreAllMocks(); });
describe("deterministic public map Skill HTTP boundary", () => {
  async function post(
    name: string,
    input: unknown,
    cookie = "",
    extra: Record<string, unknown> = {},
  ) {
    vi.spyOn(console, "info").mockImplementation(() => {});
    return executeMapSkillHttp(
      new Request(`https://example.invalid/api/map/skills/${name}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: JSON.stringify({ input, ...extra }),
      }),
    );
  }
  it("executes real tools without calling the model or accepting client identity", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const response = await post("search_places", { query: "南苑7栋" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.data.matches[0].placeId).toBe("osm-way-312536955");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(spy).not.toHaveBeenCalled();
    const forged = await post("search_places", { query: "南苑7栋" }, "", {
      userId: "admin",
      authorizedLocation: { coordinate: [0, 0] },
    });
    expect(forged.status).toBe(400);
  });
  it("reuses a server session to validate route actions and rejects another session", async () => {
    const route = await post("plan_route", {
      start: { type: "place", placeId: "osm-way-312536955" },
      endPlaceId: "osm-way-307250998",
      mode: "walking",
    });
    expect(route.status).toBe(200);
    const cookie = route.headers.get("Set-Cookie")!.split(";")[0],
      id = (await route.json()).data.data.routeId;
    const actions = { actions: [{ type: "SHOW_ROUTE", routeId: id }] };
    expect((await post("control_map", actions, cookie)).status).toBe(200);
    expect((await post("control_map", actions)).status).toBe(404);
  });
  it("rejects unknown tool names, raw GPS, invalid IDs and missing input", async () => {
    expect((await post("run_sql", {})).status).toBe(404);
    expect((await post("get_place_details", { placeId: "fake" })).status).toBe(
      404,
    );
    expect(
      (
        await post("find_nearby_places", {
          origin: { type: "device_location" },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post("find_nearby_places", {
          origin: { type: "device_location", coordinate: [113.39, 23.06] },
        })
      ).status,
    ).toBe(400);
    expect((await post("search_places", undefined)).status).toBe(400);
  });
  it("rejects cross-origin POSTs", async () => {
    const response = await executeMapSkillHttp(
      new Request("https://example.invalid/api/map/skills/search_places", {
        method: "POST",
        headers: { Origin: "https://evil.invalid" },
        body: '{"input":{"query":"南苑7栋"}}',
      }),
    );
    expect(response.status).toBe(403);
  });
});
