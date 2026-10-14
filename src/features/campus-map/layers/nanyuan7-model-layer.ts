import {
  Camera,
  Scene,
  WebGLRenderer,
  Matrix4,
  Vector3,
  AmbientLight,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  ShadowMaterial,
  Raycaster,
  MeshStandardMaterial,
  PCFShadowMap,
  type Object3D,
  type Material,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  MercatorCoordinate,
  type Map as LibreMap,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
} from "maplibre-gl";
import { modelPilot, type PilotModelState } from "../data/model-pilot";

// MapLibre owns the canvas, camera and WebGL context. This layer owns only its assets.
export class Nanyuan7ModelLayer implements CustomLayerInterface {
  readonly id = "nanyuan7-model";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  visible = false;
  ready = false;
  private map?: LibreMap;
  private renderer?: WebGLRenderer;
  private scene = new Scene();
  private camera = new Camera();
  private root?: Object3D;
  private abort = new AbortController();
  private disposed = false;
  private selected = false;
  private routeVisible = false;
  private original = new Map<
    Material,
    { opacity: number; transparent: boolean }
  >();
  private localMatrix: Matrix4;

  constructor(private onState: (state: PilotModelState) => void) {
    const origin = MercatorCoordinate.fromLngLat(
      [modelPilot.origin[0], modelPilot.origin[1]],
      0,
    );
    const scale = origin.meterInMercatorCoordinateUnits();
    this.localMatrix = new Matrix4()
      .makeTranslation(origin.x, origin.y, origin.z)
      .scale(new Vector3(scale, -scale, scale))
      .multiply(new Matrix4().makeRotationX(Math.PI / 2));
  }
  onAdd(map: LibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.add(new AmbientLight(0xffffff, 2));
    const sun = new DirectionalLight(0xfff5e5, 3);
    sun.position.set(-45, 90, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.left = -65;
    sun.shadow.camera.right = 65;
    sun.shadow.camera.top = 65;
    sun.shadow.camera.bottom = -65;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.3;
    this.scene.add(sun);
    const ground = new Mesh(
      new PlaneGeometry(115, 85),
      new ShadowMaterial({ opacity: 0.17, depthWrite: false }),
    );
    ground.name = "model-shadow";
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.03;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.onState("loading");
    void this.load();
  }
  private async load() {
    try {
      const low = window.matchMedia("(max-width: 760px)").matches;
      const asset = low ? modelPilot.assets.low : modelPilot.assets.full;
      const response = await fetch(asset.url, {
        signal: this.abort.signal,
        cache: "force-cache",
      });
      if (!response.ok) throw new Error("Model asset unavailable");
      const buffer = await response.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (hash !== asset.sha256) throw new Error("Model asset hash mismatch");
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      if (this.disposed) {
        this.disposeObjects(gltf.scene);
        return;
      }
      this.root = gltf.scene;
      this.root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = !["glass", "frame", "recess"].includes(
          Array.isArray(object.material) ? "" : object.material.name,
        );
        object.receiveShadow = true;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          this.original.set(material, {
            opacity: material.opacity,
            transparent: material.transparent,
          });
      });
      this.scene.add(this.root);
      this.updateAppearance();
      this.ready = true;
      if (this.map) {
        const data = this.map.getContainer().dataset;
        data.modelLod = low ? "low" : "full";
        data.modelBytes = String(asset.bytes);
        data.modelTriangles = String(asset.triangles);
      }
      this.onState("ready");
      this.map?.triggerRepaint();
    } catch {
      if (!this.disposed) this.onState("error");
    }
  }
  setAppearance(selected: boolean, routeVisible: boolean) {
    this.selected = selected;
    this.routeVisible = routeVisible;
    this.updateAppearance();
    this.map?.triggerRepaint();
  }
  private updateAppearance() {
    for (const [material, original] of this.original) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      material.emissive.set(this.selected ? "#113454" : "#000000");
      material.emissiveIntensity = this.selected ? 0.13 : 0;
      const transparent = this.routeVisible || original.transparent;
      if (material.transparent !== transparent) material.needsUpdate = true;
      material.transparent = transparent;
      material.opacity = this.routeVisible ? 0.42 : original.opacity;
      material.depthWrite = !this.routeVisible;
    }
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    void gl;
    if (
      !this.visible ||
      !this.ready ||
      !this.map ||
      !this.renderer ||
      this.map.getZoom() < 16.7
    )
      return;
    this.camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(this.localMatrix);
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    const data = this.map.getContainer().dataset;
    data.modelDrawCalls = String(this.renderer.info.render.calls);
    data.modelFrameCount = String(Number(data.modelFrameCount || 0) + 1);
    // Static model: no extra loop or per-frame React state update.
  }
  pick(point: { x: number; y: number }) {
    if (
      !this.visible ||
      !this.ready ||
      !this.map ||
      !this.root ||
      this.map.getZoom() < 16.7
    )
      return false;
    const { clientWidth: width, clientHeight: height } =
      this.map.getContainer();
    const x = (point.x / width) * 2 - 1,
      y = 1 - (point.y / height) * 2;
    const near = new Vector3(x, y, -1).applyMatrix4(
      this.camera.projectionMatrixInverse,
    );
    const far = new Vector3(x, y, 1).applyMatrix4(
      this.camera.projectionMatrixInverse,
    );
    const raycaster = new Raycaster(near, far.sub(near).normalize());
    return raycaster.intersectObject(this.root, true).length > 0;
  }
  private disposeObjects(root: Object3D) {
    const materials = new Set<Material>();
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    });
    materials.forEach((material) => material.dispose());
  }
  onRemove() {
    this.disposed = true;
    this.abort.abort();
    this.disposeObjects(this.scene);
    this.scene.traverse((object) => {
      if (object instanceof DirectionalLight) object.shadow.dispose();
    });
    this.scene.clear();
    this.original.clear();
    // dispose releases renderer-owned resources, without forceContextLoss on the map.
    this.renderer?.dispose();
    this.map = undefined;
    this.ready = false;
  }
}
