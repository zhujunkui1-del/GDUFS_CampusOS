import {
  Camera,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
  Texture,
  PCFShadowMap,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  MercatorCoordinate,
  type Map as LibreMap,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
} from "maplibre-gl";
import {
  buildingModelCatalog,
  buildingModelForPlace,
  type BuildingModelEntry,
} from "../data/building-models";
import type { MapMode } from "@/domain/maps/contracts";
import { modelPilot, modelPilotAvailable } from "../data/model-pilot";
import { readModelAsset } from "./model-asset-cache";
import { modelBudget } from "../data/model-budget";
import {
  createCampusModelLighting,
  setCampusModelShadows,
} from "./campus-model-lighting";
type OwnerRange = { start: number; count: number; key: string };
type Loaded = {
  entry: BuildingModelEntry;
  mode: "2.5d" | "3d";
  wrapper: Group;
  batches?: Group;
  materials: Map<
    MeshStandardMaterial,
    { opacity: number; transparent: boolean; depthWrite: boolean }
  >;
};
function materialKey(m: Material) {
  if (!(m instanceof MeshStandardMaterial)) return m.uuid;
  return JSON.stringify([
    m.color.getHexString(),
    m.roughness,
    m.metalness,
    m.side,
    m.opacity,
    m.transparent,
    m.depthWrite,
    m.emissive.getHexString(),
    m.emissiveIntensity,
    m.flatShading,
    m.vertexColors,
    m.alphaTest,
    m.map?.uuid,
    m.normalMap?.uuid,
    m.roughnessMap?.uuid,
    m.metalnessMap?.uuid,
    m.emissiveMap?.uuid,
    m.aoMap?.uuid,
    m.alphaMap?.uuid,
  ]);
}
function primitiveKey(mesh: Mesh) {
  const g = mesh.geometry,
    p = g.attributes.position;
  if (p.count !== 4 && p.count !== 24) return g.uuid;
  return JSON.stringify([
    Array.from(p.array),
    g.index ? Array.from(g.index.array) : null,
  ]);
}

