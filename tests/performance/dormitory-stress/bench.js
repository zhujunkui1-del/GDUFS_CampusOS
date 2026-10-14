/* global window, document, fetch, performance, requestAnimationFrame, setTimeout */
import {
  Scene,
  Camera,
  WebGLRenderer,
  Matrix4,
  Vector3,
  AmbientLight,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  ShadowMaterial,
  PCFShadowMap,
} from "three";
import { GLTFLoader } from "/loader.js";
import { createDormitoryBatch, disposeDormitoryBatch } from "/batch.js";
import * as maplibregl from "/maplibre.mjs";

const started = performance.now();
const params = new URLSearchParams(window.location.search);
const count = Number(params.get("count") || 1);
if (![1, 10, 30, 60].includes(count))
  throw new Error("Unsupported benchmark size");
const variant = params.get("variant") || "baseline";
const labelsEnabled = params.get("labels") !== "0" && variant !== "labels-off";
const shadows = params.get("shadows") !== "0" && variant !== "shadows-off";
const positions = Array.from({ length: 60 }, (_, i) => [
  ((i % 6) - 2.5) * 90,
  (Math.floor(i / 6) - 4.5) * 64,
])
  .sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  .slice(0, count);
const baseline = [
  "baseline",
  "cached-shadow",
  "labels-off",
  "shadows-off",
].includes(variant);
const cached =
  variant === "optimized" ||
  variant === "cached-shadow" ||
  ["adaptive", "spatial", "staged"].includes(variant);
const origin = maplibregl.MercatorCoordinate.fromLngLat([0, 0]);
const meter = origin.meterInMercatorCoordinateUnits();
const coordinate = (x, z) =>
  new maplibregl.MercatorCoordinate(origin.x + x * meter, origin.y + z * meter)
    .toLngLat()
    .toArray();
const volume = await (await fetch("/volume.json")).json();
const realOrigin = maplibregl.MercatorCoordinate.fromLngLat(volume.origin);
const realMeter = realOrigin.meterInMercatorCoordinateUnits();
const localRings = volume.geometry.coordinates.map((ring) =>
  ring.map((p) => {
    const q = maplibregl.MercatorCoordinate.fromLngLat(p);
    return [(q.x - realOrigin.x) / realMeter, (q.y - realOrigin.y) / realMeter];
  }),
);
const fixtures = positions.map(([x, z], i) => ({
  type: "Feature",
  properties: { id: `stress-only-${i}`, height: 21 },
  geometry: {
    type: "Polygon",
    coordinates: localRings.map((ring) =>
      ring.map(([a, b]) => coordinate(x + a, z + b)),
    ),
  },
}));
const lines = [];
for (let i = -5; i <= 5; i++) {
  lines.push({
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [coordinate(i * 80, -400), coordinate(i * 80, 400)],
    },
  });
  lines.push({
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [coordinate(-400, i * 80), coordinate(400, i * 80)],
    },
  });
}
maplibregl.setWorkerUrl("/worker.mjs");
const map = new maplibregl.Map({
  container: "map",
  center: [0, 0],
  zoom: 16,
  pitch: 38,
  maxPitch: 38,
  minZoom: 14,
  maxZoom: 20,
  attributionControl: false,
  renderWorldCopies: false,
  canvasContextAttributes: { antialias: false, powerPreference: "low-power" },
  style: {
    version: 8,
    sources: {
      fixtures: {
        type: "geojson",
        data: { type: "FeatureCollection", features: fixtures },
      },
      grid: {
        type: "geojson",
        data: { type: "FeatureCollection", features: lines },
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f2f1ec" },
      },
      {
        id: "roads",
        type: "line",
        source: "grid",
        paint: { "line-color": "#fff", "line-width": 5 },
      },
      {
        id: "footprints",
        type: "fill",
        source: "fixtures",
        paint: { "fill-color": "#e0d8cc" },
      },
      {
        id: "volumes",
        type: "fill-extrusion",
        source: "fixtures",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#e4d9c6",
          "fill-extrusion-height": 21,
        },
      },
    ],
  },
});
let mode = "3d",
  modelRoot,
  renderer,
  modelReady = false,
  rendererStats = {},
  glDraws = 0,
  modelFrameCpuMs = 0;
const samples = [];
let capture = false;
let previous = 0;
const scene = new Scene(),
  camera = new Camera();
const matrix = new Matrix4()
  .makeTranslation(origin.x, origin.y, origin.z)
  .scale(new Vector3(meter, -meter, meter))
  .multiply(new Matrix4().makeRotationX(Math.PI / 2));
