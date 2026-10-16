import { describe, expect, it } from "vitest";
import {
  campusData,
  searchCampusPlaces,
} from "@/features/campus-map/data/campus";
import raw from "@/features/campus-map/data/campus.json";
import review from "@/features/campus-map/data/owner-sports-label-review.json";

describe("owner-reviewed sports labels", () => {
  it("uses the exact six selected anchors and keeps two separate basketball clusters", () => {
    expect(searchCampusPlaces("篮球场").map((p) => p.id)).toEqual([
      "osm-way-1389859426",
      "osm-way-1389859443",
    ]);
    for (const group of review.groups) {
      const members = campusData.places.filter((p) =>
        group.memberIds.includes(p.id),
      );
      expect(members).toHaveLength(group.memberIds.length);
      expect(members.every((p) => p.labelPlaceId === group.anchorId)).toBe(
        true,
      );
      expect(
        searchCampusPlaces("")
          .filter((p) => group.memberIds.includes(p.id))
          .map((p) => p.id),
      ).toEqual([group.anchorId]);
    }
  });
  it("removes all four unverified labels from public lookup", () => {
    expect(searchCampusPlaces("类型待核验")).toEqual([]);
    expect(
      campusData.places
        .filter((p) => p.hiddenLabel)
        .map((p) => p.id)
        .sort(),
    ).toEqual([...review.hiddenLabelIds].sort());
  });
  it("renames both swimming places while preserving the old searchable name", () => {
    expect(
      campusData.places
        .filter((p) => p.category === "swimming")
        .every((p) => p.name === "游泳馆"),
    ).toBe(true);
    expect(searchCampusPlaces("游泳场地").map((p) => p.id)).toEqual([
      "osm-way-1389859438",
    ]);
  });
  it("preserves every source ID, coordinate, geometry and map version", () => {
    expect(campusData.mapVersion).toBe(raw.mapVersion);
    expect(campusData.places).toHaveLength(raw.places.length);
    for (let i = 0; i < raw.places.length; i++) {
      expect(campusData.places[i].id).toBe(raw.places[i].id);
      expect(campusData.places[i].coordinate).toEqual(raw.places[i].coordinate);
      expect(campusData.places[i].geometry).toEqual(
        "geometry" in raw.places[i] ? raw.places[i].geometry : undefined,
      );
    }
  });
});