// Modes are user choices. Camera movement never replaces a loaded 3D model.
// The build validates the finite catalog budget; parsed batches are reused.
export class CampusBuildingModelLayer implements CustomLayerInterface {
  readonly id = "campus-building-models";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map?: LibreMap;
  private renderer?: WebGLRenderer;
  private scene = new Scene();
  private drawRoot = new Group();
  private camera = new Camera();
  private mode: MapMode = "2d";
  private selected?: string;
  private routeVisible = false;
  private disposed = false;
  private projectionReady = false;
  private loaded = new Map<string, Loaded>();
  private failed = new Set<string>();
  private criticalReported = new Set<string>();
  private pending = new Set<string>();
  private queue: Array<{ entry: BuildingModelEntry; mode: "2.5d" | "3d" }> = [];
  private workers = 0;
  private wanted = new Map<string, "2.5d" | "3d">();
  private frameSamples: number[] = [];
  private lastFrame = 0;
  private buildFrame = 0;
  private pilotNotification = "";
  private pilotActiveMode?: "2.5d" | "3d";
  private lighting?: ReturnType<typeof createCampusModelLighting>;
  private shadowSignature = "";
  private shadowUpdates = 0;
  private lost = false;
  private readonly contextLost = () => {
    this.lost = true;
    this.projectionReady = false;
  };
  private readonly contextRestored = () => {
    this.lost = false;
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    this.map?.triggerRepaint();
  };
  private origin = MercatorCoordinate.fromLngLat([
    buildingModelCatalog.referenceOrigin[0],
    buildingModelCatalog.referenceOrigin[1],
  ]);
  private units = this.origin.meterInMercatorCoordinateUnits();
  private localMatrix = new Matrix4()
    .makeTranslation(this.origin.x, this.origin.y, this.origin.z)
    .scale(new Vector3(this.units, -this.units, this.units))
    .multiply(new Matrix4().makeRotationX(Math.PI / 2));
  constructor(
    private onCriticalError: () => void,
    private onPilotVolumeChange?: () => void,
  ) {}
  get pilotVolumeReady() {
    return this.mode !== "2d" && this.pilotActiveMode === "2.5d";
  }
  get pilotDetailedReady() {
    return this.mode === "3d" && this.pilotActiveMode === "3d";
  }
  get pilotState() {
    if (this.mode !== "3d") return "idle";
    if (this.failed.has("dormitory-s7:3d")) return "error";
    return this.loaded.has("dormitory-s7:3d") ? "ready" : "loading";
  }
  retryFailed() {
    this.failed.clear();
    this.criticalReported.clear();
    this.reconcile();
  }
  onAdd(map: LibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.lighting = createCampusModelLighting(
      this.scene,
      this.origin,
      this.units,
      map.getContainer().dataset.renderProfile === "conservative"
        ? "conservative"
        : "standard",
      map.getContainer().clientWidth,
    );
    this.scene.add(this.drawRoot);
    map.getContainer().dataset.campusModelLighting = "shared-static-sun";
    map.getContainer().dataset.campusModelShadowMapSize = String(
      this.lighting.size,
    );
    map.getCanvas().addEventListener("webglcontextlost", this.contextLost);
    map
      .getCanvas()
      .addEventListener("webglcontextrestored", this.contextRestored);
    this.reconcile();
  }
  setMode(mode: MapMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.reconcile();
    this.map?.triggerRepaint();
  }
  setAppearance(selected: string | undefined, routeVisible: boolean) {
    if (this.selected === selected && this.routeVisible === routeVisible)
      return;
    this.selected = selected;
    this.routeVisible = routeVisible;
    this.reconcile();
  }
  private reconcile() {
    if (!this.map || this.disposed) return;
    const selected = buildingModelForPlace(this.selected),
      entries =
        this.mode === "2d"
          ? []
          : buildingModelCatalog.entries.filter(
              (e) => e.placeId !== modelPilot.placeId || modelPilotAvailable,
            );
    this.wanted.clear();
    for (const entry of entries) {
      const desired = this.mode === "3d" ? "3d" : "2.5d";
      const mode = this.failed.has(entry.key + ":" + desired)
        ? "2.5d"
        : desired;
      const id = entry.key + ":" + mode;
      this.wanted.set(entry.key, mode);
      if (
        !this.loaded.has(id) &&
        !this.failed.has(id) &&
        !this.pending.has(id)
      ) {
        this.pending.add(id);
        this.queue.push({ entry, mode });
      }
      if (
        this.failed.has(entry.key + ":2.5d") &&
        entry.key === selected?.key &&
        !this.loaded.has(entry.key + ":3d") &&
        !this.criticalReported.has(entry.key)
      ) {
        this.criticalReported.add(entry.key);
        queueMicrotask(() => {
          if (!this.disposed) this.onCriticalError();
        });
      }
    }
    this.map.getContainer().dataset.campusModelBudget = String(entries.length);
    this.pump();
    this.requestBuild();
  }
  private pump() {
    const concurrency = modelBudget(
      this.map?.getContainer().dataset.renderProfile === "conservative"
        ? "conservative"
        : "standard",
    ).concurrentLoads;
    while (this.workers < concurrency && this.queue.length) {
      const task = this.queue.shift()!,
        id = `${task.entry.key}:${task.mode}`;
      if (
        !this.wanted.has(task.entry.key) ||
        this.mode === "2d" ||
        this.wanted.get(task.entry.key) !== task.mode
      ) {
        this.pending.delete(id);
        continue;
      }
      this.workers++;
      void this.load(task.entry, task.mode).finally(() => {
        this.workers--;
        this.pending.delete(id);
        if (!this.disposed) {
          this.reconcile();
          this.pump();
        }
      });
    }
  }
  private async load(entry: BuildingModelEntry, mode: "2.5d" | "3d") {
    const id = `${entry.key}:${mode}`;
    try {
      const started = performance.now();
      const b = await readModelAsset(entry.assets[mode]);
      const fetched = performance.now();
      const gltf = await new GLTFLoader().parseAsync(b, "");
      if (this.map) {
        const data = this.map.getContainer().dataset;
        data.lastModelAsset = id;
        data.lastModelFetchMs = String(Math.round(fetched - started));
        data.lastModelParseMs = String(Math.round(performance.now() - fetched));
      }
      if (this.disposed) {
        this.disposeObjects(gltf.scene);
        return;
      }
      const wrapper = new Group(),
        o = MercatorCoordinate.fromLngLat([entry.origin[0], entry.origin[1]]),
        scale = o.meterInMercatorCoordinateUnits() / this.units;
      wrapper.position.set(
        (o.x - this.origin.x) / this.units,
        0,
        (o.y - this.origin.y) / this.units,
      );
      wrapper.scale.setScalar(scale);
      wrapper.add(gltf.scene);
      wrapper.updateMatrixWorld(true);
      const materials = new Map<
        MeshStandardMaterial,
        { opacity: number; transparent: boolean; depthWrite: boolean }
      >();
      wrapper.traverse((n) => {
        if (!(n instanceof Mesh)) return;
        for (const m of Array.isArray(n.material) ? n.material : [n.material])
          if (m instanceof MeshStandardMaterial)
            materials.set(m, {
              opacity: m.opacity,
              transparent: m.transparent,
              depthWrite: m.depthWrite,
            });
      });
      this.loaded.set(id, {
        entry,
        mode,
        wrapper,
        materials,
      });
    } catch (error) {
      this.failed.add(id);
      if (this.map)
        this.map.getContainer().dataset.modelFailure = JSON.stringify({
          asset: id,
          stage:
            error instanceof Error && error.message.startsWith("model-")
              ? error.message
              : "gltf-decode",
        });
    }
  }
  private requestBuild() {
    if (!this.buildFrame && !this.disposed)
      this.buildFrame = requestAnimationFrame(() => {
        this.buildFrame = 0;
        this.rebuild();
      });
  }
  private prepareBatches(item: Loaded, key: string) {
    if (item.batches) return item.batches;
    const group = new Group();
    const statics = new Map<
        string,
        {
          material: Material;
          geometries: Mesh["geometry"][];
          owners: OwnerRange[];
          faces: number;
        }
      >(),
      instances = new Map<
        string,
        {
          material: Material;
          geometry: Mesh["geometry"];
          matrices: Matrix4[];
          owners: OwnerRange[];
        }
      >();
    const bounds = item.entry.assets[item.mode].bounds,
      position = new Vector3(
        (bounds.min[0] + bounds.max[0]) / 2,
        0,
        (bounds.min[2] + bounds.max[2]) / 2,
      ).applyMatrix4(item.wrapper.matrixWorld),
      cell = `${Math.floor(position.x / 128)},${Math.floor(position.z / 128)}`;
    item.wrapper.traverse((node) => {
      if (!(node instanceof Mesh) || Array.isArray(node.material)) return;
      const mat = node.material,
        layout = Object.keys(node.geometry.attributes).map((name) => {
          const attribute = node.geometry.getAttribute(name);
          return [name, attribute.itemSize, attribute.normalized];
        }),
        mk = cell + ":" + materialKey(mat) + ":" + JSON.stringify(layout);
      if (node instanceof InstancedMesh) {
        const k = mk + ":" + primitiveKey(node);
        if (!instances.has(k))
          instances.set(k, {
            material: mat,
            geometry: node.geometry,
            matrices: [],
            owners: [],
          });
        const bucket = instances.get(k)!,
          start = bucket.matrices.length,
          local = new Matrix4();
        for (let i = 0; i < node.count; i++) {
          node.getMatrixAt(i, local);
          bucket.matrices.push(
            new Matrix4().multiplyMatrices(node.matrixWorld, local),
          );
        }
        bucket.owners.push({ start, count: node.count, key });
      } else {
        if (!statics.has(mk))
          statics.set(mk, {
            material: mat,
            geometries: [],
            owners: [],
            faces: 0,
          });
        const bucket = statics.get(mk)!,
          g = node.geometry.index
            ? node.geometry.toNonIndexed()
            : node.geometry.clone();
        g.applyMatrix4(node.matrixWorld);
        const count = g.attributes.position.count / 3;
        bucket.geometries.push(g);
        bucket.owners.push({ start: bucket.faces, count, key });
        bucket.faces += count;
      }
    });
    for (const b of statics.values()) {
      const geometry = mergeGeometries(b.geometries);
      b.geometries.forEach((g) => g.dispose());
      if (!geometry) continue;
      const mesh = new Mesh(geometry, b.material);
      setCampusModelShadows(mesh);
      mesh.userData.ownerRanges = b.owners;
      group.add(mesh);
    }
    for (const b of instances.values()) {
      const mesh = new InstancedMesh(b.geometry, b.material, b.matrices.length);
      setCampusModelShadows(mesh);
      b.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.userData.ownerRanges = b.owners;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    item.batches = group;
    return group;
  }
  private disposeBatches(item: Loaded) {
    item.batches?.removeFromParent();
    item.batches?.traverse((n) => {
      if (n instanceof InstancedMesh) n.dispose();
      else if (n instanceof Mesh) n.geometry.dispose();
    });
    item.batches = undefined;
  }
  private rebuild() {
    if (this.disposed) return;
    this.drawRoot.clear();
    this.pilotActiveMode = undefined;
    const active = new Set<string>(),
      selected = buildingModelForPlace(this.selected);
    let ready = 0,
      highCount = 0;
    const shadowCasters: string[] = [];
    for (const [key, mode] of this.wanted) {
      const item =
        this.loaded.get(key + ":" + mode) || this.loaded.get(key + ":2.5d");
      if (!item) continue;
      active.add(key + ":" + item.mode);
      ready++;
      if (item.mode === "3d") highCount++;
      if (item.entry.placeId === modelPilot.placeId)
        this.pilotActiveMode = item.mode;
      for (const [m, o] of item.materials) {
        m.emissive.set(
          item.entry.pickable && key === selected?.key ? "#113454" : "#000000",
        );
        m.emissiveIntensity =
          item.entry.pickable && key === selected?.key ? 0.13 : 0;
        const transparent = this.routeVisible || o.transparent;
        if (m.transparent !== transparent) m.needsUpdate = true;
        m.transparent = transparent;
        m.opacity = this.routeVisible ? 0.42 : o.opacity;
        m.depthWrite = this.routeVisible ? false : o.depthWrite;
      }

      const batches = this.prepareBatches(item, key);
      this.drawRoot.add(batches);
      if (batches.children.some((n) => n instanceof Mesh && n.castShadow))
        shadowCasters.push(key);
    }
    this.lighting?.setRouteVisible(this.routeVisible);
    if (this.lighting) this.lighting.receiver.visible = this.mode !== "2d";
    const shadowSignature = this.mode + ":" + [...active].sort().join("|");
    if (
      active.size &&
      this.pending.size === 0 &&
      this.shadowSignature !== shadowSignature &&
      this.renderer
    ) {
      this.shadowSignature = shadowSignature;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.scene.updateMatrixWorld(true);
    if (this.map) {
      const data = this.map.getContainer().dataset;
      data.campusModelCount = String(ready);
      data.campusModelDetails = String(highCount);
      data.campusModelMode = this.mode;
      data.campusModelPending = String(this.pending.size);
      data.campusModelResidentCount = String(this.loaded.size);
      data.campusModelFailed = JSON.stringify([...this.failed]);
      data.campusModelKeys = JSON.stringify([...active]);
      data.campusModelSelected = selected?.placeId || "";
      data.campusModelRouteVisible = String(this.routeVisible);
      data.campusModelShadowCasters = JSON.stringify(shadowCasters);
      this.map.triggerRepaint();
    }
    const pilotNotification = `${this.mode}:${this.pilotState}:${this.pilotActiveMode}`;
    if (this.pilotNotification !== pilotNotification) {
      this.pilotNotification = pilotNotification;
      this.onPilotVolumeChange?.();
    }
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (
      this.mode === "2d" ||
      this.lost ||
      gl.isContextLost() ||
      !this.renderer ||
      !this.map
    )
      return;
    const now = performance.now(),
      delta = now - this.lastFrame;
    this.lastFrame = now;
    if (this.map.isMoving() && delta > 0 && delta < 200)
      this.frameSamples.push(delta);
    if (this.frameSamples.length >= 60) {
      const average =
        this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;
      const data = this.map.getContainer().dataset;
      data.modelMovingFrameMs = average.toFixed(1);
      this.frameSamples = [];
      if (average > 45 && this.map.getPixelRatio() > 1) {
        data.renderProfile = "conservative";
        this.map.setPixelRatio(Math.max(1, this.map.getPixelRatio() * 0.8));
        data.rasterPixelRatio = String(this.map.getPixelRatio());
        queueMicrotask(() => this.reconcile());
      }
    }
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(this.localMatrix);
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
    this.projectionReady = true;
    this.renderer.resetState();
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setViewport(
      0,
      0,
      gl.drawingBufferWidth / ratio,
      gl.drawingBufferHeight / ratio,
    );
    const updateShadows = this.renderer.shadowMap.needsUpdate;
    this.renderer.render(this.scene, this.camera);
    if (updateShadows) this.shadowUpdates++;
    this.renderer.resetState();
    const data = this.map.getContainer().dataset;
    data.campusModelDrawCalls = String(this.renderer.info.render.calls);
    data.campusModelTriangles = String(this.renderer.info.render.triangles);
    data.campusModelShadowUpdates = String(this.shadowUpdates);
    if (updateShadows) data.campusModelShadowMode = this.mode;
    data.campusModelFrames = String(Number(data.campusModelFrames || 0) + 1);
    if (this.pilotDetailedReady)
      data.modelFrameCount = String(Number(data.modelFrameCount || 0) + 1);
  }
  pick(point: { x: number; y: number }) {
    if (!this.map || this.mode === "2d" || !this.projectionReady) return;
    const width = this.map.getContainer().clientWidth,
      height = this.map.getContainer().clientHeight,
      x = (point.x / width) * 2 - 1,
      y = 1 - (point.y / height) * 2,
      near = new Vector3(x, y, -1).applyMatrix4(
        this.camera.projectionMatrixInverse,
      ),
      far = new Vector3(x, y, 1).applyMatrix4(
        this.camera.projectionMatrixInverse,
      ),
      ray = new Raycaster(near, far.sub(near).normalize());
    for (const hit of ray.intersectObject(this.drawRoot, true)) {
      const index = hit.instanceId ?? hit.faceIndex;
      if (index == null) continue;
      const owner = (hit.object.userData.ownerRanges as OwnerRange[]).find(
          (r) => index >= r.start && index < r.start + r.count,
        ),
        entry = buildingModelCatalog.entries.find((e) => e.key === owner?.key);
      if (entry?.pickable && entry.placeId) return entry.placeId;
    }
  }
  private disposeObjects(root: Object3D) {
    const geometries = new Set<Mesh["geometry"]>(),
      materials = new Set<Material>(),
      textures = new Set<Texture>();
    root.traverse((n) => {
      if (!(n instanceof Mesh)) return;
      if (n instanceof InstancedMesh) n.dispose();
      geometries.add(n.geometry);
      for (const m of Array.isArray(n.material) ? n.material : [n.material])
        materials.add(m);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => {
      for (const value of Object.values(m))
        if (value instanceof Texture) textures.add(value);
      m.dispose();
    });
    textures.forEach((t) => t.dispose());
  }
  onRemove() {
    this.disposed = true;
    cancelAnimationFrame(this.buildFrame);
    this.map
      ?.getCanvas()
      .removeEventListener("webglcontextlost", this.contextLost);
    this.map
      ?.getCanvas()
      .removeEventListener("webglcontextrestored", this.contextRestored);
    for (const item of this.loaded.values()) {
      this.disposeBatches(item);
      this.disposeObjects(item.wrapper);
    }
    this.loaded.clear();
    this.queue = [];
    this.lighting?.dispose();
    this.scene.clear();
    this.renderer?.dispose();
    this.map = undefined;
  }
}
