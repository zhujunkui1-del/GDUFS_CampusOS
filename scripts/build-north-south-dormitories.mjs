// Owner-authorized thirteen-building review batch. Approved south-7/public GIS stay read-only.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
  Shape,
  Path,
  Vector2,
  Vector3,
  Matrix4,
  Quaternion,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  InstancedMesh,
  BoxGeometry,
  PlaneGeometry,
  DoubleSide,
  Box3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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
const folder = "docs/model-previews/north-south-dormitories-v1",
  sha = (b) => createHash("sha256").update(b).digest("hex");
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8")),
  campus = JSON.parse(
    await readFile("src/features/campus-map/data/campus.json", "utf8"),
  ),
  native7 = JSON.parse(
    await readFile("src/features/campus-map/data/nanyuan7-model.json", "utf8"),
  );
if (campus.mapVersion !== design.sourceMapVersion)
  throw new Error("Review campus version.");
const template = JSON.parse(
    await readFile("docs/model-previews/nanyuan7-v2/design.json", "utf8"),
  ),
  approved = JSON.parse(
    await readFile("docs/model-previews/nanyuan7-v2/manifest.json", "utf8"),
  ),
  approvedBinary = await readFile(
    "docs/model-previews/nanyuan7-v2/nanyuan7-v2.glb",
  );
if (
  sha(approvedBinary) !== design.approvedSouth7Sha256 ||
  approved.asset.sha256 !== design.approvedSouth7Sha256
)
  throw new Error("Approved south-7 model changed.");
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const signedArea = (r) =>
  r.reduce((s, p, i) => s + cross(p, r[(i + 1) % r.length]), 0) / 2;
const simplify = (r) =>
  r.filter((b, i) => {
    const a = r[(i + r.length - 1) % r.length],
      c = r[(i + 1) % r.length];
    return (
      Math.abs(cross([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]])) /
        Math.hypot(c[0] - a[0], c[1] - a[1]) >
      0.04
    );
  });
