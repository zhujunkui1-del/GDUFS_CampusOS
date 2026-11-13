import { afterEach, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from "three";
import { CampusBuildingModelLayer } from "@/features/campus-map/layers/campus-building-model-layer";
import { buildingModelCatalog } from "@/features/campus-map/data/building-models";
import type { Map as LibreMap } from "maplibre-gl";

const renderers = vi.hoisted(
  () =>
    [] as Array<{
      shadowMap: {
        enabled: boolean;
        autoUpdate: boolean;
        needsUpdate: boolean;
      };
    }>,
);
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      autoClear = true;
      shadowMap = { enabled: false, autoUpdate: true, needsUpdate: false };
      capabilities = { maxTextureSize: 8192 };
      constructor() {
        renderers.push(this);
      }
      dispose() {}
    },
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  renderers.length = 0;
});
function setup() {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const element = { dataset: { renderProfile: "standard" }, clientWidth: 1280 };
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const map = {
    getContainer: () => element,
    getCanvas: () => canvas,
    triggerRepaint: vi.fn(),
  } as unknown as LibreMap;
  const layer = new CampusBuildingModelLayer(vi.fn());
  Reflect.set(layer, "pump", () => undefined);
  layer.onAdd(map, {
    getParameter: () => 8192,
    MAX_TEXTURE_SIZE: 3379,
  } as unknown as WebGL2RenderingContext);
  return { layer, map };
}
it("uses one cached ground-shadow setup for the complete campus scene", () => {
  const { layer } = setup();
  try {
    const scene = Reflect.get(layer, "scene") as Scene;
    expect(renderers[0].shadowMap.enabled).toBe(true);
    expect(renderers[0].shadowMap.autoUpdate).toBe(false);
    expect(
      scene.children.find((n) => n instanceof DirectionalLight)?.castShadow,
    ).toBe(true);
    expect(scene.getObjectByName("campus-model-shadow")?.receiveShadow).toBe(
      true,
    );
  } finally {
    layer.onRemove();
  }
});
it("keeps South 7 in the same 3D scene as the other approved models", () => {
  const { layer } = setup();
  try {
    layer.setMode("3d");
    const wanted = Reflect.get(layer, "wanted") as Map<string, string>;
    expect(wanted.get("dormitory-s7")).toBe("3d");
    expect(wanted.size).toBe(buildingModelCatalog.entries.length);
  } finally {
    layer.onRemove();
  }
});
it("preserves shadow participation when preparing actual model batches", () => {
  const { layer } = setup();
  try {
    const wrapper = new Group(),
      wall = new MeshStandardMaterial({ color: "white" }),
      glass = new MeshStandardMaterial({ color: "blue" });
    wall.name = "ivory";
    glass.name = "glass";
    wrapper.add(
      new Mesh(new BoxGeometry(10, 20, 10), wall),
      new Mesh(new BoxGeometry(1, 1, 1), glass),
    );
    wrapper.updateMatrixWorld(true);
    const item = {
      entry: buildingModelCatalog.entries.find(
        (e) => e.key === "dormitory-s8",
      )!,
      mode: "3d",
      wrapper,
      materials: new Map(),
    };
    const batch = Reflect.apply(Reflect.get(layer, "prepareBatches"), layer, [
      item,
      "dormitory-s8",
    ]) as Group;
    const meshes = batch.children.filter((n) => n instanceof Mesh);
    expect(meshes.find((n) => n.material === wall)?.castShadow).toBe(true);
    expect(meshes.find((n) => n.material === wall)?.receiveShadow).toBe(true);
    expect(meshes.find((n) => n.material === glass)?.castShadow).toBe(false);
  } finally {
    layer.onRemove();
  }
});
