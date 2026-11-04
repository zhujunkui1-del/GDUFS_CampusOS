import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const catalog = JSON.parse(
  await readFile(
    "src/features/campus-map/data/building-model-catalog.json",
    "utf8",
  ),
);
const pilot = JSON.parse(
  await readFile("src/features/campus-map/data/nanyuan7-model.json", "utf8"),
);
const assets = [
  ...catalog.entries.flatMap((entry) =>
    Object.entries(entry.assets).map(([mode, asset]) => ({ ...asset, mode })),
  ),
  ...Object.values(pilot.assets).map((asset) => ({ ...asset, mode: "pilot" })),
];
let lowBytes = 0,
  lowTriangles = 0,
  highBytes = 0,
  highTriangles = 0;
for (const asset of assets) {
  if (!/^\/models\/[A-Za-z0-9/.-]+-[a-f0-9]{12}\.glb$/.test(asset.url))
    throw Error(`Model URL must contain its hash: ${asset.url}`);
  const bytes = await readFile(join("public", asset.url));
  if (
    bytes.length !== asset.bytes ||
    bytes.length > 4 * 1024 * 1024 ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw Error(`Model size/hash mismatch: ${asset.url}`);
  if (
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw Error(`Invalid GLB: ${asset.url}`);
  const length = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
  let actualTriangles = 0;
  for (const node of json.nodes || []) {
    if (node.mesh == null) continue;
    const instancing = node.extensions?.EXT_mesh_gpu_instancing;
    const instances = instancing
      ? json.accessors[Object.values(instancing.attributes)[0]].count
      : 1;
    for (const primitive of json.meshes[node.mesh].primitives) {
      if (primitive.mode != null && primitive.mode !== 4)
        throw Error(`Unsupported primitive budget: ${asset.url}`);
      actualTriangles +=
        (json.accessors[primitive.indices ?? primitive.attributes.POSITION]
          .count /
          3) *
        instances;
    }
  }
  if (actualTriangles !== asset.triangles)
    throw Error(`Triangle metadata mismatch: ${asset.url}`);
  if (
    json.buffers?.some((buffer) => buffer.uri) ||
    json.images?.some((image) => image.uri)
  )
    throw Error(`GLB must be self contained: ${asset.url}`);
  for (const texture of json.textures || []) {
    const image = json.images?.[texture.source];
    if (!image?.bufferView) throw Error(`Unbudgeted texture: ${asset.url}`);
    // New textured assets need an explicit decoded-texture budget and device proof.
    throw Error(`Texture budget/device verification required: ${asset.url}`);
  }
  if (asset.mode === "2.5d") {
    lowBytes += asset.bytes;
    lowTriangles += asset.triangles;
  }
  if (asset.mode === "3d") {
    highBytes += asset.bytes;
    highTriangles += actualTriangles;
  }
  if (asset.triangles > (asset.mode === "2.5d" ? 10000 : 50000))
    throw Error(`Per-model triangle budget exceeded: ${asset.url}`);
}
if (lowBytes > 4 * 1024 * 1024 || lowTriangles > 150000)
  throw Error(
    "Resident 2.5D budget exceeded; review loading budgets before adding models",
  );
if (highBytes > 8 * 1024 * 1024 || highTriangles > 300000)
  throw Error(
    "Full 3D catalog budget exceeded; optimize models before extending the catalog",
  );
const start = "# BEGIN verified map model assets";
const original = (await readFile("public/_headers", "utf8"))
  .split(start)[0]
  .trimEnd();
const urls = [...new Set(assets.map((asset) => asset.url))].sort();
urls.push(catalog.courtyardsUrl);
const expected =
  original +
  "\n\n" +
  start +
  "\n" +
  urls
    .map(
      (url) =>
        `${url}\n  Cache-Control: public,max-age=31536000,immutable\n  Content-Type: ${url.endsWith(".glb") ? "model/gltf-binary" : "application/geo+json"}`,
    )
    .join("\n\n") +
  "\n# END verified map model assets\n";
if (process.argv.includes("--write"))
  await writeFile("public/_headers", expected);
else if ((await readFile("public/_headers", "utf8")) !== expected)
  throw Error(
    "Run node scripts/verify-map-model-assets.mjs --write after model catalog changes",
  );
console.log(
  JSON.stringify({
    verified: assets.length,
    lowBytes,
    lowTriangles,
    highBytes,
    highTriangles,
    immutableResources: urls.length,
  }),
);
