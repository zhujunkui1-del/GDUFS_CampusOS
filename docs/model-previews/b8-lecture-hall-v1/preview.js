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
  Box3,
  Group,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.querySelector("#model");
const status = document.querySelector("#status");
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
const camera = new PerspectiveCamera(36, 1, 1, 1200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.minDistance = 35;
controls.maxDistance = 700;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new HemisphereLight(0xf5f9ff, 0xc1b7a4, 2.0));
const sun = new DirectionalLight(0xfff3df, 2.6);
sun.position.set(-75, 140, 110);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {
  left: -105,
  right: 105,
  top: 105,
  bottom: -105,
  near: 1,
  far: 450,
});
sun.shadow.normalBias = 0.15;
sun.shadow.bias = -0.00015;
scene.add(sun);
const floor = new Mesh(
  new PlaneGeometry(110, 130),
  new MeshStandardMaterial({ color: "#e6e9e3", roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.04;
floor.receiveShadow = true;
scene.add(floor);

const models = new Map();
let corners = [],
  envelope = [],
  currentMode = "3d",
  currentView = "overall",
  frame = 0,
  pending = 0;
function render() {
  cancelAnimationFrame(pending);
  pending = 0;
  renderer.render(scene, camera);
  canvas.dataset.frames = String(++frame);
  canvas.dataset.drawCalls = String(renderer.info.render.calls);
  canvas.dataset.renderTriangles = String(renderer.info.render.triangles);
  if (corners.length) {
    const points = corners.map((p) => p.clone().project(camera));
    canvas.dataset.modelExtent = JSON.stringify([
      Math.min(...points.map((p) => ((p.x + 1) * canvas.clientWidth) / 2)),
      Math.min(...points.map((p) => ((1 - p.y) * canvas.clientHeight) / 2)),
      Math.max(...points.map((p) => ((p.x + 1) * canvas.clientWidth) / 2)),
      Math.max(...points.map((p) => ((1 - p.y) * canvas.clientHeight) / 2)),
    ]);
  }
}
function invalidate() {
  if (!pending) pending = requestAnimationFrame(render);
}
controls.addEventListener("change", invalidate);
const target = new Vector3(0, 3.5, 0);
const views = {
  overall: new Vector3(-95, 85, 125),
  front: new Vector3(0, 18, 120),
  side: new Vector3(-110, 70, -40),
  roof: new Vector3(0, 180, -0.1),
};
function fitted(position) {
  const trial = camera.clone();
  trial.aspect = canvas.clientWidth / canvas.clientHeight;
  trial.updateProjectionMatrix();
  const direction = position.clone().sub(target).normalize();
  const top = Math.max(
    0.2,
    1 - (canvas.clientWidth < 600 ? 300 : 190) / canvas.clientHeight,
  );
  const bottom = Math.max(0.2, 1 - 210 / canvas.clientHeight);
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
    high = 700;
  for (let i = 0; i < 20; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) high = middle;
    else low = middle;
  }
  return target.clone().addScaledVector(direction, high * 1.015);
}
function setView(view) {
  if (!views[view]) return;
  currentView = view;
  camera.position.copy(
    fitted(
      views[view]
        .clone()
        .sub(target)
        .normalize()
        .multiplyScalar(120)
        .add(target),
    ),
  );
  controls.target.copy(target);
  controls.update();
  document
    .querySelectorAll("button[data-view]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.view === view)),
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
    controls.update();
  }
  render();
}
new ResizeObserver(resize).observe(canvas);
function setMode(mode) {
  if (!models.has(mode)) return;
  currentMode = mode;
  for (const [key, model] of models) model.visible = key === mode;
  const bounds = new Box3().setFromObject(models.get(mode));
  corners = [];
  for (const [x, z] of envelope)
    for (const y of [bounds.min.y, bounds.max.y])
      corners.push(new Vector3((x - 12.66) * 1.025, y, (z + 30.7) * 1.025));
  renderer.shadowMap.needsUpdate = true;
  document
    .querySelectorAll("button[data-mode]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode)),
    );
  canvas.dataset.mode = mode;
  setView(currentView);
}
document
  .querySelectorAll("button[data-mode]")
  .forEach((button) =>
    button.addEventListener("click", () => setMode(button.dataset.mode)),
  );
document
  .querySelectorAll("button[data-view]")
  .forEach((button) =>
    button.addEventListener("click", () => setView(button.dataset.view)),
  );
window.addEventListener("keydown", (event) => {
  if (event.key === "Home") setView("overall");
});

try {
  const manifest = await fetch("./manifest.json").then((response) =>
    response.json(),
  );
  envelope = manifest.previewEnvelopeAlignedMeters;
  const loader = new GLTFLoader();
  for (const mode of ["3d", "2.5d"]) {
    const gltf = await loader.loadAsync(manifest.assets[mode].url);
    const group = new Group();
    group.rotation.y = -manifest.alignedToLocal.rotationYRadians;
    const [ax, az] = manifest.alignedToLocal.anchor;
    gltf.scene.position.set(-ax, 0, -az);
    group.add(gltf.scene);
    group.position.set(-12.66, 0, 30.7);
    group.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.castShadow = node.material.name !== "glazing";
      node.receiveShadow = true;
    });
    group.visible = false;
    models.set(mode, group);
    scene.add(group);
  }
  scene.updateMatrixWorld(true);
  resize();
  setMode(currentMode);
  status.textContent = "";
  canvas.dataset.modelVersion = manifest.modelVersion;
  canvas.dataset.mapIntegrated = String(manifest.mapIntegrated);
  canvas.dataset.ready = "true";
} catch (error) {
  status.textContent = "模型加载失败，请刷新重试。";
  canvas.dataset.ready = "error";
  throw error;
}
