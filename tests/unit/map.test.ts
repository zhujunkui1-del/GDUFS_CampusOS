import { describe, expect, it } from "vitest";
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
import { buildAMapTarget } from "@/lib/server/amap-proxy";

describe("licensed campus geometry and search", () => {
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
      expect(
        pointInPolygon(
          place.coordinate,
          campusData.zones.find((z) => z.id === place.zone)!.polygon,
        ),
      ).toBe(true);
      expect(place.sourceUrl).toMatch(
        /^https:\/\/www\.openstreetmap\.org\/(way|node)\/\d+$/,
      );
      expect(place.navigationVerified).toBe(false);
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
    ).toHaveLength(12);
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
