import { afterEach, describe, expect, it, vi } from "vitest";
import {
  campusData,
  searchCampusPlaces,
} from "@/features/campus-map/data/campus";
import {
  pointInPolygon,
  distanceMeters,
} from "@/features/campus-map/data/geometry";
import {
  planVerifiedRoute,
  type WalkingGraph,
} from "@/domain/maps/route-graph";
import { buildAMapTarget, proxyAMap } from "@/lib/server/amap-proxy";
import {
  campusViewport,
  CAMPUS_MIN_ZOOM,
  fitCampusView,
} from "@/features/campus-map/data/viewport";
import { nearestTunnelDistance } from "@/features/campus-map/data/local-routing";
import { projectOnPath } from "@/features/campus-map/data/route-progress";
import ownerPoints from "@/features/campus-map/data/owner-poi-review.json";
vi.mock("@/lib/server/map-env", () => ({
  mapRuntime: () => ({
    env: {
      APP_ENV: "local",
      AMAP_WEB_KEY: "test-published-js-key",
      AMAP_SECURITY_JS_CODE: "test-server-security-code",
    },
    limiter: undefined,
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("licensed campus geometry and search", () => {
  it("limits context to the two campus zones and a small margin without changing geography", () => {
    const input = campusData.zones.flatMap((z) => z.polygon);
    const original = JSON.stringify(input);
    const viewport = campusViewport(input);
    expect(viewport.ring[0]).toEqual(viewport.ring.at(-1));
    expect(JSON.stringify(input)).toBe(original);
    expect(viewport.northeast[0] - viewport.southwest[0]).toBeLessThan(0.014);
    expect(viewport.northeast[1] - viewport.southwest[1]).toBeLessThan(0.02);
    expect(CAMPUS_MIN_ZOOM).toBeGreaterThanOrEqual(15);
    expect(pointInPolygon([113.29, 23.2], viewport.ring)).toBe(false);
    for (const point of input)
      expect(pointInPolygon(point, viewport.ring)).toBe(true);
  });
  it("fits campus-sized initial views after the viewport dimensions are known", () => {
    const points = campusData.zones.flatMap((z) => z.polygon);
    const desktop = fitCampusView(
      points,
      { width: 1440, height: 900 },
      [40, 40, 110, 70],
    );
    const mobile = fitCampusView(
      points,
      { width: 390, height: 844 },
      [170, 150, 30, 60],
    );
    expect(desktop.zoom).toBeGreaterThan(15.5);
    expect(mobile.zoom).toBeGreaterThanOrEqual(CAMPUS_MIN_ZOOM);
    expect(desktop.zoom).toBeLessThan(17);
    expect(pointInPolygon(desktop.center, campusViewport(points).ring)).toBe(
      true,
    );
  });
  it("covers both zones with closed WGS84 geometry and distinct IDs", () => {
    expect(new Set(campusData.zones.map((z) => z.id))).toEqual(
      new Set(["teaching", "living"]),
    );
    for (const zone of campusData.zones)
      expect(zone.polygon[0]).toEqual(zone.polygon.at(-1));
    expect(new Set(campusData.places.map((p) => p.id)).size).toBe(
      campusData.places.length,
    );
    for (const place of campusData.places) {
      const isInsideBoundary =
        place.zone === "connection"
          ? place.id === "osm-way-864205124" &&
            nearestTunnelDistance(place.coordinate) < 1
          : pointInPolygon(
              place.coordinate,
              campusData.zones.find((z) => z.id === place.zone)!.polygon,
            );
      const reviewedBoundaryGate =
        place.category === "entrance" &&
        ownerPoints.points.some(
          (p) => p.id === place.id && p.category === "entrance",
        );
      if (!isInsideBoundary && reviewedBoundaryGate) {
        // Owner gate anchors lie on either side of the unchanged OSM boundary.
        const boundary = campusData.zones.find(
          (z) => z.id === place.zone,
        )!.polygon;
        expect(
          projectOnPath(place.coordinate, boundary).distance,
          place.id,
        ).toBeLessThan(10);
      } else expect(isInsideBoundary, place.id).toBe(true);
      if (place.id.startsWith("osm-"))
        expect(place.sourceUrl).toMatch(
          /^https:\/\/www\.openstreetmap\.org\/(way|node|relation)\/\d+$/,
        );
      else
        expect(place.sourceUrl).toMatch(
          /^https:\/\/www\.openstreetmap\.org\/#map=/,
        );
      if (place.verification === "source_mapped")
        expect(place.navigationVerified).toBe(
          [
            "osm-way-864205124",
            "osm-node-6110327053",
            "osm-node-6110327054",
          ].includes(place.id),
        );
    }
  });
  it("finds real mapped library and numbered dormitories without adding guessed names", () => {
    expect(
      searchCampusPlaces("图书馆").some((p) => p.id === "osm-way-307250998"),
    ).toBe(true);
    expect(searchCampusPlaces("北苑1栋").map((p) => p.name)).toEqual([
      "北苑1栋",
    ]);
    expect(
      campusData.places.filter((p) => p.category === "dormitory"),
    ).toHaveLength(18);
    expect(searchCampusPlaces("师苑3栋")[0].id).toBe("osm-way-313039033");
    expect(searchCampusPlaces("师苑2栋")[0].id).toBe("osm-way-313039038");
    expect(searchCampusPlaces("南苑13栋")[0].id).toBe("osm-way-312536953");
    expect(searchCampusPlaces("一饭")[0].name).toBe("文采园（一饭）");
    expect(searchCampusPlaces("不存在的第99栋宿舍")).toEqual([]);
  });
  it("keeps outside locations out and computes geographic distances", () => {
    expect(
      campusData.zones.some((z) => pointInPolygon([113.29, 23.2], z.polygon)),
    ).toBe(false);
    expect(distanceMeters([0, 0], [0, 0.001])).toBeCloseTo(111.195, 2);
  });
});

describe("AMap security proxy policy", () => {
  const key = "test-published-js-key",
    secret = "test-server-security-code";
  const request = (path: string) =>
    new Request(`https://campus.test/_AMapService/${path}`);
  it("only constructs fixed HTTPS AMap targets and injects server security", () => {
    const target = buildAMapTarget(
      request(
        `v3/place/text?key=${key}&keywords=library&s=rsv3&platform=JS&jscode=attacker&url=http://127.0.0.1`,
      ),
      ["v3", "place", "text"],
      key,
      secret,
    );
    expect(target.origin).toBe("https://restapi.amap.com");
    expect(target.searchParams.get("jscode")).toBe(secret);
    expect(target.searchParams.get("url")).toBeNull();
    expect(target.searchParams.get("s")).toBe("rsv3");
  });
  it("rejects unknown targets, foreign keys and executable JSONP callbacks", () => {
    expect(() =>
      buildAMapTarget(
        request(`v3/private/admin?key=${key}`),
        ["v3", "private", "admin"],
        key,
        secret,
      ),
    ).toThrow();
    expect(() =>
      buildAMapTarget(
        request("v3/place/text?key=foreign"),
        ["v3", "place", "text"],
        key,
        secret,
      ),
    ).toThrow();
    expect(() =>
      buildAMapTarget(
        request(`v3/place/text?key=${key}&callback=alert(1)`),
        ["v3", "place", "text"],
        key,
        secret,
      ),
    ).toThrow();
  });
});

describe("proxy requests and secret-safe failures", () => {
  const request = () =>
    new Request(
      "https://campus.test/_AMapService/v3/place/text?key=test-published-js-key&keywords=library",
      { headers: { referer: "https://campus.test/map" } },
    );
  it("uses Workers-compatible manual redirect handling and rejects 3xx", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/" },
      }),
    );
    vi.stubGlobal("fetch", upstream);
    await expect(
      proxyAMap(request(), ["v3", "place", "text"]),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(upstream.mock.calls[0][1].redirect).toBe("manual");
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("does not forward a reflected security code to the browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          status: "1",
          reflected: "test-server-security-code",
        }),
      ),
    );
    await expect(
      proxyAMap(request(), ["v3", "place", "text"]),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
  it("redacts credentials and upstream URLs from network diagnostics", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error(
            "failed https://restapi.amap.com/v3/place/text?jscode=test-server-security-code key=test-published-js-key",
          ),
        ),
    );
    await expect(
      proxyAMap(request(), ["v3", "place", "text"]),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "test-server-security-code",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "test-published-js-key",
    );
  });
});

