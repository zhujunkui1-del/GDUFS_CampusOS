import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import manifest from "@/features/campus-map/data/local-map-manifest.json";
import { viewportFootprint } from "@/features/campus-map/data/local-viewport";
import {
  toGcj02,
  toWgs84,
} from "@/features/campus-map/adapters/online-services";
import { distanceMeters } from "@/features/campus-map/data/geometry";
import {
  campusData,
  searchCampusPlaces,
} from "@/features/campus-map/data/campus";
describe("fixed local map and service coordinates", () => {
  it("keeps named multipolygon buildings and their courtyard holes", () => {
    expect(searchCampusPlaces("学术交流中心")[0].id).toBe(
      "osm-relation-4105910",
    );
    for (const id of [
      "4105730",
      "4105910",
      "4105911",
      "19299170",
      "19299171",
    ]) {
      const place = campusData.places.find(
        (p) => p.id === `osm-relation-${id}`,
      )!;
      expect(place.geometryRings!.length).toBeGreaterThan(1);
      for (const ring of place.geometryRings!)
        expect(ring[0]).toEqual(ring.at(-1));
      expect(place.navigationVerified).toBe(false);
    }
  });
  it("ships the exact declared snapshot without supplier tiles or contributor identities", () => {
    const file = readFileSync(`public${manifest.url}`);
    expect(createHash("sha256").update(file).digest("hex")).toBe(
      manifest.sha256,
    );
    expect(file.length).toBe(manifest.bytes);
    const data = JSON.parse(file.toString("utf8"));
    expect(data.features.length).toBe(manifest.features);
    expect(file.toString("utf8")).not.toMatch(/amap\.com|"uid":|"user":/);
    expect(manifest.updates).toBe("manual only");
  });
  it("reserves enough ground extent as perspective and rotation increase", () => {
    const flat = viewportFootprint(1440, 900, 0, 0);
    expect(flat).toEqual({ width: 1440, height: 900 });
    expect(viewportFootprint(1440, 900, 38, 0).width).toBeGreaterThan(
      flat.width,
    );
    expect(viewportFootprint(1440, 900, 0, 90).height).toBeCloseTo(1440);
  });
  it("aligns online GCJ02 results with the WGS84 local snapshot", () => {
    const library: [number, number] = [113.39131405, 23.0680465];
    // Previously measured through the official coordinate API, not a personal location.
    expect(
      distanceMeters(toGcj02(library), [113.39683648, 23.06552762]),
    ).toBeLessThan(5);
    expect(distanceMeters(toWgs84(toGcj02(library)), library)).toBeLessThan(1);
  });
});