scene.add(new AmbientLight(0xffffff, 2));
const sun = new DirectionalLight(0xfff5e5, 3);
sun.position.set(-45, 90, 65);
sun.castShadow = shadows;
sun.shadow.mapSize.set(512, 512);
Object.assign(sun.shadow.camera, {
  left: -500,
  right: 500,
  top: 500,
  bottom: -500,
  near: 1,
  far: 1500,
});
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.3;
scene.add(sun);
const ground = new Mesh(
  new PlaneGeometry(850, 850),
  new ShadowMaterial({ opacity: 0.17, depthWrite: false }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0.03;
ground.receiveShadow = true;
scene.add(ground);
await new Promise((resolve) => map.once("load", resolve));
const mapLoadedMs = performance.now() - started;
map.fitBounds([coordinate(-340, -350), coordinate(340, 350)], {
  padding: { top: 125, bottom: 80, left: 35, right: 35 },
  pitch: 38,
  duration: 0,
});
const overview = {
  center: map.getCenter().toArray(),
  zoom: map.getZoom(),
  bearing: 0,
  pitch: 38,
};
const assetStarted = performance.now();
const binary = await (await fetch("/template.glb")).arrayBuffer();
const fetchedMs = performance.now() - assetStarted;
const parseStarted = performance.now();
const template = (await new GLTFLoader().parseAsync(binary, "")).scene;
const parseMs = performance.now() - parseStarted;
template.traverse((node) => {
  if (!(node instanceof Mesh)) return;
  node.castShadow = !["glass", "metal"].includes(
    Array.isArray(node.material) ? "" : node.material.name,
  );
  node.receiveShadow = true;
});
const buildStarted = performance.now();
const placements = positions.map(([x, z]) =>
  new Matrix4().makeTranslation(x, 0, z),
);
if (baseline) {
  modelRoot = new Scene();
  for (const [x, z] of positions) {
    const root = template.clone(true);
    root.position.set(x, 0, z);
    modelRoot.add(root);
  }
} else if (variant === "spatial") {
  modelRoot = new Scene();
  const cells = new Map();
  for (const placement of placements) {
    const key = `${Math.floor(placement.elements[12] / 180)}:${Math.floor(placement.elements[14] / 128)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(placement);
  }
  for (const cell of cells.values())
    modelRoot.add(createDormitoryBatch(template, cell, 10));
} else if (variant === "staged") {
  modelRoot = new Scene();
  for (let start = 0; start < placements.length; start += 10) {
    modelRoot.add(
      createDormitoryBatch(template, placements.slice(start, start + 10), 10),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
} else modelRoot = createDormitoryBatch(template, placements, 10);
scene.add(modelRoot);
scene.updateMatrixWorld(true);
const constructionMs = performance.now() - buildStarted;
map.addLayer({
  id: "stress-models",
  type: "custom",
  renderingMode: "3d",
  onAdd(_, gl) {
    renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    renderer.autoClear = false;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = !cached;
    renderer.shadowMap.needsUpdate = true;
    for (const name of [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
    ]) {
      const original = gl[name].bind(gl);
      gl[name] = (...args) => {
        glDraws++;
        return original(...args);
      };
    }
  },
  render(gl, input) {
    const detailed =
      mode === "3d" &&
      !(variant === "adaptive" && map.getZoom() < overview.zoom + 0.25);
    if (!detailed) {
      rendererStats = { calls: 0, triangles: 0 };
      modelFrameCpuMs = 0;
      modelReady = true;
      return;
    }
    const t = performance.now();
    camera.projectionMatrix
      .fromArray(input.defaultProjectionData.mainMatrix)
      .multiply(matrix);
    renderer.resetState();
    renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.render(scene, camera);
    renderer.resetState();
    modelFrameCpuMs = performance.now() - t;
    rendererStats = {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    };
    modelReady = true;
  },
  onRemove() {
    if (!baseline) disposeDormitoryBatch(modelRoot);
    renderer?.dispose();
  },
});
if (variant === "adaptive")
  map.setLayoutProperty("volumes", "visibility", "visible");
if (labelsEnabled)
  for (let i = 0; i < 113; i++) {
    const label = document.createElement("div");
    label.className = "marker";
    label.textContent = `TEST-${String(i + 1).padStart(3, "0")}`;
    new maplibregl.Marker({ element: label })
      .setLngLat(coordinate(((i % 11) - 5) * 62, (Math.floor(i / 11) - 5) * 62))
      .addTo(map);
  }
map.on("render", () => {
  const now = performance.now();
  if (capture)
    samples.push({
      dt: previous ? now - previous : 0,
      glDraws,
      ...rendererStats,
      modelFrameCpuMs,
    });
  previous = now;
  glDraws = 0;
});
map.triggerRepaint();
await new Promise((resolve) => {
  const ready = () => {
    if (modelReady) resolve();
    else requestAnimationFrame(ready);
  };
  ready();
});
const readyMs = performance.now() - started;
const context = map.getCanvas().getContext("webgl2"),
  debug = context.getExtension("WEBGL_debug_renderer_info");
const gpu = debug
  ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
  : "unavailable";
const gpuTimerAvailable = !!context.getExtension(
  "EXT_disjoint_timer_query_webgl2",
);
document.querySelector("#count").value = String(count);
document.querySelector("#variant").value = variant;
document.querySelector("#condition").textContent =
  `${count}栋 · ${baseline ? "优化前" : "优化后"}`;
const switchMode = (next) => {
  mode = next;
  document.querySelector("#mode").textContent = {
    "2d": "2D",
    "2.5d": "2.5D",
    "3d": "3D",
  }[mode];
  const volumeOn =
    mode === "2.5d" ||
    (mode === "3d" &&
      variant === "adaptive" &&
      map.getZoom() < overview.zoom + 0.25);
  map.setLayoutProperty("volumes", "visibility", volumeOn ? "visible" : "none");
  map.easeTo({ pitch: mode === "2d" ? 0 : 38, duration: 600 });
  map.triggerRepaint();
};
document.querySelector("#mode").onclick = () =>
  switchMode(mode === "2d" ? "2.5d" : mode === "2.5d" ? "3d" : "2d");
for (const id of ["count", "variant"])
  document.querySelector(`#${id}`).onchange = () => {
    const url = new URL(window.location.href);
    url.searchParams.set(id, document.querySelector(`#${id}`).value);
    window.location.href = url;
  };
map.on("zoom", () => {
  if (variant === "adaptive" && mode === "3d")
    map.setLayoutProperty(
      "volumes",
      "visibility",
      map.getZoom() < overview.zoom + 0.25 ? "visible" : "none",
    );
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
window.stressLab = {
  ready: true,
  count,
  variant,
  gpu,
  gpuTimerAvailable,
  mapLoadedMs,
  fetchedMs,
  parseMs,
  constructionMs,
  readyMs,
  bytes: binary.byteLength,
  geometryTriangles: count * 4748,
  async startExternal() {
    await this.rest();
    samples.length = 0;
    previous = 0;
    glDraws = 0;
    capture = true;
    return performance.now();
  },
  stopExternal(start) {
    capture = false;
    return {
      kind: "pointer-drag",
      elapsed: performance.now() - start,
      samples: samples.slice(),
      heap: performance.memory?.usedJSHeapSize ?? null,
      visibility: document.visibilityState,
      renderer: rendererStats,
    };
  },
  async run(kind, duration = 2400) {
    map.stop();
    mode = "3d";
    map.jumpTo(overview);
    switchMode("3d");
    await wait(750);
    samples.length = 0;
    previous = 0;
    glDraws = 0;
    capture = true;
    const t = performance.now();
    if (kind === "drag") {
      const center = map.getCenter();
      map.easeTo({
        center: [center.lng + 0.002, center.lat - 0.001],
        duration,
        easing: (t) => t,
      });
    } else if (kind === "zoom")
      map.easeTo({ zoom: overview.zoom + 1.0, duration, easing: (t) => t });
    else if (kind === "rotate")
      map.easeTo({ bearing: 180, duration, easing: (t) => t });
    else if (kind === "closeup")
      map.easeTo({ zoom: overview.zoom + 3, duration, easing: (t) => t });
    else if (kind === "mode") {
      switchMode("2d");
      await wait(700);
      switchMode("2.5d");
      await wait(700);
      switchMode("3d");
      await wait(700);
    } else if (kind === "idle") {
      const until = t + duration;
      const paint = () => {
        if (performance.now() < until) {
          map.triggerRepaint();
          requestAnimationFrame(paint);
        }
      };
      paint();
    }
    if (kind !== "mode") await wait(duration + 100);
    capture = false;
    const elapsed = performance.now() - t;
    const result = {
      visibility: document.visibilityState,
      focus: document.hasFocus(),
      kind,
      elapsed,
      samples: samples.slice(),
      heap: performance.memory?.usedJSHeapSize ?? null,
      renderer: rendererStats,
    };
    document.querySelector("#stats").textContent =
      `${count}栋 · ${kind} · ${Math.round((result.samples.length * 1000) / elapsed)}帧/秒 · ${rendererStats.calls}次模型绘制`;
    return result;
  },
  async rest() {
    mode = "3d";
    map.jumpTo(overview);
    switchMode("3d");
    await wait(750);
  },
  async naturalIdle() {
    const first = modelReady;
    await wait(800);
    return { modelReady: first, visibility: document.visibilityState };
  },
};