function edges(r, inner = false) {
  const sign = Math.sign(signedArea(r)) * (inner ? -1 : 1);
  return r.map((a, i) => {
    const b = r[(i + 1) % r.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    return {
      a,
      b,
      dx,
      dz,
      length,
      normal: [(sign * dz) / length, (-sign * dx) / length],
    };
  });
}
function inset(r, amount, inner = false) {
  const all = edges(r, inner);
  return r.map((p, i) => {
    const a = all[(i + all.length - 1) % all.length],
      b = all[i],
      p1 = [p[0] - a.normal[0] * amount, p[1] - a.normal[1] * amount],
      p2 = [p[0] - b.normal[0] * amount, p[1] - b.normal[1] * amount],
      den = cross([a.dx, a.dz], [b.dx, b.dz]);
    if (Math.abs(den) < 0.001)
      return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const t = cross([p2[0] - p1[0], p2[1] - p1[1]], [b.dx, b.dz]) / den;
    return [p1[0] + a.dx * t, p1[1] + a.dz * t];
  });
}
function contains(r, [x, z]) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i],
      b = r[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
function placeData(key) {
  const name =
      key[0] === "n" ? `北苑${key.slice(1)}栋` : `南苑${key.slice(1)}栋`,
    place = campus.places.find((p) => p.name === name);
  if (!place?.geometry) throw new Error(`Missing ${name}`);
  const origin = MercatorCoordinate.fromLngLat(place.coordinate),
    units = origin.meterInMercatorCoordinateUnits(),
    local = (a) => {
      const q = MercatorCoordinate.fromLngLat(a);
      return [(q.x - origin.x) / units, (q.y - origin.y) / units];
    },
    sourceOuter = place.geometry.slice(0, -1).map(local),
    outer = simplify(sourceOuter),
    vertical = edges(outer)
      .filter(
        (e) => Math.abs(e.dz) > 14 && Math.abs(e.dx) < Math.abs(e.dz) * 0.12,
      )
      .map((e) => ({
        x: (e.a[0] + e.b[0]) / 2,
        z0: Math.min(e.a[1], e.b[1]),
        z1: Math.max(e.a[1], e.b[1]),
      })),
    pairs = [];
  for (const a of vertical)
    for (const b of vertical) {
      const z0 = Math.max(a.z0, b.z0),
        z1 = Math.min(a.z1, b.z1);
      if (b.x - a.x > 28 && z1 - z0 > 12)
        pairs.push({
          left: a.x,
          right: b.x,
          z0,
          z1,
          score: (b.x - a.x) * (z1 - z0),
        });
    }
  pairs.sort((a, b) => b.score - a.score);
  if (!pairs.length) throw new Error(`Review ${name} courtyard neck`);
  return {
    key,
    place,
    origin,
    units,
    local,
    sourceOuter,
    outer,
    neck: pairs[0],
  };
}
const reference = placeData("s7"),
  refCourt = native7.geometry.coordinates[1].slice(0, -1).map(reference.local),
  margins = {
    left: Math.min(...refCourt.map((p) => p[0])) - reference.neck.left,
    right: reference.neck.right - Math.max(...refCourt.map((p) => p[0])),
    north: Math.min(...refCourt.map((p) => p[1])) - reference.neck.z0,
    south: reference.neck.z1 - Math.max(...refCourt.map((p) => p[1])),
  };
const records = design.buildingKeys.map((key) => {
  const d = placeData(key),
    n = d.neck;
  d.court =
    key === "s7"
      ? refCourt
      : rect(
          n.left + margins.left,
          n.z0 + margins.north,
          n.right - margins.right,
          n.z1 - margins.south,
        );
  if (d.court.some((p) => !contains(d.sourceOuter, p)))
    throw new Error(`Court leaves ${d.place.name}`);
  return d;
});
if (
  records.length !== 13 ||
  new Set(records.map((d) => d.place.id)).size !== 13
)
  throw new Error("Review 13 building set.");
const batchDesign = design;
function createDetailed(data) {
  const design = {
    ...template,
    version: batchDesign.version,
    levels: 7,
    heightMeters: 21,
    heightAccuracy: "template_visual_estimate",
  };
  const outer = data.outer,
    court = data.court;
  const scene = new Scene();
  scene.name = data.place.name + " · 南苑7栋V2样式";
  const palette = {
    ivory: "#e8e5dc",
    brick: "#be8873",
    roof: "#d5d2c8",
    glass: "#627176",
    metal: "#78807e",
  };
  const materials = Object.fromEntries(
    Object.entries(palette).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: 0.93,
        metalness: name === "metal" ? 0.12 : 0,
      });
      material.name = name;
      if (name === "metal") material.side = DoubleSide;
      return [name, material];
    }),
  );
  const instances = new Map();
  function instance(material, type, dimensions, position, angle = 0) {
    if (material === "door") material = "glass";
    const key = material + ":" + type;
    if (!instances.has(key)) instances.set(key, []);
    instances
      .get(key)
      .push(
        new Matrix4().compose(
          new Vector3(...position),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
          new Vector3(...dimensions),
        ),
      );
  }
  function extrusion(exterior, interior, base, height) {
    const shape = new Shape(exterior.map(([x, z]) => new Vector2(x, -z)));
    shape.holes.push(new Path(interior.map(([x, z]) => new Vector2(x, -z))));
    const g = new ExtrudeGeometry(shape, {
      depth: height,
      steps: 1,
      bevelEnabled: false,
      curveSegments: 1,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, base, 0);
    return g;
  }
  const rise = (design.heightMeters - 0.48) / design.levels;
  const roofBase = rise * design.levels;
  const floorGeometry = extrusion(outer, court, 0, 0.16);
  const floors = new InstancedMesh(
    floorGeometry,
    materials.ivory,
    design.levels,
  );
  for (let i = 0; i < design.levels; i++)
    floors.setMatrixAt(i, new Matrix4().makeTranslation(0, i * rise + 0.06, 0));
  floors.name = "seven-floor-slabs";
  scene.add(floors);
  const core = new Mesh(
    extrusion(
      inset(outer, design.galleryDepthMeters),
      inset(court, design.galleryDepthMeters, true),
      0.1,
      roofBase - 0.1,
    ),
    materials.ivory,
  );
  core.name = "recessed-room-volume";
  scene.add(core);
  const roof = new Mesh(
    extrusion(inset(outer, -0.25), court, roofBase, 0.25),
    materials.roof,
  );
  roof.name = "flat-overhanging-roof";
  scene.add(roof);

  function facade(ring, inner) {
    for (const edge of edges(ring, inner)) {
      const {
        a,
        dx,
        dz,
        length,
        normal: [nx, nz],
      } = edge;
      const angle = Math.atan2(nx, nz);
      const at = (t, y, offset = 0) => [
        a[0] + dx * t + nx * offset,
        y,
        a[1] + dz * t + nz * offset,
      ];
      const gable =
        !inner &&
        Math.abs(dx) < Math.abs(dz) * 0.3 &&
        length < 12 &&
        length > 5;
      const towers = gable
        ? [{ center: length / 2, width: length }]
        : !inner && length > 35
          ? [0.17, 0.5, 0.83].map((t) => ({
              center: length * t,
              width: design.stairWallWidthMeters,
            }))
          : !inner && length >= 14
            ? [{ center: length / 2, width: design.stairWallWidthMeters }]
            : inner && Math.abs(dx) < Math.abs(dz)
              ? [{ center: length * 0.82, width: 2.8 }]
              : [];
      for (const tower of towers) {
        const t = tower.center / length;
        instance(
          "brick",
          "box",
          [tower.width, roofBase, design.galleryDepthMeters + 0.2],
          at(t, roofBase / 2 + 0.05, -design.galleryDepthMeters / 2 + 0.04),
          angle,
        );
        for (let floor = 0; floor < design.levels; floor++) {
          const y = floor * rise + 1.45;
          for (const side of [-1, 1])
            instance(
              "glass",
              "plane",
              [0.86, 0.68, 1],
              at(t + (side * 0.72) / length, y, 0.155),
              angle,
            );
        }
      }
      if (gable) continue;
      const bays = Math.max(1, Math.round(length / design.baySpacingMeters));
      const insideTower = (distance, margin = 0) =>
        towers.some(
          (tower) =>
            Math.abs(distance - tower.center) < tower.width / 2 + margin,
        );
      for (let bay = 0; bay <= bays; bay++) {
        const t = bay / bays;
        if (!insideTower(t * length, 0.1))
          instance(
            "ivory",
            "box",
            [0.34, roofBase, 0.4],
            at(t, roofBase / 2 + 0.06, -0.05),
            angle,
          );
      }
      for (let floor = 0; floor < design.levels; floor++) {
        const y = floor * rise;
        instance(
          "ivory",
          "box",
          [length, 0.38, 0.16],
          at(0.5, y + 0.38, 0),
          angle,
        );
        // Two thin double-sided bands read as rails at map scale without tube/picket meshes.
        for (const railHeight of [0.78, 1.05])
          instance(
            "metal",
            "plane",
            [length, 0.065, 1],
            at(0.5, y + railHeight, 0.055),
            angle,
          );
        for (let bay = 0; bay < bays; bay++) {
          const t = (bay + 0.5) / bays;
          if (insideTower(t * length, 0.4)) continue;
          instance(
            "door",
            "plane",
            [0.72, 1.93, 1],
            at(t - 0.92 / length, y + 1.17, -design.galleryDepthMeters + 0.024),
            angle,
          );
          instance(
            "glass",
            "plane",
            [1.26, 1.06, 1],
            at(t + 0.65 / length, y + 1.47, -design.galleryDepthMeters + 0.026),
            angle,
          );
        }
      }
      instance(
        "ivory",
        "box",
        [length, 0.22, 0.5],
        at(0.5, roofBase + 0.12, 0.06),
        angle,
      );
      instance(
        "metal",
        "plane",
        [length, 0.18, 1],
        at(0.5, design.heightMeters - 0.09, -0.08),
        angle,
      );
    }
  }
  facade(outer, false);
  facade(court, true);
  // A compact entrance canopy is a display motif; it is not a surveyed navigation entrance.
  const south = edges(outer)
    .filter((e) => e.normal[1] > 0.8)
    .sort((a, b) => b.length - a.length)[0];
  if (south) {
    const cx = south.a[0] + south.dx * 0.5,
      cz = south.a[1] + south.dz * 0.5;
    instance("ivory", "box", [4.4, 0.12, 1.9], [cx, 2.38, cz + 0.9]);
    for (const side of [-1, 1])
      instance(
        "ivory",
        "box",
        [0.08, 2.3, 0.08],
        [cx + side * 1.8, 1.15, cz + 1.55],
      );
  }
  for (const [key, matrices] of instances) {
    const [material, type] = key.split(":");
    const mesh = new InstancedMesh(
      type === "box" ? new BoxGeometry(1, 1, 1) : new PlaneGeometry(1, 1),
      materials[material],
      matrices.length,
    );
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.name = key;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  scene.userData = {
    modelVersion: design.version,
    levels: design.levels,
    heightAccuracy: design.heightAccuracy,
    appearanceAccuracy: design.appearanceAccuracy,
    mapIntegrated: false,
  };
  scene.updateMatrixWorld(true);
  scene.userData.placeId = data.place.id;
  scene.userData.levelsSource = batchDesign.levelsSource;
  return scene;
}

function createVolume(data) {
  const scene = new Scene();
  scene.name = `${data.place.name}-2.5d`;
  const mat = new MeshStandardMaterial({ color: "#e8e5dc", roughness: 0.93 }),
    roofMat = new MeshStandardMaterial({ color: "#d5d2c8", roughness: 0.93 });
  mat.name = "ivory";
  roofMat.name = "roof";
  const ring = new Shape(data.sourceOuter.map(([x, z]) => new Vector2(x, -z)));
  ring.holes.push(new Path(data.court.map(([x, z]) => new Vector2(x, -z))));
  const extrusion = (base, h) => {
    const g = new ExtrudeGeometry(ring, {
      depth: h,
      steps: 1,
      bevelEnabled: false,
      curveSegments: 1,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, base, 0);
    return g;
  };
  scene.add(
    new Mesh(extrusion(0, 20.75), mat),
    new Mesh(extrusion(20.75, 0.25), roofMat),
  );
  scene.userData = {
    modelVersion: design.version,
    levels: 7,
    heightMeters: 21,
    heightAccuracy:
      data.key === "s7" ? "owner_approximation" : "template_visual_estimate",
    mapIntegrated: false,
    placeId: data.place.id,
  };
  scene.updateMatrixWorld(true);
  return scene;
}
function materialKey(m) {
  return JSON.stringify([
    m.name,
    m.color.getHexString(),
    m.roughness,
    m.metalness,
    m.side,
    m.opacity,
    m.transparent,
  ]);
}
function geometryKey(g) {
  const h = createHash("sha256");
  for (const name of ["position", "normal", "uv"]) {
    const a = g.attributes[name];
    h.update(name);
    if (!a) continue;
    const values = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < a.itemSize; j++)
        values[i * a.itemSize + j] = a.getComponent(i, j);
    h.update(Buffer.from(values.buffer));
  }
  if (g.index) {
    const values = Uint32Array.from(g.index.array);
    h.update(Buffer.from(values.buffer));
  }
  return h.digest("hex");
}
function combined(keys, scenes) {
  const scene = new Scene(),
    statics = new Map(),
    instances = new Map(),
    materials = new Map(),
    shared = reference.origin,
    sharedUnits = reference.units;
  scene.name = "南北苑宿舍-真实位置组合";
  for (const d of records.filter((d) => keys.includes(d.key))) {
    const offset = new Matrix4().compose(
        new Vector3(
          (d.origin.x - shared.x) / sharedUnits,
          0,
          (d.origin.y - shared.y) / sharedUnits,
        ),
        new Quaternion(),
        new Vector3(d.units / sharedUnits, 1, d.units / sharedUnits),
      ),
      source = scenes[d.key];
    source.updateMatrixWorld(true);
    source.traverse((node) => {
      if (!node.isMesh) return;
      const mk = materialKey(node.material);
      if (!materials.has(mk)) materials.set(mk, node.material);
      const world = new Matrix4().multiplyMatrices(offset, node.matrixWorld);
      if (node.isInstancedMesh) {
        const k = mk + ":" + geometryKey(node.geometry);
        if (!instances.has(k))
          instances.set(k, {
            geometry: node.geometry,
            material: materials.get(mk),
            matrices: [],
            owners: [],
          });
        const bucket = instances.get(k),
          start = bucket.matrices.length;
        for (let i = 0; i < node.count; i++) {
          const local = new Matrix4();
          node.getMatrixAt(i, local);
          bucket.matrices.push(new Matrix4().multiplyMatrices(world, local));
        }
        bucket.owners.push({ start, count: node.count, placeId: d.place.id });
      } else {
        if (!statics.has(mk)) statics.set(mk, []);
        const g = node.geometry.index
          ? node.geometry.toNonIndexed()
          : node.geometry.clone();
        g.applyMatrix4(world);
        statics.get(mk).push(g);
      }
    });
  }
  for (const [mk, geometries] of statics) {
    const g = mergeGeometries(geometries),
      mesh = new Mesh(g, materials.get(mk));
    mesh.name = `${mesh.material.name}-merged-static`;
    scene.add(mesh);
  }
  for (const bucket of instances.values()) {
    const mesh = new InstancedMesh(
      bucket.geometry,
      bucket.material,
      bucket.matrices.length,
    );
    bucket.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = `${bucket.material.name}-shared-instances`;
    mesh.userData.instanceOwnerRanges = bucket.owners;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  scene.userData = {
    modelVersion: design.version,
    levels: 7,
    heightAccuracy: "template_visual_estimate",
    placeIds: records
      .filter((d) => keys.includes(d.key))
      .map((d) => d.place.id),
    mapIntegrated: false,
  };
  scene.updateMatrixWorld(true);
  return scene;
}
function stats(scene) {
  let triangles = 0,
    drawCalls = 0;
  const mats = new Set(),
    bounds = new Box3(),
    matrix = new Matrix4(),
    instance = new Matrix4(),
    v = new Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position;
    triangles +=
      ((node.geometry.index?.count ?? p.count) / 3) *
      (node.isInstancedMesh ? node.count : 1);
    drawCalls++;
    mats.add(node.material.name);
    for (let i = 0; i < (node.isInstancedMesh ? node.count : 1); i++) {
      if (node.isInstancedMesh) {
        node.getMatrixAt(i, instance);
        matrix.multiplyMatrices(node.matrixWorld, instance);
      } else matrix.copy(node.matrixWorld);
      for (let j = 0; j < p.count; j++)
        bounds.expandByPoint(v.fromBufferAttribute(p, j).applyMatrix4(matrix));
    }
  });
  return {
    triangles,
    drawCalls,
    materialCount: mats.size,
    textureCount: 0,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
}
await mkdir(`${folder}/models`, { recursive: true });
const scenes = { "2.5d": {}, "3d": {} },
  assets = {},
  exporter = new GLTFExporter();
async function save(key, mode, scene, origin, individual) {
  const file = `models/${key}-${mode}.glb`;
  let binary;
  if (key === "s7" && mode === "3d") {
    await copyFile(
      "docs/model-previews/nanyuan7-v2/nanyuan7-v2.glb",
      `${folder}/${file}`,
    );
    binary = approvedBinary;
  } else {
    binary = Buffer.from(
      await exporter.parseAsync(scene, {
        binary: true,
        copyright:
          "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS procedural geometry derived from the approved south-7 V2 style. Owner confirmed seven floors for north1-6/south7-13 on 2026-11-01. Other metric heights and visual courtyard dimensions are template estimates. No photograph textures or verified interior plans.",
      }),
    );
    await writeFile(`${folder}/${file}`, binary);
  }
  const s = stats(scene),
    budget = individual ? design.performance.single : design.performance.group;
  if (
    s.triangles > budget.triangles ||
    s.drawCalls > budget.drawCalls ||
    binary.length > budget.bytes
  )
    throw new Error(
      `${key}/${mode} exceeds review budget: ${JSON.stringify(s)} / ${binary.length}`,
    );
  return {
    url: `./${file}`,
    sha256: sha(binary),
    bytes: binary.length,
    ...s,
    origin,
    reusedApprovedAsset: key === "s7" && mode === "3d",
  };
}
for (const d of records) {
  scenes["2.5d"][d.key] = createVolume(d);
  scenes["3d"][d.key] =
    d.key === "s7"
      ? (
          await new GLTFLoader().parseAsync(
            approvedBinary.buffer.slice(
              approvedBinary.byteOffset,
              approvedBinary.byteOffset + approvedBinary.byteLength,
            ),
            "",
          )
        ).scene
      : createDetailed(d);
  assets[d.key] = {};
  for (const mode of ["2.5d", "3d"])
    assets[d.key][mode] = await save(
      d.key,
      mode,
      scenes[mode][d.key],
      d.place.coordinate,
      true,
    );
}
const groups = {
  all: records.map((d) => d.key),
  north: records.filter((d) => d.key[0] === "n").map((d) => d.key),
  south: records.filter((d) => d.key[0] === "s").map((d) => d.key),
};
for (const [key, keys] of Object.entries(groups)) {
  assets[key] = {};
  for (const mode of ["2.5d", "3d"])
    assets[key][mode] = await save(
      key,
      mode,
      combined(keys, scenes[mode]),
      reference.place.coordinate,
      false,
    );
}
const toWgs = (d, [x, z]) => {
    const p = new MercatorCoordinate(
      d.origin.x + x * d.units,
      d.origin.y + z * d.units,
    ).toLngLat();
    return [p.lng, p.lat];
  },
  closed = (d, r) => [...r.map((p) => toWgs(d, p)), toWgs(d, r[0])];
const entries = {};
for (const d of records) {
  entries[d.key] = {
    key: d.key,
    name: d.place.name,
    placeId: d.place.id,
    levels: 7,
    heightMeters: 21,
    heightAccuracy:
      d.key === "s7" ? "owner_approximation" : "template_visual_estimate",
    origin: d.place.coordinate,
    sourceGeometryWgs84: d.place.geometry,
    sourceFootprintSha256: sha(JSON.stringify(d.place.geometry)),
    sourceAreaMeters2: Math.abs(signedArea(d.sourceOuter)),
    displayOuterLocalMeters: d.outer,
    courtyardLocalMeters: d.court,
    courtyardWgs84: closed(d, d.court),
    courtyardAccuracy:
      d.key === "s7"
        ? "approved_existing_visual_approximation"
        : "photo_and_template_approximation_not_GIS",
    variant:
      d.key === "s8"
        ? "enclosed_court_plus_open_outer_recess"
        : ["s12", "s13"].includes(d.key)
          ? "asymmetric_extended_wing"
          : "enclosed_courtyard",
    assets: assets[d.key],
  };
}
for (const [key, keys] of Object.entries(groups))
  entries[key] = {
    key,
    name:
      key === "all"
        ? "南北苑13栋"
        : key === "north"
          ? "北苑1—6栋"
          : "南苑7—13栋",
    buildingKeys: keys,
    origin: reference.place.coordinate,
    assets: assets[key],
  };
const geojson = {
  type: "FeatureCollection",
  stage: "visual_review_only_not_navigation_GIS",
  features: records.map((d) => ({
    type: "Feature",
    id: `dormitory-review-${d.key}`,
    properties: {
      placeId: d.place.id,
      name: d.place.name,
      levels: 7,
      height: 21,
      heightAccuracy: entries[d.key].heightAccuracy,
      courtyardAccuracy: entries[d.key].courtyardAccuracy,
      approvedForMap: false,
    },
    geometry: {
      type: "Polygon",
      coordinates: [d.place.geometry, closed(d, d.court)],
    },
  })),
};
await writeFile(
  `${folder}/dormitories-2.5d.geojson`,
  JSON.stringify(geojson, null, 2) + "\n",
);
const manifest = {
  modelVersion: design.version,
  stage: "standalone_visual_review",
  mapIntegrated: false,
  sourceMapVersion: campus.mapVersion,
  buildingCount: 13,
  individualAssetCount: 26,
  combinedAssetCount: 6,
  levels: 7,
  levelsSource: design.levelsSource,
  approvedSouth7Sha256: design.approvedSouth7Sha256,
  courtyardTemplateMarginsMeters: margins,
  allGroupOrigin: reference.place.coordinate,
  entries,
  individualBuildingKeys: records.map((d) => d.key),
  groups,
  geometryAndPhotographSources: design.references,
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      buildingCount: 13,
      assets: Object.fromEntries(
        Object.entries(entries).map(([k, e]) => [
          k,
          Object.fromEntries(
            Object.entries(e.assets).map(([mode, a]) => [
              mode,
              {
                bytes: a.bytes,
                triangles: a.triangles,
                drawCalls: a.drawCalls,
              },
            ]),
          ),
        ]),
      ),
    },
    null,
    2,
  ),
);