describe("reviewed walking graph (isolated fixtures)", () => {
  const graph: WalkingGraph = {
    version: "test-fixture-not-campus",
    nodes: [
      { id: "a", coordinate: [0, 0] },
      { id: "b", coordinate: [0, 0.001] },
      { id: "c", coordinate: [0.001, 0.001] },
    ],
    edges: [
      {
        id: "ab",
        from: "a",
        to: "b",
        geometry: [
          [0, 0],
          [0, 0.0005],
          [0, 0.001],
        ],
        verified: true,
        level: "ground",
        sourceUrl: "https://example.invalid/test-fixture",
        bidirectional: true,
      },
      {
        id: "bc",
        from: "b",
        to: "c",
        geometry: [
          [0, 0.001],
          [0.001, 0.001],
        ],
        verified: true,
        level: "underground",
        sourceUrl: "https://example.invalid/test-fixture",
        bidirectional: true,
      },
    ],
  };
  it("uses road geometry, network versions and underground segments", () => {
    const result = planVerifiedRoute(graph, "a", "c");
    expect(result?.nodeIds).toEqual(["a", "b", "c"]);
    expect(result?.coordinates).toHaveLength(4);
    expect(result?.undergroundEdgeIds).toEqual(["bc"]);
    expect(result?.distanceMeters).toBeCloseTo(222.39, 1);
  });
  it("does not route over unreviewed or disconnected roads or invent a straight line", () => {
    expect(
      planVerifiedRoute(
        {
          ...graph,
          edges: graph.edges.map((e) => ({ ...e, verified: false })),
        },
        "a",
        "c",
      ),
    ).toBeNull();
    expect(
      planVerifiedRoute({ ...graph, edges: [graph.edges[0]] }, "a", "c"),
    ).toBeNull();
    expect(planVerifiedRoute(graph, "unknown", "c")).toBeNull();
  });
  it("supports reversed roads but respects one-way and invalid geometry", () => {
    expect(planVerifiedRoute(graph, "c", "a")?.nodeIds).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(
      planVerifiedRoute(
        {
          ...graph,
          edges: graph.edges.map((e) => ({ ...e, bidirectional: false })),
        },
        "c",
        "a",
      ),
    ).toBeNull();
    expect(
      planVerifiedRoute(
        { ...graph, edges: graph.edges.map((e) => ({ ...e, geometry: [] })) },
        "a",
        "c",
      ),
    ).toBeNull();
  });
});
