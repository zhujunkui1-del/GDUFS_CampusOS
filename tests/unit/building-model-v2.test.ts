import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Box3, Vector3, InstancedMesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import v2 from "../../docs/model-previews/nanyuan7-v2/manifest.json";
import design from "../../docs/model-previews/nanyuan7-v2/design.json";
import active from "@/features/campus-map/data/nanyuan7-model.json";
import { campusData } from "@/features/campus-map/data/campus";
import legacy from "../../docs/model-previews/nanyuan7-v1/manifest.json";
import review from "@/features/campus-map/data/owner-model-review.json";

describe("standalone photo-informed second draft", () => {
  it("promotes only the approved V2 asset and retains the exact V1 2.5D volume", () => {
    expect(v2.mapIntegrated).toBe(false);
    expect(v2.stage).toBe("standalone_review_only");
    expect(active.modelVersion).toBe(v2.modelVersion);
    expect(active.volumeVersion).toBe(legacy.modelVersion);
    expect(active.geometry).toEqual(legacy.geometry);
    expect(active.courtyardGeometry).toEqual(legacy.courtyardGeometry);
    expect(active.origin).toEqual(legacy.origin);
    expect(active.dimensionsMeters).toEqual(legacy.dimensionsMeters);
    expect(active.heightMeters).toBe(legacy.heightMeters);
    expect(active.lodStrategy).toBe("shared_lightweight_v2");
    expect(active.assets.low).toEqual(active.assets.full);
    expect(active.assets.full.sha256).toBe(v2.asset.sha256);
    expect(review.model3D.approvedForMap).toBe(true);
    expect(review.model3D.assetSha256).toBe(v2.asset.sha256);
    expect(readFileSync("public" + active.assets.full.url)).toEqual(
      readFileSync("docs/model-previews/nanyuan7-v2/nanyuan7-v2.glb"),
    );
    const footprint = campusData.places.find(
      (p) => p.id === v2.placeId,
    )!.geometry;
    expect(
      createHash("sha256").update(JSON.stringify(footprint)).digest("hex"),
    ).toBe(v2.footprintSha256);
  });
  it("uses an inexpensive self-contained asset with no photo textures", () => {
    const binary = readFileSync(
      "docs/model-previews/nanyuan7-v2/" + v2.asset.url.slice(2),
    );
    expect(binary.length).toBe(v2.asset.bytes);
    expect(createHash("sha256").update(binary).digest("hex")).toBe(
      v2.asset.sha256,
    );
    expect(v2.asset.triangles).toBeLessThanOrEqual(
      design.performance.triangleBudget,
    );
    expect(v2.asset.drawCalls).toBeLessThanOrEqual(7);
    expect(v2.asset.materialCount).toBeLessThanOrEqual(5);
    expect(binary.length).toBeLessThan(100000);
    const json = JSON.parse(
      binary.subarray(20, 20 + binary.readUInt32LE(12)).toString(),
    );
    expect(json.images || []).toHaveLength(0);
    expect(json.buffers.every((buffer: { uri?: string }) => !buffer.uri)).toBe(
      true,
    );
  });
  it("retains seven physical floor slabs and approximately 21m total height", async () => {
    const binary = readFileSync(
      "docs/model-previews/nanyuan7-v2/" + v2.asset.url.slice(2),
    );
    const gltf = await new GLTFLoader().parseAsync(
      new Uint8Array(binary).buffer,
      "",
    );
    const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
    expect(size.y).toBeCloseTo(21, 3);
    let floors = 0;
    gltf.scene.traverse((node) => {
      if (
        node instanceof InstancedMesh &&
        node.name.startsWith("seven-floor-slabs")
      )
        floors = node.count;
    });
    expect(floors).toBe(7);
    expect(v2.heightAccuracy).toBe("owner_approximation");
  });
});
