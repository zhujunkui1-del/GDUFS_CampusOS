// Rebuild only Youyuan's low-detail mass. The existing 3D GLB is hash-guarded and never written.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
  Shape,
  Vector2,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  Box3,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((result) => {
        this.result = result;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
};

const root = "docs/model-previews/youyuan-v1";
const catalogPath = "src/features/campus-map/data/building-model-catalog.json";
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const manifestPath = `${root}/manifest.json`;
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const designPath = `${root}/design.json`;
const design = JSON.parse(await readFile(designPath, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((item) => item.id === manifest.placeId);
const entry = catalog.entries.find((item) => item.key === "youyuan");
if (!place || place.name !== "友苑" || !entry)
  throw new Error("Canonical Youyuan place/catalog entry is missing.");
if (campus.mapVersion !== manifest.sourceMapVersion)
  throw new Error("Youyuan map version changed; review the source first.");
if (
  JSON.stringify(place.geometry) !== JSON.stringify(manifest.sourceGeometryWgs84)
)
  throw new Error("Youyuan source outline changed; refuse to reuse stale geometry.");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const footprintHash = sha256(JSON.stringify(place.geometry));
if (footprintHash !== manifest.sourceFootprintSha256)
  throw new Error("Youyuan outline hash mismatch.");

// Freeze and verify the high-detail model before changing any low-detail asset or catalog field.
const original3dManifest = JSON.stringify(manifest.assets["3d"]);
const original3dCatalog = JSON.stringify(entry.assets["3d"]);
const original3dPath = `public${entry.assets["3d"].url}`;
const original3dBytes = await readFile(original3dPath);
const original3dHash = sha256(original3dBytes);
if (
  original3dHash !== manifest.assets["3d"].sha256 ||
  original3dHash !== entry.assets["3d"].sha256
)
  throw new Error("The current Youyuan 3D GLB does not match its recorded hash.");
catalog.version = "campus-building-models-2026-11-12.2";
catalog.ownerApproval =
  "2026-11-01：将已完成的2.5D/3D模型放入网页；2026-11-12：新增友苑2.5D/3D模型并将其2.5D按南北苑统一为纯白模，保留原3D模型";
catalog.ownerRenderingCorrection =
  `${catalog.ownerRenderingCorrection}；2026-11-12：友苑2.5D使用与南北苑相同的纯白体块；原3D资产SHA256 ${original3dHash} 保持不变`;

const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const meterUnits = origin.meterInMercatorCoordinateUnits();
const local = ([lng, lat]) => {
  const projected = MercatorCoordinate.fromLngLat([lng, lat]);
  return [
    (projected.x - origin.x) / meterUnits,
    (projected.y - origin.y) / meterUnits,
  ];
};
const outer = place.geometry.slice(0, -1).map(local);
if (outer.length !== 22) throw new Error(`Expected 22 unique vertices, got ${outer.length}.`);

const heightMeters = 21;
const roofThickness = 0.25;
const wallHeight = heightMeters - roofThickness;
const ivory = new MeshStandardMaterial({ color: "#e8e5dc", roughness: 0.93 });
ivory.name = "ivory";
const roofMaterial = new MeshStandardMaterial({ color: "#d5d2c8", roughness: 0.93 });
roofMaterial.name = "roof";
const shape = new Shape(outer.map(([x, z]) => new Vector2(x, -z)));
const extrusion = (base, depth) => {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  return geometry;
};

const scene = new Scene();
scene.name = "友苑-2.5d-纯白体块";
const body = new Mesh(extrusion(0, wallHeight), ivory);
body.name = "plain-white-footprint-volume";
const roof = new Mesh(extrusion(wallHeight, roofThickness), roofMaterial);
roof.name = "flat-light-roof-cap";
scene.add(body, roof);
scene.userData = {
  modelVersion: "youyuan-v1-2026-11-12.2",
  sourcePlaceId: place.id,
  sourceMapVersion: campus.mapVersion,
  sourceFootprintSha256: footprintHash,
  sourceVertexCount: outer.length,
  mode: "2.5d",
  appearanceStyle: "plain-white-mass-matching-north-south-dormitories",
  heightMeters,
  heightAccuracy: "visual_estimate_only_not_surveyed",
  imagesEmbedded: false,
  textureCount: 0,
};
scene.updateMatrixWorld(true);
const bounds = new Box3().setFromObject(scene);
let triangles = 0;
let drawCalls = 0;
scene.traverse((node) => {
  if (!node.isMesh) return;
  const positions = node.geometry.attributes.position;
  triangles += (node.geometry.index?.count ?? positions.count) / 3;
  drawCalls++;
});

const binary = Buffer.from(
  await new GLTFExporter().parseAsync(scene, {
    binary: true,
    trs: false,
    onlyVisible: true,
    copyright:
      "Procedural image-free Youyuan 2.5D white mass; exact campus footprint with a visual-estimate roof height.",
  }),
);
const binaryHash = sha256(binary);
const previewFile = "youyuan-2.5d.glb";
const publicFile = `/models/campus/youyuan-2.5d-${binaryHash.slice(0, 12)}.glb`;
await writeFile(`${root}/${previewFile}`, binary);
await mkdir("public/models/campus", { recursive: true });
await writeFile(`public${publicFile}`, binary);

const newLowAsset = {
  file: previewFile,
  url: publicFile,
  sha256: binaryHash,
  bytes: binary.length,
  triangles: Math.round(triangles),
  drawCalls,
  bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  materialCount: 2,
  textureCount: 0,
  style: "plain_white_mass_matching_north_south_dormitories",
};
manifest.assets["2.5d"] = newLowAsset;
manifest.twoFiveDStyle = "plain-white-mass matching the North/South dormitory 2.5D models";
manifest.twoFiveDRevision = "2026-11-12: simplified to a plain white volume at owner request";
entry.assets["2.5d"] = {
  url: publicFile,
  sha256: binaryHash,
  bytes: binary.length,
  triangles: newLowAsset.triangles,
  drawCalls: newLowAsset.drawCalls,
  bounds: newLowAsset.bounds,
};

const oldLowUrl = JSON.parse(await readFile(catalogPath, "utf8"))
  .entries.find((item) => item.key === "youyuan")
  .assets["2.5d"].url;
const formattedCatalog = await format(JSON.stringify(catalog), { parser: "json" });
await writeFile(catalogPath, formattedCatalog);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
design.assets["2.5d"] = newLowAsset;
design.twoFiveDStyle = manifest.twoFiveDStyle;
design.twoFiveDRevision = manifest.twoFiveDRevision;
await writeFile(designPath, `${JSON.stringify(design, null, 2)}\n`);

const catalogAfter = JSON.parse(await readFile(catalogPath, "utf8"));
if (
  JSON.stringify(catalogAfter.entries.find((item) => item.key === "youyuan").assets["3d"]) !==
  original3dCatalog
)
  throw new Error("Youyuan 3D catalog metadata changed unexpectedly.");
if (sha256(await readFile(original3dPath)) !== original3dHash)
  throw new Error("Youyuan 3D GLB changed unexpectedly.");
if (JSON.stringify(manifest.assets["3d"]) !== original3dManifest)
  throw new Error("Youyuan 3D manifest metadata changed unexpectedly.");

if (oldLowUrl !== publicFile) {
  const stillReferenced = catalogAfter.entries.some((model) =>
    Object.values(model.assets).some((asset) => asset.url === oldLowUrl),
  );
  if (!stillReferenced) await rm(`public${oldLowUrl}`, { force: true });
}

const changeReport = {
  changedAsset: "2.5d",
  style: manifest.twoFiveDStyle,
  old2_5dUrl: oldLowUrl,
  new2_5dUrl: publicFile,
  new2_5dSha256: binaryHash,
  new2_5dBytes: binary.length,
  new2_5dTriangles: Math.round(triangles),
  preserved3dUrl: entry.assets["3d"].url,
  preserved3dSha256: original3dHash,
  preserved3dBytes: original3dBytes.length,
  sourceFootprintSha256: footprintHash,
};
await writeFile(
  `${root}/2.5d-revision-2026-11-12.json`,
  `${JSON.stringify(changeReport, null, 2)}\n`,
);
console.log(JSON.stringify(changeReport, null, 2));
