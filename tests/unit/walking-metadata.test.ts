import { describe, expect, it } from "vitest";
import metadata from "@/lib/server/maps/public-walking-attachments.json";
import { campusData } from "@/features/campus-map/data/campus";
import { toGcj02 } from "@/features/campus-map/adapters/online-services";
import {
  loadPublicWalkingAttachments,
  publicWalkingAttachments,
  planLocalRoute,
} from "@/features/campus-map/data/local-routing";
import type { RoutePoint } from "@/features/campus-map/adapters/amap-adapter";
describe("offline public walking metadata", () => {
  it("rejects stale map/network versions before installing any entries", () => {
    const before = publicWalkingAttachments();
    expect(() =>
      loadPublicWalkingAttachments({
        ...metadata,
        mapVersion: "stale",
      }),
    ).toThrow();
    expect(() =>
      loadPublicWalkingAttachments({
        ...metadata,
        networkVersion: "stale",
      }),
    ).toThrow();
    expect(publicWalkingAttachments()).toEqual(before);
  });
  it("uses the same exact public route and keeps device coordinates out of shared metadata", () => {
    const point = (id: string): RoutePoint => {
      const place = campusData.places.find((p) => p.id === id)!;
      return {
        name: place.name,
        placeId: id,
        source: "campus_place",
        zone: place.zone,
        coordinateGcj02: toGcj02(place.coordinate),
      };
    };
    const start = point("osm-way-312536955"),
      end = point("osm-way-307250998");
    const before = planLocalRoute(start, end)!;
    loadPublicWalkingAttachments(metadata);
    const after = planLocalRoute(start, end)!;
    expect({ ...after, id: null }).toEqual({ ...before, id: null });
    const snapshot = publicWalkingAttachments();
    planLocalRoute(
      { ...start, placeId: undefined, source: "device_location" },
      end,
    );
    expect(publicWalkingAttachments()).toEqual(snapshot);
    expect(Object.keys(snapshot.entries)).toHaveLength(113);
    expect(
      Object.keys(snapshot.entries).every((key) =>
        campusData.places.some((place) => key === "campus_place:" + place.id),
      ),
    ).toBe(true);
  });
});
