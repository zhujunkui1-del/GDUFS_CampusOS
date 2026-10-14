import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Box3, Matrix4, Mesh, Vector3, Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  createDormitoryBatch,
  disposeDormitoryBatch,
} from "@/features/campus-map/layers/dormitory-batch";

describe("shared dormitory rendering batches", () => {
  it("preserves the accepted template bounds and buffers while batching placements", async () => {
    const binary = readFileSync(
      "public/models/nanyuan7/nanyuan7-v2-54cc55342ae5.glb",
    );
    const template = (
      await new GLTFLoader().parseAsync(new Uint8Array(binary).buffer, "")
    ).scene;
    const placements = Array.from({ length: 30 }, (_, i) =>
      new Matrix4().makeTranslation(i * 90, 0, 0),
    );
    const baseline = new Group();
    for (const placement of placements) {
      const root = template.clone(true);
      root.applyMatrix4(placement);
      baseline.add(root);
    }
    const batch = createDormitoryBatch(template, placements, 10);
    expect(batch.children).toHaveLength(3);
    const expected = new Box3().setFromObject(baseline),
      actual = new Box3().setFromObject(batch);
    expect(actual.min.distanceTo(expected.min)).toBeLessThan(0.001);
    expect(actual.max.distanceTo(expected.max)).toBeLessThan(0.001);
    const originals: Mesh[] = [];
    template.traverse((node) => {
      if (node instanceof Mesh) originals.push(node);
    });
    let draws = 0;
    batch.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      draws++;
      expect(
        originals.some(
          (source) =>
            source.geometry === node.geometry &&
            source.material === node.material,
        ),
      ).toBe(true);
    });
    expect(draws).toBe(21);
    const before = new Box3().setFromObject(template).getSize(new Vector3());
    disposeDormitoryBatch(batch);
    expect(batch.children).toHaveLength(0);
    expect(
      new Box3().setFromObject(template).getSize(new Vector3()).equals(before),
    ).toBe(true);
  });
  it("rejects invalid group sizes", () => {
    expect(() => createDormitoryBatch(new Group(), [], 0)).toThrow(
      "Invalid batch size",
    );
  });
});
