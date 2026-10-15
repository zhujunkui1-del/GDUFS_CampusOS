import { describe, expect, it, vi } from "vitest";
import { campusData } from "@/features/campus-map/data/campus";
import { distanceMeters } from "@/features/campus-map/data/geometry";
import { MapActionSchema } from "@/domain/maps/contracts";
import {
  RouteOutputSchema,
  SearchPlacesOutputSchema,
  NearbyPlacesOutputSchema,
  PlaceDetailsOutputSchema,
  ControlMapOutputSchema,
} from "@/domain/maps/skill-contracts";
import type { SkillContext } from "@/domain/skills/contracts";
import type { AgentEvent } from "@/domain/agent/contracts";
import {
  CampusMapService,
  MAP_VERSIONS,
} from "@/lib/server/maps/campus-map-service";
import { createMapSkillRegistry } from "@/lib/server/maps/skills";
import { ToolExecutor } from "@/lib/server/agent/tool-executor";
import { MemoryRouteSnapshotStore } from "@/lib/server/maps/route-store";
import { createMapAgent } from "@/lib/server/maps/agent";
import { MapSessionVault } from "@/lib/server/maps/runtime";
import { MockModelProvider } from "../fixtures/mock-model";
import * as localRouting from "@/features/campus-map/data/local-routing";

const dorm = "osm-way-312536955",
  library = "osm-way-307250998";
