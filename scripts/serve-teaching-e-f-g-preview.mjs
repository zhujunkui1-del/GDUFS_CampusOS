// Loopback-only independent model review. Original reference photographs are not served.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("docs/model-previews/teaching-e-f-g-v1");
const files = new Set([
  "index.html",
  "preview.js",
  "manifest.json",
  "design.json",
  "teaching-e-f-g-2.5d.glb",
  "teaching-e-f-g-3d.glb",
  "teaching-e-f-g-2.5d.geojson",
]);
const modules = new Map([
  ["/vendor/three.module.js", "node_modules/three/build/three.module.js"],
  ["/vendor/three.core.js", "node_modules/three/build/three.core.js"],
  ...[
    "controls/OrbitControls.js",
    "loaders/GLTFLoader.js",
    "utils/BufferGeometryUtils.js",
    "utils/SkeletonUtils.js",
  ].map((path) => [
    `/vendor/addons/${path}`,
    `node_modules/three/examples/jsm/${path}`,
  ]),
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json",
  ".glb": "model/gltf-binary",
};
createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  const name = path === "/" ? "index.html" : path.slice(1);
  if (!files.has(name) && !modules.has(path)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const file = modules.has(path)
      ? resolve(modules.get(path))
      : resolve(root, name);
    const data = await readFile(file);
    response
      .writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .end(data);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(3022, "127.0.0.1", () =>
  console.log("教学楼E—G栋2.5D / 3D独立预览：http://127.0.0.1:3022"),
);
