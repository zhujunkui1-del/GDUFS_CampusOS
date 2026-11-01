// Loopback-only review server. No source photographs or formal application routes.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("docs/model-previews/north-south-dormitories-v1"),
  manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const files = new Set([
  "index.html",
  "preview.js",
  "manifest.json",
  "design.json",
  "dormitories-2.5d.geojson",
  "dormitories-13-models.zip",
  ...Object.values(manifest.entries).flatMap((e) =>
    Object.values(e.assets).map((a) => a.url.replace("./", "")),
  ),
]);
const modules = new Map([
  ["/vendor/three.module.js", "node_modules/three/build/three.module.js"],
  ["/vendor/three.core.js", "node_modules/three/build/three.core.js"],
  ...[
    "controls/OrbitControls.js",
    "loaders/GLTFLoader.js",
    "utils/BufferGeometryUtils.js",
    "utils/SkeletonUtils.js",
  ].map((p) => [`/vendor/addons/${p}`, `node_modules/three/examples/jsm/${p}`]),
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json",
  ".glb": "model/gltf-binary",
  ".zip": "application/zip",
};
createServer(async (req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname,
    name = path === "/" ? "index.html" : path.slice(1);
  if (!files.has(name) && !modules.has(path)) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const file = modules.has(path)
        ? resolve(modules.get(path))
        : resolve(root, name),
      b = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .end(b);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(3025, "127.0.0.1", () =>
  console.log("南北苑13栋2.5D / 3D预览：http://127.0.0.1:3025"),
);
