/* global document,window,fetch,devicePixelRatio,requestAnimationFrame,cancelAnimationFrame,ResizeObserver,URLSearchParams */
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
  status = document.querySelector("#status"),
  select = document.querySelector("#building"),
  scene = new Scene();
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
const camera = new PerspectiveCamera(36, 1, 1, 7000),
  controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.minDistance = 35;
controls.maxDistance = 3000;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new HemisphereLight(0xf5f9ff, 0xc1b7a4, 2));
const sun = new DirectionalLight(0xfff3df, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.15;
sun.shadow.bias = -0.00015;
scene.add(sun, sun.target);
const floor = new Mesh(
  new PlaneGeometry(1, 1),
  new MeshStandardMaterial({ color: "#e6e9e3", roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const target = new Vector3(),
  views = {
    overall: new Vector3(170, 140, 200),
    front: new Vector3(0, 25, 180),
    side: new Vector3(-130, 150, 40),
    roof: new Vector3(0, 250, 0.1),
  },
  models = new Map(),
  loading = new Map(),
  loader = new GLTFLoader();
let manifest,
  corners = [],
  currentKey = "all",
  currentMode = "2.5d",
  currentView = "overall",
  frame = 0,
  pending = 0,
  revision = 0;
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
      0.15,
      1 - (canvas.clientWidth < 1050 ? 320 : 190) / canvas.clientHeight,
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
  let low = 35,
    high = 3000;
  for (let i = 0; i < 22; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }
  return target.clone().addScaledVector(direction, high * 1.015);
}
function setView(view) {
  if (!views[view]) return;
  currentView = view;
  camera.position.copy(fitted(target.clone().add(views[view])));
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
async function ensure(key, mode) {
  const id = `${key}:${mode}`;
  if (models.has(id)) return models.get(id);
  if (!loading.has(id))
    loading.set(
      id,
      loader
        .loadAsync(manifest.entries[key].assets[mode].url)
        .then((gltf) => {
          gltf.scene.visible = false;
          gltf.scene.traverse((n) => {
            if (!(n instanceof Mesh)) return;
            n.castShadow = n.material.name !== "glass";
            n.receiveShadow = true;
          });
          scene.add(gltf.scene);
          models.set(id, gltf.scene);
          return gltf.scene;
        })
        .finally(() => loading.delete(id)),
    );
  return loading.get(id);
}
async function show(key, mode) {
  if (!manifest.entries[key] || !manifest.entries[key].assets[mode]) return;
  const token = ++revision;
  currentKey = key;
  currentMode = mode;
  status.textContent = "正在加载模型…";
  canvas.dataset.ready = "loading";
  try {
    const model = await ensure(key, mode);
    if (token !== revision) return;
    for (const g of models.values()) g.visible = false;
    model.visible = true;
    scene.updateMatrixWorld(true);
    const entry = manifest.entries[key],
      asset = entry.assets[mode],
      b = asset.bounds,
      cx = (b.min[0] + b.max[0]) / 2,
      cz = (b.min[2] + b.max[2]) / 2,
      span = Math.max(80, b.max[0] - b.min[0], b.max[2] - b.min[2]);
    target.set(cx, 7.5, cz);
    corners = [];
    for (const x of [b.min[0], b.max[0]])
      for (const z of [b.min[2], b.max[2]])
        for (const y of [b.min[1], b.max[1]])
          corners.push(
            new Vector3(cx + (x - cx) * 1.04, y, cz + (z - cz) * 1.04),
          );
    floor.position.set(cx, -0.04, cz);
    floor.scale.set(span * 1.9, span * 1.9, 1);
    sun.position.set(cx - span * 0.8, span * 1.5, cz + span);
    sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: 1,
      far: span * 5,
    });
    sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    document.querySelector("h1").textContent = entry.name;
    document.querySelector(".meta").textContent = entry.buildingKeys
      ? `每栋7层 · ${entry.buildingKeys.length}栋`
      : key === "s7"
        ? "7层 · 原验收模型"
        : "7层 · 首版预览";
    select.value = key;
    document
      .querySelectorAll("button[data-mode]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
      );
    Object.assign(canvas.dataset, {
      building: key,
      mode,
      modelVersion: manifest.modelVersion,
      mapIntegrated: "false",
      assetSha256: asset.sha256,
      modelTriangles: String(asset.triangles),
      modelDrawCalls: String(asset.drawCalls),
      modelBytes: String(asset.bytes),
      reusedApprovedAsset: String(asset.reusedApprovedAsset),
    });
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
select.addEventListener("change", () => show(select.value, currentMode));
document
  .querySelectorAll("button[data-mode]")
  .forEach((b) =>
    b.addEventListener("click", () => show(currentKey, b.dataset.mode)),
  );
document
  .querySelectorAll("button[data-view]")
  .forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
window.addEventListener("keydown", (e) => {
  if (e.key === "Home") setView("overall");
});
try {
  manifest = await fetch("./manifest.json").then((r) => r.json());
  const params = new URLSearchParams(window.location.search),
    key = params.get("building"),
    mode = params.get("mode");
  resize();
  await show(
    manifest.entries[key] ? key : "all",
    mode === "3d" ? "3d" : "2.5d",
  );
} catch (error) {
  status.textContent = "模型加载失败，请刷新重试。";
  canvas.dataset.ready = "error";
  throw error;
}
