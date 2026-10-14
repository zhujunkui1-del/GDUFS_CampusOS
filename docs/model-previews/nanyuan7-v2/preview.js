/* global document, window, fetch, devicePixelRatio, performance, requestAnimationFrame, cancelAnimationFrame, ResizeObserver */
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

const canvas = document.querySelector("#model");
const status = document.querySelector("#status");
const scene = new Scene();
scene.background = new Color("#e9eef1");
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "low-power",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const camera = new PerspectiveCamera(36, 1, 0.1, 600);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.enablePan = true;
controls.minDistance = 12;
controls.maxDistance = 450;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 8, 0);
camera.position.set(82, 65, 100);
scene.add(new HemisphereLight(0xf6fbff, 0xc8c1ae, 2.2));
const sun = new DirectionalLight(0xfff2db, 3.0);
sun.position.set(-45, 85, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(512, 512);
Object.assign(sun.shadow.camera, {
  left: -65,
  right: 65,
  top: 65,
  bottom: -65,
  near: 1,
  far: 220,
});
sun.shadow.normalBias = 0.3;
sun.shadow.bias = -0.0005;
scene.add(sun);
const floor = new Mesh(
  new PlaneGeometry(130, 108),
  new MeshStandardMaterial({ color: 0xe3e8e8, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.025;
floor.receiveShadow = true;
scene.add(floor);

let modelCorners = [],
  currentView = "overall",
  paintFrame = 0;
let frame = 0,
  transitionFrame = 0,
  revision = 0;
function render() {
  cancelAnimationFrame(paintFrame);
  paintFrame = 0;
  renderer.render(scene, camera);
  canvas.dataset.frames = String(++frame);
  canvas.dataset.drawCalls = String(renderer.info.render.calls);
  canvas.dataset.viewport = JSON.stringify([
    window.innerWidth,
    window.innerHeight,
  ]);
  if (modelCorners.length) {
    const pixels = modelCorners.map((p) => {
      const q = p.clone().project(camera);
      return [
        ((q.x + 1) * window.innerWidth) / 2,
        ((1 - q.y) * window.innerHeight) / 2,
      ];
    });
    canvas.dataset.modelExtent = JSON.stringify([
      Math.min(...pixels.map((p) => p[0])),
      Math.min(...pixels.map((p) => p[1])),
      Math.max(...pixels.map((p) => p[0])),
      Math.max(...pixels.map((p) => p[1])),
    ]);
  }
}
function invalidate() {
  if (!paintFrame) paintFrame = requestAnimationFrame(render);
}
function fitted(position, target, fov) {
  if (!modelCorners.length) return position;
  const trial = camera.clone(),
    direction = position.clone().sub(target).normalize();
  let distance = position.distanceTo(target);
  trial.aspect = window.innerWidth / window.innerHeight;
  trial.fov = fov;
  trial.updateProjectionMatrix();
  const top = Math.max(0.12, 1 - 180 / window.innerHeight);
  const bottom = Math.max(0.12, 1 - 190 / window.innerHeight);
  for (let i = 0; i < 8; i++) {
    trial.position.copy(target).addScaledVector(direction, distance);
    trial.lookAt(target);
    trial.updateMatrixWorld();
    const points = modelCorners.map((p) => p.clone().project(trial));
    const ratio = Math.max(
      1,
      ...points.map((p) =>
        Math.max(Math.abs(p.x) / 0.88, p.y / top, -p.y / bottom),
      ),
    );
    if (ratio < 1.005) break;
    distance *= ratio * 1.025;
  }
  return target.clone().addScaledVector(direction, distance);
}
function resize() {
  const width = window.innerWidth,
    height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (modelCorners.length && currentView !== "courtyard") {
    camera.position.copy(fitted(camera.position, controls.target, camera.fov));
    controls.update();
  }
  render();
}
new ResizeObserver(resize).observe(document.body);
controls.addEventListener("change", invalidate);
controls.addEventListener("start", () => {
  revision++;
  cancelAnimationFrame(transitionFrame);
  canvas.dataset.moving = "false";
});

function setView(name, animated = true) {
  const portrait = window.innerWidth < 600;
  const views = {
    overall: {
      position: portrait ? [108, 90, 135] : [82, 65, 100],
      target: [0, 8, 0],
    },
    facade: {
      position: portrait ? [15, 28, 126] : [13, 27, 103],
      target: [0, 10, 0],
    },
    courtyard: {
      position: portrait ? [-10, 32, 7.5] : [-9, 28, 7],
      target: [7, 10, -6],
    },
    roof: {
      position: portrait ? [0, 185, 0.1] : [0, 130, 0.1],
      target: [0, 0, 0],
    },
  };
  const selected = views[name];
  if (!selected) return;
  document
    .querySelectorAll("nav button")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.view === name)),
    );
  canvas.dataset.view = name;
  currentView = name;
  const targetFov = name === "courtyard" ? 50 : 36,
    startFov = camera.fov;
  const targetPosition =
      name === "courtyard"
        ? new Vector3(...selected.position)
        : fitted(
            new Vector3(...selected.position),
            new Vector3(...selected.target),
            targetFov,
          ),
    targetLook = new Vector3(...selected.target);
  const startPosition = camera.position.clone(),
    startLook = controls.target.clone();
  const thisRevision = ++revision;
  cancelAnimationFrame(transitionFrame);
  const duration =
    animated && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 600
      : 0;
  const startTime = performance.now();
  canvas.dataset.moving = String(duration > 0);
  function step(now) {
    if (thisRevision !== revision) return;
    const t = duration ? Math.min(1, (now - startTime) / duration) : 1;
    const eased = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(startPosition, targetPosition, eased);
    camera.fov = startFov + (targetFov - startFov) * eased;
    camera.updateProjectionMatrix();
    controls.target.lerpVectors(startLook, targetLook, eased);
    controls.update();
    render();
    if (t < 1) transitionFrame = requestAnimationFrame(step);
    else canvas.dataset.moving = "false";
  }
  transitionFrame = requestAnimationFrame(step);
}
document
  .querySelectorAll("nav button")
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
  const gltf = await new GLTFLoader().loadAsync(manifest.asset.url);
  gltf.scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const name = Array.isArray(node.material) ? "" : node.material.name;
    node.castShadow = !["glass", "door", "metal"].includes(name);
    node.receiveShadow = true;
  });
  scene.add(gltf.scene);
  const bounds = manifest.bounds;
  const centerX = (bounds.min[0] + bounds.max[0]) / 2,
    centerZ = (bounds.min[2] + bounds.max[2]) / 2;
  gltf.scene.position.set(-centerX, 0, -centerZ);
  for (const x of [bounds.min[0] - centerX, bounds.max[0] - centerX])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2] - centerZ, bounds.max[2] - centerZ])
        modelCorners.push(new Vector3(x, y, z));
  const court = manifest.courtyard;
  const lawn = new Mesh(
    new PlaneGeometry(
      (court.max[0] - court.min[0]) * 0.88,
      (court.max[1] - court.min[1]) * 0.88,
    ),
    new MeshStandardMaterial({ color: 0xb7c3a4, roughness: 1 }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(
    (court.min[0] + court.max[0]) / 2 - centerX,
    0.015,
    (court.min[1] + court.max[1]) / 2 - centerZ,
  );
  lawn.receiveShadow = true;
  scene.add(lawn);
  status.textContent = "";
  canvas.dataset.modelVersion = manifest.modelVersion;
  canvas.dataset.modelBytes = String(manifest.asset.bytes);
  canvas.dataset.modelTriangles = String(manifest.asset.triangles);
  canvas.dataset.modelDrawCalls = String(manifest.asset.drawCalls);
  canvas.dataset.mapIntegrated = String(manifest.mapIntegrated);
  canvas.dataset.ready = "true";
  setView("overall", false);
} catch {
  status.textContent = "模型加载失败，请刷新重试。";
  canvas.dataset.ready = "error";
}
resize();
