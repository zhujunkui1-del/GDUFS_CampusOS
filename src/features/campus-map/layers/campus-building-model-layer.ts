import {
  AmbientLight,
  Camera,
  DirectionalLight,
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
  type BuildingModelAsset,
  type BuildingModelEntry,
} from "../data/building-models";
import type { MapMode } from "@/domain/maps/contracts";
import { modelPilot, modelPilotAvailable } from "../data/model-pilot";
const buffers = new Map<string, Promise<ArrayBuffer>>();
async function readAsset(asset: BuildingModelAsset) {
  let pending = buffers.get(asset.url);
  if (!pending) {
    pending = fetch(asset.url, { cache: "force-cache" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Building model unavailable");
        const b = await r.arrayBuffer(),
          hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", b)),
          )
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
        if (hash !== asset.sha256)
          throw new Error("Building model hash mismatch");
        return b;
      })
      .catch((error) => {
        buffers.delete(asset.url);
        throw error;
      });
    buffers.set(asset.url, pending);
  }
  return pending;
}
type OwnerRange = { start: number; count: number; key: string };
type Loaded = {
  entry: BuildingModelEntry;
  mode: "2.5d" | "3d";
  wrapper: Group;
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

// Keep mode assets resident; spatial batches cull off-screen geometry without changing LOD.
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
  private buildFrame = 0;
  private notifiedPilotVolume = false;
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
    return this.mode === "2.5d" && this.loaded.has("dormitory-s7:2.5d");
  }
  onAdd(map: LibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
    this.scene.add(new AmbientLight(0xffffff, 2));
    const sun = new DirectionalLight(0xfff5e5, 3);
    sun.position.set(-45, 90, 65);
    this.scene.add(sun, this.drawRoot);
    this.reconcile();
  }
  setMode(mode: MapMode) {
    if (this.mode === mode) return;
    this.failed.clear();
    this.criticalReported.clear();
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
              (e) =>
                e.placeId !== modelPilot.placeId ||
                (this.mode === "2.5d" && modelPilotAvailable),
            );
    this.wanted.clear();
    for (const e of entries) {
      let mode: "2.5d" | "3d" = this.mode === "3d" ? "3d" : "2.5d";
      if (this.failed.has(`${e.key}:${mode}`)) mode = "2.5d";
      this.wanted.set(e.key, mode);
      const id = `${e.key}:${mode}`;
      if (
        !this.loaded.has(id) &&
        !this.failed.has(id) &&
        !this.pending.has(id)
      ) {
        this.pending.add(id);
        this.queue.push({ entry: e, mode });
      }
      if (
        this.failed.has(`${e.key}:2.5d`) &&
        e.key === selected?.key &&
        !this.loaded.has(`${e.key}:3d`) &&
        !this.criticalReported.has(e.key)
      ) {
        this.criticalReported.add(e.key);
        queueMicrotask(() => {
          if (!this.disposed) this.onCriticalError();
        });
      }
    }
    this.pump();
    this.requestBuild();
  }
  private pump() {
    while (this.workers < 3 && this.queue.length) {
      const task = this.queue.shift()!,
        id = `${task.entry.key}:${task.mode}`;
      if (this.wanted.get(task.entry.key) !== task.mode) {
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
      const b = await readAsset(entry.assets[mode]),
        gltf = await new GLTFLoader().parseAsync(b, "");
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
    } catch {
      this.failed.add(id);
    }
  }
  private requestBuild() {
    if (!this.buildFrame && !this.disposed)
      this.buildFrame = requestAnimationFrame(() => {
        this.buildFrame = 0;
        this.rebuild();
      });
  }
  private clearDraws() {
    this.drawRoot.traverse((n) => {
      if (n instanceof InstancedMesh) n.dispose();
      else if (n instanceof Mesh) n.geometry.dispose();
    });
    this.drawRoot.clear();
  }
  private rebuild() {
    if (this.disposed) return;
    this.clearDraws();
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
      >(),
      active = new Set<string>(),
      selected = buildingModelForPlace(this.selected);
    let ready = 0,
      highCount = 0;
    for (const [key, mode] of this.wanted) {
      const id = this.loaded.has(`${key}:${mode}`)
          ? `${key}:${mode}`
          : `${key}:2.5d`,
        item = this.loaded.get(id);
      if (!item) continue;
      active.add(id);
      ready++;
      if (item.mode === "3d") highCount++;
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
    }
    for (const b of statics.values()) {
      const geometry = mergeGeometries(b.geometries);
      b.geometries.forEach((g) => g.dispose());
      if (!geometry) continue;
      const mesh = new Mesh(geometry, b.material);
      mesh.userData.ownerRanges = b.owners;
      this.drawRoot.add(mesh);
    }
    for (const b of instances.values()) {
      const mesh = new InstancedMesh(b.geometry, b.material, b.matrices.length);
      b.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.userData.ownerRanges = b.owners;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.drawRoot.add(mesh);
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
      this.map.triggerRepaint();
    }
    if (this.notifiedPilotVolume !== this.pilotVolumeReady) {
      this.notifiedPilotVolume = this.pilotVolumeReady;
      this.onPilotVolumeChange?.();
    }
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    if (this.mode === "2d" || !this.renderer || !this.map) return;
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
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    const data = this.map.getContainer().dataset;
    data.campusModelDrawCalls = String(this.renderer.info.render.calls);
    data.campusModelTriangles = String(this.renderer.info.render.triangles);
    data.campusModelFrames = String(Number(data.campusModelFrames || 0) + 1);
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
      materials = new Set<Material>();
    root.traverse((n) => {
      if (!(n instanceof Mesh)) return;
      if (n instanceof InstancedMesh) n.dispose();
      geometries.add(n.geometry);
      for (const m of Array.isArray(n.material) ? n.material : [n.material])
        materials.add(m);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  }
  onRemove() {
    this.disposed = true;
    cancelAnimationFrame(this.buildFrame);
    this.clearDraws();
    for (const item of this.loaded.values()) this.disposeObjects(item.wrapper);
    this.loaded.clear();
    this.queue = [];
    this.scene.clear();
    this.renderer?.dispose();
    this.map = undefined;
  }
}
