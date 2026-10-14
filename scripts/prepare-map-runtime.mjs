// Vendor the installed, pinned open-source worker. This copies library code only;
// it never downloads or refreshes map data. Explicit URL avoids bundler-relative workers.
import { mkdir, copyFile, readFile } from "node:fs/promises";
const pkg = JSON.parse(
  await readFile("node_modules/maplibre-gl/package.json", "utf8"),
);
if (pkg.version !== "6.14.0")
  throw new Error(
    "Update the immutable worker URL when changing MapLibre version.",
  );
const dir = "public/vendor/maplibre-6.14.0";
await mkdir(dir, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
  await copyFile(`node_modules/maplibre-gl/dist/${file}`, `${dir}/${file}`);
await copyFile("node_modules/maplibre-gl/LICENSE.txt", `${dir}/LICENSE.txt`);
await copyFile("node_modules/gcoord/LICENSE", `${dir}/gcoord-LICENSE.txt`);
const modelEngine = JSON.parse(
  await readFile("node_modules/three/package.json", "utf8"),
);
if (modelEngine.version !== "0.186.1")
  throw new Error(
    "Review the shared-context model layer before changing Three.js.",
  );
const modelDir = "public/vendor/three-0.186.1";
await mkdir(modelDir, { recursive: true });
await copyFile("node_modules/three/LICENSE", `${modelDir}/LICENSE.txt`);
