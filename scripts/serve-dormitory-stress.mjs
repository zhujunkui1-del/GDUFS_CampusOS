// Loopback-only lab. Test replicas never enter the application or public campus data.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import ts from "typescript";
const routes = new Map([
  ["/", "tests/performance/dormitory-stress/index.html"],
  ["/bench.js", "tests/performance/dormitory-stress/bench.js"],
  ["/three.js", "node_modules/three/build/three.module.js"],
  ["/three.core.js", "node_modules/three/build/three.core.js"],
  ["/loader.js", "node_modules/three/examples/jsm/loaders/GLTFLoader.js"],
  [
    "/utils/BufferGeometryUtils.js",
    "node_modules/three/examples/jsm/utils/BufferGeometryUtils.js",
  ],
  [
    "/utils/SkeletonUtils.js",
    "node_modules/three/examples/jsm/utils/SkeletonUtils.js",
  ],
  ["/maplibre.mjs", "node_modules/maplibre-gl/dist/maplibre-gl.mjs"],
  [
    "/maplibre-gl-shared.mjs",
    "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
  ],
  ["/maplibre.css", "node_modules/maplibre-gl/dist/maplibre-gl.css"],
  ["/worker.mjs", "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"],
  ["/template.glb", "public/models/nanyuan7/nanyuan7-v2-54cc55342ae5.glb"],
  ["/volume.json", "docs/model-previews/nanyuan7-v1/manifest.json"],
]);
const mime = {
  ".mjs": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
};
createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  try {
    let bytes;
    if (path === "/batch.js")
      bytes = ts.transpileModule(
        await readFile(
          "src/features/campus-map/layers/dormitory-batch.ts",
          "utf8",
        ),
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        },
      ).outputText;
    else if (routes.has(path)) bytes = await readFile(routes.get(path));
    else {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mime[extname(path)] || "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
  } catch {
    response.writeHead(500);
    response.end("Lab file unavailable");
  }
}).listen(3013, "127.0.0.1", () =>
  console.log("宿舍压力测试：http://127.0.0.1:3013"),
);