const ctx: SkillContext = {
  requestId: "test-only",
  sessionId: "trusted-server-owner",
  user: null,
  permissions: [],
  campusId: "gdufs_university_town",
};
const now = Date.parse("2026-10-15T00:00:00Z");
function setup() {
  const store = new MemoryRouteSnapshotStore(() => now);
  const service = new CampusMapService(store, () => now);
  const registry = createMapSkillRegistry(service);
  const executor = new ToolExecutor(registry);
  return {
    service,
    store,
    registry,
    call: (name: string, input: unknown, context = ctx) =>
      executor.execute(
        {
          id: crypto.randomUUID(),
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        },
        context,
      ),
  };
}
const routeInput = {
  start: { type: "place" as const, placeId: dorm },
  endPlaceId: library,
  mode: "walking" as const,
};
describe("five production map Skills with real fixed campus data", () => {
  it("registers exactly five real public functions with strict input/output contracts", () => {
    const { registry } = setup();
    expect(registry.manifest().map((s) => s.name)).toEqual([
      "search_places",
      "get_place_details",
      "find_nearby_places",
      "plan_route",
      "control_map",
    ]);
    for (const skill of registry.manifest()) {
      expect(skill.auth).toBe("public");
      expect(skill.domain).toBe("spatial-domain");
      expect(skill.sideEffect).toBe("none");
      expect(
        registry.get(skill.name)!.tool.function.parameters.additionalProperties,
      ).toBe(false);
    }
  });
  it.each([
    ["南苑7栋", dorm],
    ["南苑七栋", dorm],
    ["图书馆", library],
    ["教学楼 B 栋", "osm-relation-19299171"],
    ["语心桥", "owner-bridge-f"],
    ["八角楼", "owner-bajiaolou"],
    ["报告厅", "osm-way-651642991"],
  ])("finds %s from real names and aliases", async (query, id) => {
    const result = await setup().call("search_places", { query });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = SearchPlacesOutputSchema.parse(result.data);
      expect(data.matches[0].placeId).toBe(id);
      expect(data.matches[0].crs).toBe("WGS84");
    }
  });
  it("returns ambiguous candidates and explicitly labels limited fuzzy matching", async () => {
    const { service } = setup();
    const candidates = service.search({ query: "篮球场" }, ctx);
    expect(candidates.matches.length).toBeGreaterThan(1);
    expect(candidates.ambiguous).toBe(true);
    const fuzzy = service.search({ query: "八角娄" }, ctx);
    expect(fuzzy.matchType).toBe("fuzzy");
    expect(fuzzy.ambiguous).toBe(true);
    expect(fuzzy.matches[0].name).toBe("八角楼");
    const nearest = service.search({ query: "最近的食堂" }, ctx);
    expect(nearest.matches.every((p) => p.category === "canteen")).toBe(true);
    expect(nearest.requiresOriginForNearest).toBe(true);
  });
  it("never invents an unknown numbered building", async () => {
    expect(
      await setup().call("search_places", { query: "南苑999栋" }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
  it("returns known South 7 height only and leaves other unknown facts null", async () => {
    const { service } = setup();
    const pilot = service.details({ placeId: dorm }, ctx),
      other = service.details({ placeId: library }, ctx);
    expect(pilot.building).toMatchObject({
      levels: 7,
      heightMeters: 21,
      heightAccuracy: "owner_approximation",
    });
    expect(pilot.source.url).toMatch(/^https:/);
    expect(pilot.navigation.entranceDetails).toBe("unknown");
    expect(other.building.levels).toBeNull();
    expect(other.building.heightMeters).toBeNull();
    expect(
      PlaceDetailsOutputSchema.safeParse({ ...pilot, invented: true }).success,
    ).toBe(false);
  });
  it("uses WGS84 geodesic distances, sorts canteens and states the chosen center", async () => {
    const result = await setup().call("find_nearby_places", {
      origin: { type: "place", placeId: dorm },
      category: "canteen",
      radiusMeters: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = NearbyPlacesOutputSchema.parse(result.data);
    expect(data.matches.length).toBeGreaterThan(1);
    expect(data.origin.source).toBe("place");
    expect(data.distanceType).toBe("geodesic_straight_line");
    expect(data.matches[0].distanceMeters).toBeLessThanOrEqual(
      data.matches[1].distanceMeters,
    );
    for (const place of data.matches)
      expect(place.distanceMeters).toBeCloseTo(
        distanceMeters(data.origin.coordinate, place.location),
        8,
      );
  });
  it("uses the selected place only when it exists and reports its provenance", () => {
    const { service } = setup();
    expect(
      service.nearby(
        { category: "canteen" },
        { ...ctx, map: { selectedPlaceId: dorm } },
      ).origin.source,
    ).toBe("selected_map_place");
    expect(() => service.nearby({}, ctx)).toThrow(/选择起点/);
    expect(() =>
      service.nearby({}, { ...ctx, map: { selectedPlaceId: "fake" } }),
    ).toThrow(/不存在/);
  });
  it("returns actual empty nearby results rather than broadening the radius", () => {
    expect(
      setup().service.nearby(
        {
          origin: { type: "place", placeId: dorm },
          category: "canteen",
          radiusMeters: 1,
        },
        ctx,
      ).matches,
    ).toEqual([]);
  });
  it("requires current accurate browser consent and rejects model-supplied coordinates", async () => {
    const { call } = setup();
    expect(
      await call("find_nearby_places", { origin: { type: "device_location" } }),
    ).toMatchObject({ error: { code: "LOCATION_REQUIRED" } });
    expect(
      await call("find_nearby_places", {
        origin: {
          type: "device_location",
          coordinate: [113.39, 23.06],
          consent: true,
        },
      }),
    ).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    const grant = {
      coordinate: campusData.places.find((p) => p.id === dorm)!.coordinate,
      accuracyMeters: 20,
      capturedAt: now,
      expiresAt: now + 30000,
      consent: "browser_geolocation" as const,
    };
    const accepted = await call(
      "find_nearby_places",
      { origin: { type: "device_location" }, category: "canteen" },
      { ...ctx, map: { authorizedLocation: grant } },
    );
    expect(accepted.ok).toBe(true);
    for (const bad of [
      { ...grant, expiresAt: now - 1 },
      { ...grant, accuracyMeters: 101 },
      { ...grant, capturedAt: now + 1 },
      { ...grant, expiresAt: now + 60000 },
    ])
      expect(
        await call(
          "find_nearby_places",
          { origin: { type: "device_location" } },
          { ...ctx, map: { authorizedLocation: bad } },
        ),
      ).toMatchObject({ error: { code: "LOCATION_REQUIRED" } });
    expect(
      await call(
        "find_nearby_places",
        { origin: { type: "device_location" } },
        {
          ...ctx,
          map: { authorizedLocation: { ...grant, coordinate: [0, 0] } },
        },
      ),
    ).toMatchObject({ error: { code: "OUT_OF_CAMPUS" } });
  });
  it("plans real South 7 → library through the approved tunnel", async () => {
    const { call } = setup();
    const result = await call("plan_route", routeInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = RouteOutputSchema.parse(result.data);
    expect(route.crossesZones).toBe(true);
    expect(route.usesTunnel).toBe(true);
    expect(route.undergroundPaths).toHaveLength(1);
    expect(
      route.steps.some((step) => step.instruction.includes("下沉隧道")),
    ).toBe(true);
    expect(route.distanceMeters).toBeGreaterThan(500);
    expect(route.estimatedSeconds).toBeCloseTo(route.distanceMeters / 1.25, 8);
    expect(route.mapVersion).toBe(MAP_VERSIONS.mapVersion);
    expect(route.networkVersion).toBe(MAP_VERSIONS.networkVersion);
    const geometricLength = route.path.coordinates
      .slice(1)
      .reduce(
        (sum, p, i) => sum + distanceMeters(route.path.coordinates[i], p),
        0,
      );
    expect(Math.abs(geometricLength - route.distanceMeters)).toBeLessThan(1);
    expect(
      await call("control_map", {
        actions: [{ type: "SHOW_ROUTE", routeId: route.routeId }],
      }),
    ).toMatchObject({ ok: true });
  });
  it("propagates an unavailable planner result without inventing fallback geometry (injected failure)", async () => {
    const spy = vi.spyOn(localRouting, "planLocalRoute").mockReturnValue(null);
    try {
      expect(await setup().call("plan_route", routeInput)).toMatchObject({
        ok: false,
        error: { code: "ROUTE_UNAVAILABLE" },
      });
    } finally {
      spy.mockRestore();
    }
  });
  it("preserves teaching B → laboratory C shortcut and same-zone living routes", async () => {
    const { service } = setup();
    const teaching = service.search({ query: "教学楼B栋" }, ctx).matches[0],
      lab = service.search({ query: "实验楼C栋" }, ctx).matches[0];
    const route = await service.plan(
      {
        start: { type: "place", placeId: teaching.placeId },
        endPlaceId: lab.placeId,
        mode: "walking",
      },
      ctx,
    );
    expect(route.distanceMeters).toBeLessThan(400);
    expect(route.steps.some((s) => s.instruction.includes("语心桥"))).toBe(
      true,
    );
    expect(route.usesTunnel).toBe(false);
    const canteen = service.search({ query: "文采园" }, ctx).matches[0];
    expect(
      (await service.plan({ ...routeInput, endPlaceId: canteen.placeId }, ctx))
        .crossesZones,
    ).toBe(false);
  });
  it("reuses the existing dashed device approach without turning it into a road", async () => {
    const { service } = setup();
    const grant = {
      coordinate: campusData.places.find((p) => p.id === dorm)!.coordinate,
      accuracyMeters: 20,
      capturedAt: now,
      expiresAt: now + 30000,
      consent: "browser_geolocation" as const,
    };
    const route = await service.plan(
      { ...routeInput, start: { type: "device_location" } },
      { ...ctx, map: { authorizedLocation: grant } },
    );
    expect(route.start.source).toBe("authorized_device_location");
    expect(route.approachPath?.coordinates).toHaveLength(2);
    expect(route.path.coordinates[0][0]).toBeCloseTo(grant.coordinate[0], 5);
    expect(route.steps[0].instruction).toBe("前往最近步道");
    expect(route.usesTunnel).toBe(true);
  });
  it.each([
    ["get_place_details", { placeId: "fake" }, "NOT_FOUND"],
    ["search_places", { query: "", limit: 500 }, "INVALID_ARGUMENT"],
    ["plan_route", { ...routeInput, mode: "driving" }, "INVALID_ARGUMENT"],
    ["plan_route", { ...routeInput, endPlaceId: "fake" }, "NOT_FOUND"],
    ["plan_route", { ...routeInput, endPlaceId: dorm }, "INVALID_ARGUMENT"],
    [
      "plan_route",
      { ...routeInput, preferences: { accessible: true } },
      "INSUFFICIENT_DATA",
    ],
    ["eval_js", { code: "alert(1)" }, "NOT_FOUND"],
  ])(
    "rejects %s invalid input or unavailable data",
    async (name, input, code) => {
      expect(await setup().call(name, input)).toMatchObject({
        ok: false,
        error: { code },
      });
    },
  );
  it("validates all map actions atomically and only emits intent", async () => {
    const { call } = setup();
    expect(
      await call("control_map", {
        actions: [
          { type: "FOCUS_PLACE", placeId: dorm },
          { type: "SHOW_PLACE_DETAILS", placeId: dorm },
          { type: "SET_VIEW_MODE", mode: "3d" },
          { type: "CLEAR_ROUTE" },
        ],
      }),
    ).toMatchObject({ ok: true, data: { execution: "intent_only" } });
    for (const action of [
      { type: "FOCUS_PLACE", placeId: "fake" },
      { type: "SHOW_ROUTE", routeId: crypto.randomUUID() },
      { type: "SET_VIEW_MODE", mode: "4d" },
      { type: "EVAL", code: "x" },
      { type: "SET_LAYER", layer: "moments", visible: true },
    ])
      expect(
        (
          await call("control_map", {
            actions: [{ type: "FOCUS_PLACE", placeId: dorm }, action],
          })
        ).ok,
      ).toBe(false);
    expect(
      MapActionSchema.safeParse({
        type: "FOCUS_PLACE",
        placeId: dorm,
        coordinate: [0, 0],
      }).success,
    ).toBe(false);
    expect(
      ControlMapOutputSchema.safeParse({
        acceptedActions: [],
        execution: "executed",
        mapVersion: "test-only",
      }).success,
    ).toBe(false);
  });
  it("rejects route access by another session, expiry and a different map version", async () => {
    let clock = now;
    const store = new MemoryRouteSnapshotStore(() => clock);
    const service = new CampusMapService(store, () => clock);
    const route = await service.plan(routeInput, ctx);
    await expect(
      store.get("other", route.routeId, MAP_VERSIONS),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.get(ctx.sessionId, route.routeId, {
        ...MAP_VERSIONS,
        mapVersion: "old-test",
      }),
    ).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    const copy = await store.get(ctx.sessionId, route.routeId, MAP_VERSIONS);
    copy.distanceMeters = 1;
    expect(
      (await store.get(ctx.sessionId, route.routeId, MAP_VERSIONS))
        .distanceMeters,
    ).toBe(route.distanceMeters);
    clock += 600001;
    await expect(
      store.get(ctx.sessionId, route.routeId, MAP_VERSIONS),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("uses opaque server-owned sessions instead of trusting a cookie identity", () => {
    const vault = new MapSessionVault(() => now);
    const forged = vault.resolve(
      new Request("https://example.invalid", {
        headers: { Cookie: "campusos_map_session=admin; userId=admin" },
      }),
    );
    expect(forged.context.user).toBeNull();
    expect(forged.context.sessionId).not.toBe("admin");
    const reused = vault.resolve(
      new Request("https://example.invalid", {
        headers: { Cookie: forged.cookie.split(";")[0] },
      }),
    );
    expect(reused.context.sessionId).toBe(forged.context.sessionId);
    expect(forged.cookie).toContain("HttpOnly; SameSite=Strict");
  });
  it.each([
    ["get_place_details", '{"placeId":"fake"}', "NOT_FOUND"],
    ["run_sql", "{}", "FORBIDDEN"],
  ])(
    "stops map Agent tool failure %s before another invented model answer",
    async (name, argumentsJson, code) => {
      const provider = new MockModelProvider([
        {
          content: "",
          toolCalls: [
            {
              id: "test-call",
              type: "function",
              function: {
                name,
                arguments: argumentsJson,
              },
            },
          ],
          finishReason: "tool_calls",
        },
        { content: "虚构成功", toolCalls: [], finishReason: "stop" },
      ]);
      const events: AgentEvent[] = [];
      const resolver = {
        resolve: async () => ({
          client: provider,
          snapshot: {
            source: "platform" as const,
            provider: "deepseek" as const,
            model: "test-only",
            policyVersion: "test-only",
            testedAt: new Date(now).toISOString(),
            capabilities: {
              toolCalling: true as const,
              jsonObject: true as const,
              strictJsonSchema: false as const,
            },
          },
        }),
      };
      const result = await createMapAgent(
        setup().service,
        resolver,
      ).orchestrator.run({
        message: "test",
        context: ctx,
        onEvent: (e) => events.push(e),
      });
      expect(result.status).toBe("failed");
      expect(result).toMatchObject({ code });
      expect(provider.requests).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain("虚构成功");
    },
  );
  it("does not perform network calls to plan local routes", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await setup().service.plan(routeInput, ctx);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
