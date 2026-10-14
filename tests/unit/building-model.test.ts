import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Box3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  modelPilot,
  modelPilotAvailable,
  pilotVolume,
} from "@/features/campus-map/data/model-pilot";
import {
  campusData,
  CoordinateSchema,
} from "@/features/campus-map/data/campus";
import { pointInPolygon } from "@/features/campus-map/data/geometry";
import mapManifest from "@/features/campus-map/data/local-map-manifest.json";
import review from "@/features/campus-map/data/owner-model-review.json";

describe("single owner-reviewed dormitory model", () => {
  it("binds only South 7 to the immutable map and approximate owner height", () => {
    expect(modelPilotAvailable).toBe(true);
    expect(modelPilot.placeId).toBe("osm-way-312536955");
    expect(modelPilot.mapVersion).toBe(mapManifest.version);
    expect(modelPilot.levels).toBe(7);
    expect(modelPilot.heightMeters).toBe(21);
    expect(review.heightAccuracy).toBe("owner_approximation");
    const place = campusData.places.find((p) => p.id === modelPilot.placeId)!;
    expect(pilotVolume().geometry.coordinates[0]).toEqual(place.geometry);
    expect(modelPilot.footprintSha256).toBe(
      createHash("sha256").update(JSON.stringify(place.geometry)).digest("hex"),
    );
  });
  it("keeps the display-only courtyard inside the real exterior", () => {
    const outer = modelPilot.geometry.coordinates[0].map((p) =>
      CoordinateSchema.parse(p),
    );
    const hole = modelPilot.geometry.coordinates[1].map((p) =>
      CoordinateSchema.parse(p),
    );
    expect(hole[0]).toEqual(hole.at(-1));
    expect(hole.every((p) => pointInPolygon(p, outer))).toBe(true);
    expect(modelPilot.courtyardAccuracy).toBe("visual_approximation");
  });
  for (const lod of ["low", "full"] as const) {
    it(`ships a self-contained ${lod} GLB within the phone pilot budget`, async () => {
      const asset = modelPilot.assets[lod];
      const binary = readFileSync("public" + asset.url);
      expect(binary.length).toBe(asset.bytes);
      expect(binary.length).toBeLessThan(200 * 1024);
      expect(createHash("sha256").update(binary).digest("hex")).toBe(
        asset.sha256,
      );
      expect(binary.subarray(0, 4).toString()).toBe("glTF");
      const json = JSON.parse(
        binary.subarray(20, 20 + binary.readUInt32LE(12)).toString(),
      );
      expect(json.images || []).toHaveLength(0);
      expect(json.buffers.every((b: { uri?: string }) => !b.uri)).toBe(true);
      expect(asset.triangles).toBeLessThan(30000);
      expect(asset.drawCalls).toBeLessThan(20);
      const arrayBuffer = new Uint8Array(binary).buffer;
      const gltf = await new GLTFLoader().parseAsync(arrayBuffer, "");
      const size = new Box3()
        .setFromObject(gltf.scene)
        .getSize(new (await import("three")).Vector3());
      expect(size.y).toBeCloseTo(21, 3);
      expect(size.x).toBeCloseTo(modelPilot.dimensionsMeters[0], 0);
      expect(size.z).toBeCloseTo(modelPilot.dimensionsMeters[2], 0);
    });
  }
});
