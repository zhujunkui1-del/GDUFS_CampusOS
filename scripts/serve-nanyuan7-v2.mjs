// Local read-only draft viewer. No map/app routes and no reference photo endpoints.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("docs/model-previews/nanyuan7-v2");
const modules = new Map([
  ["/vendor/three.module.js", "node_modules/three/build/three.module.js"],
  ["/vendor/three.core.js", "node_modules/three/build/three.core.js"],
  [
    "/vendor/addons/controls/OrbitControls.js",
    "node_modules/three/examples/jsm/controls/OrbitControls.js",
  ],
  [
    "/vendor/addons/loaders/GLTFLoader.js",
    "node_modules/three/examples/jsm/loaders/GLTFLoader.js",
  ],
  [
    "/vendor/addons/utils/BufferGeometryUtils.js",
    "node_modules/three/examples/jsm/utils/BufferGeometryUtils.js",
  ],
  [
    "/vendor/addons/utils/SkeletonUtils.js",
    "node_modules/three/examples/jsm/utils/SkeletonUtils.js",
  ],
  ["/vendor/LICENSE.txt", "node_modules/three/LICENSE"],
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
};
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    const permitted =
      path === "/" ||
      ["/index.html", "/preview.js", "/manifest.json", "/design.json"].includes(
        path,
      ) ||
      path === "/nanyuan7-v2.glb";
    if (!permitted && !modules.has(path)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const file = modules.has(path)
      ? resolve(modules.get(path))
      : resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (!modules.has(path) && !file.startsWith(root + sep))
      throw new Error("Invalid path");
    const bytes = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] || "text/plain",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(3012, "127.0.0.1", () =>
  console.log("南苑7栋 V2 独立预览：http://127.0.0.1:3012"),
);
