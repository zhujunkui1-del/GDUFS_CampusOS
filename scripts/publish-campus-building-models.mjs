// Explicit owner-authorized integration of self-authored geometry; no reference photos are published.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
import {
  Scene,
  InstancedMesh,
  BoxGeometry,
  MeshStandardMaterial,
  Matrix4,
  Vector3,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
const read = async (p) => JSON.parse(await readFile(p, "utf8")),
  sha = (b) => createHash("sha256").update(b).digest("hex"),
  campus = await read("src/features/campus-map/data/campus.json"),
  pilot = await read("src/features/campus-map/data/nanyuan7-model.json"),
  map = await read("src/features/campus-map/data/local-map-manifest.json"),
  out = "public/models/campus";
if (map.version !== campus.mapVersion)
  throw new Error("Campus and source map versions differ");
await mkdir(out, { recursive: true });
const entries = [],
  courts = new Map();
function checkSource(id, geometry) {
  const p = campus.places.find((p) => p.id === id);
  if (!p || JSON.stringify(geometry) !== JSON.stringify(p.geometry))
    throw new Error(`Source mismatch ${id}`);
}
async function asset(root, a, key, mode, preservedUrl) {
  const file = `${root}/${a.url.replace("./", "")}`,
    b = await readFile(file),
    hash = sha(b);
  if (
    hash !== a.sha256 ||
    b.length !== a.bytes ||
    b.toString("utf8", 0, 4) !== "glTF"
  )
    throw new Error(`Asset integrity ${file}`);
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  if (
    json.images?.length ||
    json.textures?.length ||
    json.buffers.some((v) => v.uri)
  )
    throw new Error(`External/image resource ${file}`);
  const name = `${key}-${mode}-${hash.slice(0, 12)}.glb`;
  if (preservedUrl) {
    if (sha(await readFile(`public${preservedUrl}`)) !== hash)
      throw new Error(`Preserved asset mismatch ${key}`);
  } else await copyFile(file, `${out}/${name}`);
  return {
    url: preservedUrl || `/models/campus/${name}`,
    sha256: hash,
    bytes: b.length,
    triangles: a.triangles,
    drawCalls: a.drawCalls,
    bounds: a.bounds,
  };
}
async function add(
  key,
  name,
  id,
  root,
  m,
  assets,
  sourceIds = [id],
  members = [],
  preservedFullUrl,
) {
  if (m.sourceMapVersion !== campus.mapVersion)
    throw new Error(`Map version ${key}`);
  if (id && !campus.places.some((p) => p.id === id))
    throw new Error(`Unknown ${id}`);
  const origin = assets["3d"].origin || m.origin,
    record = {
      key,
      name,
      placeId: id,
      memberPlaceIds: [...new Set([id, ...members].filter(Boolean))],
      footprintSourceIds: sourceIds.filter(Boolean),
      origin,
      pickable: !!id,
      heightAccuracy: m.heightAccuracy || "visual_estimate",
      assets: {},
    };
  for (const mode of ["2.5d", "3d"])
    record.assets[mode] = await asset(
      root,
      assets[mode],
      key,
      mode,
      mode === "3d" ? preservedFullUrl : undefined,
    );
  entries.push(record);
}
async function collectCourts(root, file) {
  try {
    const data = await read(`${root}/${file}`);
    for (const f of data.features)
      if (f.geometry.type === "Polygon")
        for (const ring of f.geometry.coordinates.slice(1)) {
          const key = sha(JSON.stringify(ring));
          if (!courts.has(key))
            courts.set(key, {
              type: "Feature",
              properties: { displayOnly: true },
              geometry: { type: "Polygon", coordinates: [ring] },
            });
        }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const [key, folder, file] of [
  ["library", "library-v1", "library"],
  ["art", "art-building-v1", "art-building"],
  ["auditorium", "auditorium-v1", "auditorium"],
  ["b8", "b8-lecture-hall-v1", "b8-lecture-hall"],
  ["faculty", "faculty-office-v1", "faculty-office"],
  ["gymnasium", "gymnasium-v1", "gymnasium"],
  ["stadium", "stadium-v1", "stadium"],
]) {
  const root = `docs/model-previews/${folder}`,
    m = await read(`${root}/manifest.json`);
  checkSource(m.placeId, m.sourceGeometryWgs84 || m.sourcePlaceGeometryWgs84);
  await add(
    key,
    campus.places.find((p) => p.id === m.placeId).name,
    m.placeId,
    root,
    m,
    m.assets,
    [m.footprintSourceId || m.placeId],
  );
  await collectCourts(root, `${file}-2.5d.geojson`);
}
for (const [key, folder, file] of [
  ["laboratory", "laboratory-a-e-v1", "laboratory-a-e"],
  ["teaching-efg", "teaching-e-f-g-v1", "teaching-e-f-g"],
]) {
  const root = `docs/model-previews/${folder}`,
    m = await read(`${root}/manifest.json`),
    p = campus.places.find((p) => p.id === m.placeId);
  if (
    JSON.stringify(m.sourceGeometryRingsWgs84) !==
    JSON.stringify(p.geometryRings)
  )
    throw new Error(`Parent rings ${key}`);
  const members = campus.places
    .filter((p) => p.parentId === m.placeId)
    .map((p) => p.id);
  await add(key, p.name, p.id, root, m, m.assets, [p.id], members);
  await collectCourts(root, `${file}-2.5d.geojson`);
}
{
  const root = "docs/model-previews/administration-complex-v1",
    m = await read(`${root}/manifest.json`);
  checkSource(m.parentPlaceId, m.sourceParentGeometryWgs84);
  checkSource(m.pavilionPlaceId, m.sourcePavilionGeometryWgs84);
  await add(
    "administration",
    "校行政办公楼",
    m.parentPlaceId,
    root,
    m,
    m.componentAssets.administration,
  );
  await add(
    "pavilion",
    "八角楼",
    m.pavilionPlaceId,
    root,
    m,
    m.componentAssets.pavilion,
  );
  await collectCourts(root, "administration-complex-2.5d.geojson");
}
const teachingRoot = "docs/model-previews/teaching-a-d-v2",
  teaching = await read(`${teachingRoot}/manifest.json`);
for (const key of ["A", "B", "C", "D"]) {
  const s = teaching.sources[key];
  checkSource(s.placeId, s.geometryRingsWgs84[0]);
  await add(
    `teaching-${key}`,
    s.name,
    s.placeId,
    teachingRoot,
    teaching,
    teaching.componentAssets[key],
  );
}
await collectCourts(teachingRoot, "teaching-a-d-2.5d.geojson");
{
  const root = "docs/model-previews/north-south-dormitories-v1",
    m = await read(`${root}/manifest.json`);
  for (const key of m.individualBuildingKeys) {
    const e = m.entries[key];
    checkSource(e.placeId, e.sourceGeometryWgs84);
    if (
      key === "s7" &&
      (e.assets["3d"].sha256 !== pilot.assets.full.sha256 ||
        JSON.stringify(e.origin) !== JSON.stringify(pilot.origin) ||
        JSON.stringify(e.courtyardWgs84) !==
          JSON.stringify(pilot.courtyardGeometry.coordinates[0]))
    )
      throw new Error("South-7 approved geometry mismatch");
    await add(
      `dormitory-${key}`,
      e.name,
      e.placeId,
      root,
      { ...m, origin: e.origin, heightAccuracy: e.heightAccuracy },
      e.assets,
      [e.placeId],
      [],
      key === "s7" ? pilot.assets.full.url : undefined,
    );
    if (key === "s7") continue; // Its existing native courtyard remains the shared ground fill.
    const k = sha(JSON.stringify(e.courtyardWgs84));
    courts.set(k, {
      type: "Feature",
      properties: { displayOnly: true },
      geometry: { type: "Polygon", coordinates: [e.courtyardWgs84] },
    });
  }
}
// These two visual links were already part of the approved A-D draft. Components omit them.
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
const td = await read(`${teachingRoot}/design.json`),
  linkAssets = {};
for (const mode of ["2.5d", "3d"]) {
  const scene = new Scene(),
    buckets = new Map(),
    materials = {
      ivory: new MeshStandardMaterial({
        color: mode === "3d" ? "#e4e5de" : "#dedbd3",
        roughness: 0.9,
      }),
      metal: new MeshStandardMaterial({ color: "#a0aeaf", roughness: 0.9 }),
      roof: new MeshStandardMaterial({
        color: mode === "3d" ? "#737b78" : "#efede6",
        roughness: 0.9,
      }),
    };
  for (const [k, v] of Object.entries(materials)) v.name = k;
  const box = (mat, size, position) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets
      .get(mat)
      .push(new Matrix4().makeScale(...size).setPosition(...position));
  };
  for (const c of td.displayConnectors) {
    const [x, z, w, d] = c.rectMeters;
    for (const y of c.floorDatumsMeters) {
      box("ivory", [w, 0.2, d], [x, y, z]);
      if (mode === "3d")
        for (const dx of [-w / 2, w / 2])
          box("metal", [0.06, 0.95, d], [x + dx, y + 0.6, z]);
    }
    box("roof", [w + 0.15, 0.16, d], [x, 18.2, z]);
  }
  let triangles = 0;
  for (const [mat, matrices] of buckets) {
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      materials[mat],
      matrices.length,
    );
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingBox();
    scene.add(mesh);
    triangles += 12 * matrices.length;
  }
  scene.updateMatrixWorld(true);
  const binary = Buffer.from(
      await new GLTFExporter().parseAsync(scene, {
        binary: true,
        copyright:
          "CampusOS A-D visual connector geometry, reproduced from the owner-reviewed A-D design parameters. Not GIS or navigation paths.",
      }),
    ),
    file = `teaching-links-${mode}-${sha(binary).slice(0, 12)}.glb`;
  await writeFile(`${out}/${file}`, binary);
  let min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  scene.traverse((n) => {
    if (!n.isInstancedMesh) return;
    for (let i = 0; i < n.count; i++) {
      const m = new Matrix4();
      n.getMatrixAt(i, m);
      for (const x of [-0.5, 0.5])
        for (const y of [-0.5, 0.5])
          for (const z of [-0.5, 0.5]) {
            const p = new Vector3(x, y, z).applyMatrix4(m).toArray();
            min = min.map((v, j) => Math.min(v, p[j]));
            max = max.map((v, j) => Math.max(v, p[j]));
          }
    }
  });
  linkAssets[mode] = {
    url: `/models/campus/${file}`,
    sha256: sha(binary),
    bytes: binary.length,
    triangles,
    drawCalls: buckets.size,
    bounds: { min, max },
  };
}
entries.push({
  key: "teaching-links",
  name: "教学楼连接段",
  placeId: null,
  memberPlaceIds: [],
  footprintSourceIds: [],
  origin: teaching.origin,
  pickable: false,
  heightAccuracy: "existing_visual_connector_parameters",
  assets: linkAssets,
});
const courtyardData =
    JSON.stringify({
      type: "FeatureCollection",
      features: [...courts.values()],
    }) + "\n",
  courtyardName = `courtyards-${sha(courtyardData).slice(0, 12)}.geojson`;
