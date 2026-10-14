// Explicit owner-approved promotion; never runs during application startup/build.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const draftRoot = "docs/model-previews/nanyuan7-v2";
const activePath = "src/features/campus-map/data/nanyuan7-model.json";
const legacyRoot = "docs/model-previews/nanyuan7-v1";
const current = await json(activePath);
const draft = await json(draftRoot + "/manifest.json");
const review = await json(
  "src/features/campus-map/data/owner-model-review.json",
);
const map = await json("src/features/campus-map/data/local-map-manifest.json");
const campus = await json("src/features/campus-map/data/campus.json");
const place = campus.places.find((p) => p.id === draft.placeId);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (
  review.model3D?.modelVersion !== draft.modelVersion ||
  review.model3D?.assetSha256 !== draft.asset.sha256 ||
  review.model3D?.approvedForMap !== true ||
  current.mapVersion !== map.version ||
  draft.sourceMapVersion !== map.version ||
  campus.mapVersion !== map.version ||
  draft.placeId !== current.placeId ||
  draft.heightMeters !== current.heightMeters ||
  draft.levels !== current.levels ||
  JSON.stringify(draft.origin) !== JSON.stringify(current.origin) ||
  draft.footprintSha256 !== hash(JSON.stringify(place?.geometry)) ||
  draft.footprintSha256 !== current.footprintSha256
)
  throw new Error(
    "Owner approval or source geometry/version does not match V2",
  );

const binary = await readFile(draftRoot + "/nanyuan7-v2.glb");
const gltf = JSON.parse(
  binary.subarray(20, 20 + binary.readUInt32LE(12)).toString(),
);
if (
  binary.subarray(0, 4).toString() !== "glTF" ||
  hash(binary) !== draft.asset.sha256 ||
  binary.length !== draft.asset.bytes ||
  binary.length > 100000 ||
  draft.asset.triangles > 6500 ||
  draft.asset.drawCalls > 10 ||
  gltf.images?.length ||
  gltf.buffers.some((buffer) => buffer.uri)
)
  throw new Error("V2 asset integrity or lightweight budget validation failed");

// Keep the original volume parameters and V1 asset references as a reviewable snapshot.
if (!current.volumeVersion) {
  await mkdir(legacyRoot, { recursive: true });
  await writeFile(
    legacyRoot + "/manifest.json",
    JSON.stringify(current, null, 2) + "\n",
  );
}
const legacy = await json(legacyRoot + "/manifest.json");
if (JSON.stringify(current.geometry) !== JSON.stringify(legacy.geometry))
  throw new Error("The approved V1 2.5D volume has changed");

const filename = `nanyuan7-v2-${draft.asset.sha256.slice(0, 12)}.glb`;
const publicRoot = "public/models/nanyuan7";
await mkdir(publicRoot, { recursive: true });
await copyFile(draftRoot + "/nanyuan7-v2.glb", publicRoot + "/" + filename);
const asset = { ...draft.asset, url: "/models/nanyuan7/" + filename };
const active = {
  ...legacy,
  modelVersion: draft.modelVersion,
  volumeVersion: legacy.modelVersion,
  appearanceAccuracy: draft.appearanceAccuracy,
  modelBounds: draft.bounds,
  lodStrategy: "shared_lightweight_v2",
  assets: { low: asset, full: asset },
  approvedAt: review.model3D.reviewedAt,
};
await writeFile(activePath, JSON.stringify(active, null, 2) + "\n");
await writeFile(
  publicRoot + "/SOURCE.md",
  `# 南苑7栋模型来源\n\nOSM footprint: https://www.openstreetmap.org/way/312536955 — © OpenStreetMap contributors, ODbL-1.0.\n\n7 floors / approximately 21m: project owner, 2026-10-14; not a surveyed height.\n\n2.5D retains the V1 volume. Active 3D: ${draft.modelVersion}, approved by the project owner on ${review.model3D.reviewedAt}. Both desktop and mobile use the same lightweight asset (${asset.bytes} bytes / ${asset.triangles} triangles / ${asset.drawCalls} model draws / ${asset.materialCount} materials / zero textures).\n\nOriginal procedural geometry/materials. Supplied dormitory photos informed the simplified cream frames, terracotta walls and open galleries; no photo pixels, textures or supplier meshes are included. Exact facade orientation, bays, stair cores, canopy and courtyard are visual approximations. Source footprint, place coordinates and navigation data are unchanged.\n\nEditable source: scripts/build-nanyuan7-v2.mjs and docs/model-previews/nanyuan7-v2/design.json. Approved promotion: scripts/publish-nanyuan7-v2.mjs. Active hash/geometry: src/features/campus-map/data/nanyuan7-model.json. V1 GLBs remain available as historical assets; their original manifest is docs/model-previews/nanyuan7-v1/manifest.json.\n`,
);
console.log(
  JSON.stringify(
    {
      modelVersion: active.modelVersion,
      volumeVersion: active.volumeVersion,
      asset,
    },
    null,
    2,
  ),
);
