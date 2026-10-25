/* global document, window, fetch, devicePixelRatio, requestAnimationFrame, cancelAnimationFrame, ResizeObserver */
import {
  Scene,
  Color,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
  PCFShadowMap,
  ACESFilmicToneMapping,
  Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const canvas = document.querySelector("#model"),
  status = document.querySelector("#status");
const scene = new Scene();
scene.background = new Color("#edf0ed");
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "low-power",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new PerspectiveCamera(36, 1, 1, 1800),
  controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.minDistance = 24;
controls.maxDistance = 1400;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new HemisphereLight(0xf5f9ff, 0xc1b7a4, 2.0));
const sun = new DirectionalLight(0xfff3df, 2.6);
sun.position.set(-130, 240, -170);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {
  left: -220,
  right: 220,
  top: 220,
  bottom: -220,
  near: 1,
  far: 850,
});
sun.shadow.normalBias = 0.15;
sun.shadow.bias = -0.00015;
scene.add(sun);
const floor = new Mesh(
  new PlaneGeometry(390, 390),
  new MeshStandardMaterial({ color: "#e6e9e3", roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(28, -0.04, 5);
floor.receiveShadow = true;
scene.add(floor);
const target = new Vector3(0, 6, 0),
  views = {
    overall: new Vector3(-170, 150, 180),
    front: new Vector3(0, 48, 180),
    side: new Vector3(170, 120, -150),
    roof: new Vector3(0, 250, 0.1),
  };
let manifest,
  currentPart = "complex",
  currentMode = "3d",
  currentView = "overall",
  corners = [],
  frame = 0,
  pending = 0,
  revision = 0;
const models = new Map(),
  loading = new Map(),
  loader = new GLTFLoader();
function render() {
  cancelAnimationFrame(pending);
  pending = 0;
  renderer.render(scene, camera);
  canvas.dataset.frames = String(++frame);
  canvas.dataset.drawCalls = String(renderer.info.render.calls);
  canvas.dataset.renderTriangles = String(renderer.info.render.triangles);
  if (corners.length) {
    const p = corners.map((v) => v.clone().project(camera));
    canvas.dataset.modelExtent = JSON.stringify([
      Math.min(...p.map((v) => ((v.x + 1) * canvas.clientWidth) / 2)),
      Math.min(...p.map((v) => ((1 - v.y) * canvas.clientHeight) / 2)),
      Math.max(...p.map((v) => ((v.x + 1) * canvas.clientWidth) / 2)),
      Math.max(...p.map((v) => ((1 - v.y) * canvas.clientHeight) / 2)),
    ]);
  }
}
function invalidate() {
  if (!pending) pending = requestAnimationFrame(render);
}
controls.addEventListener("change", invalidate);
function fitted(position) {
  const trial = camera.clone();
  trial.aspect = canvas.clientWidth / canvas.clientHeight;
  trial.updateProjectionMatrix();
  const direction = position.clone().sub(target).normalize(),
    top = Math.max(
      0.2,
      1 -
        (canvas.clientWidth < 600
          ? 440
          : canvas.clientWidth < 1050
            ? 320
            : 190) /
          canvas.clientHeight,
    ),
    bottom = Math.max(0.2, 1 - 210 / canvas.clientHeight);
  function fits(distance) {
    trial.position.copy(target).addScaledVector(direction, distance);
    trial.lookAt(target);
    trial.updateMatrixWorld();
    return corners.every((p) => {
      if (p.clone().applyMatrix4(trial.matrixWorldInverse).z >= -1)
        return false;
      const q = p.clone().project(trial);
      return Math.abs(q.x) <= 0.9 && q.y <= top && -q.y <= bottom;
    });
  }
  let low = 24,
    high = 1400;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }
  return target.clone().addScaledVector(direction, high * 1.015);
}
function setView(view) {
  if (!views[view]) return;
  currentView = view;
  const direction =
    view === "overall" && currentPart === "C"
      ? new Vector3(-170, 150, -180)
      : views[view];
  camera.position.copy(fitted(target.clone().add(direction)));
  controls.target.copy(target);
  controls.update();
  document
    .querySelectorAll("button[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === view)),
    );
  canvas.dataset.view = view;
  render();
}
function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  if (corners.length) {
    camera.position.copy(fitted(camera.position));
    controls.target.copy(target);
    controls.update();
  }
  render();
}
new ResizeObserver(resize).observe(canvas);
const assetFor = (part, mode) =>
  part === "complex"
    ? manifest.assets[mode]
    : manifest.componentAssets[part][mode];
async function ensureModel(part, mode) {
  const key = `${part}:${mode}`;
  if (models.has(key)) return models.get(key);
  if (!loading.has(key))
    loading.set(
      key,
      loader
        .loadAsync(assetFor(part, mode).url)
        .then((gltf) => {
          gltf.scene.visible = false;
          gltf.scene.traverse((node) => {
            if (!(node instanceof Mesh)) return;
            node.castShadow = node.material.name !== "glazing";
            node.receiveShadow = true;
          });
          scene.add(gltf.scene);
          models.set(key, gltf.scene);
          return gltf.scene;
        })
        .finally(() => loading.delete(key)),
    );
  return loading.get(key);
}
async function show(part, mode) {
  const token = ++revision;
  currentPart = part;
  currentMode = mode;
  status.textContent = "正在加载模型…";
  try {
    const model = await ensureModel(part, mode);
    if (token !== revision) return;
    for (const g of models.values()) g.visible = false;
    model.visible = true;
    scene.updateMatrixWorld(true);
    const asset = assetFor(part, mode),
      b = asset.bounds,
      cx = (b.min[0] + b.max[0]) / 2,
      cz = (b.min[2] + b.max[2]) / 2;
    target.set(cx, b.min[1] + (b.max[1] - b.min[1]) * 0.36, cz);
    corners = [];
    for (const [x, z] of manifest.partEnvelopes[part])
      for (const y of [b.min[1], b.max[1]])
        corners.push(
          new Vector3(cx + (x - cx) * 1.08, y, cz + (z - cz) * 1.08),
        );
    renderer.shadowMap.needsUpdate = true;
    document
      .querySelectorAll("button[data-part]")
      .forEach((e) =>
        e.setAttribute("aria-pressed", String(e.dataset.part === part)),
      );
    document
      .querySelectorAll("button[data-mode]")
      .forEach((e) =>
        e.setAttribute("aria-pressed", String(e.dataset.mode === mode)),
      );
    document.querySelector("h1").textContent = {
      complex: "教学楼A—D栋",
      A: "教学楼A栋",
      B: "教学楼B栋",
      C: "教学楼C栋",
      D: "教学楼D栋",
    }[part];
    document.querySelector(".meta").textContent = {
      complex: "5层 · 钟楼8层",
      A: "5层楼高 · 首版预览",
      B: "5层楼高 · 首版预览",
      C: "5层 · 钟楼8层",
      D: "5层楼高 · 首版预览",
    }[part];
    canvas.dataset.part = part;
    canvas.dataset.mode = mode;
    canvas.dataset.modelBytes = String(asset.bytes);
    canvas.dataset.modelTriangles = String(asset.triangles);
    canvas.dataset.modelDrawCalls = String(asset.drawCalls);
    canvas.dataset.modelVersion = manifest.modelVersion;
    canvas.dataset.mapIntegrated = "false";
    status.textContent = "";
    setView(currentView);
    canvas.dataset.ready = "true";
  } catch (error) {
    if (token === revision) {
      status.textContent = "模型加载失败，请刷新重试。";
      canvas.dataset.ready = "error";
    }
    throw error;
  }
}
document
  .querySelectorAll("button[data-part]")
  .forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.part, currentMode)),
  );
document
  .querySelectorAll("button[data-mode]")
  .forEach((b) =>
    b.addEventListener("click", () => show(currentPart, b.dataset.mode)),
  );
document
  .querySelectorAll("button[data-view]")
  .forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
window.addEventListener("keydown", (e) => {
  if (e.key === "Home") setView("overall");
});
try {
  manifest = await fetch("./manifest.json").then((r) => r.json());
  resize();
  await show("complex", "3d");
} catch (error) {
  status.textContent = "模型加载失败，请刷新重试。";
  canvas.dataset.ready = "error";
  throw error;
}