await writeFile(`${out}/${courtyardName}`, courtyardData);
const catalog = {
  version: "campus-building-models-2026-11-01.2",
  mapVersion: campus.mapVersion,
  approvedForMap: true,
  ownerApproval: "2026-11-01：现在，把已经做好的这些2.5d/3d模型，放入网页中",
  ownerRenderingCorrection:
    "2026-11-02：3D不随距离/中心位置退回白模，平移保留模型；统一南苑7栋与其他宿舍的2.5D光照",
  referenceOrigin: [113.392, 23.066],
  legacySouth7Preserved: true,
  renderingPolicy: "mode-faithful-resident-models",
  south7VolumeRenderer: "shared",
  displayBuildingCount: 28,
  newBuildingCount: 27,
  visualConnectorCount: 1,
  courtyardsUrl: `/models/campus/${courtyardName}`,
  entries,
};
await writeFile(
  "src/features/campus-map/data/building-model-catalog.json",
  await format(JSON.stringify(catalog), { parser: "json" }),
);
await writeFile(
  `${out}/SOURCE.md`,
  "# CampusOS building models\n\nOwner authorized integration on 2026-11-01 and corrected visibility/rendering on 2026-11-02. Original procedural geometry; no reference photographs, image textures, supplier meshes or external buffer resources. Footprints © OpenStreetMap contributors, ODbL-1.0. Source/approval/hash/origins are recorded in src/features/campus-map/data/building-model-catalog.json and docs/model-previews.\n\nMetric heights and photo-informed courtyard/facade details remain visual approximations, not surveyed GIS or indoor/navigation facts. Original campus map and walking network are unchanged. South-7 keeps its approved public V2 3D file; its unchanged 21-metre footprint/courtyard now uses the same 2.5D material/light path as the other dormitories, with its original native volume retained as a failure fallback. Completed 3D models remain detailed across zoom and pan. A-D uses V2 with the corrected B clock tower. Shared-origin components are already positioned in their GLBs.\n",
);
console.log(
  JSON.stringify(
    {
      buildingCount: catalog.displayBuildingCount,
      newEntries: entries.length,
      files: entries.length * 2,
      courtyards: courts.size,
    },
    null,
    2,
  ),
);
