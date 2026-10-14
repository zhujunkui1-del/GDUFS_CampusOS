// Standalone second draft: output goes to docs, never the map's public assets or manifest.
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
};
const folder = "docs/model-previews/nanyuan7-v2";
const design = JSON.parse(await readFile(folder + "/design.json", "utf8"));
const v1 = JSON.parse(
  await readFile("src/features/campus-map/data/nanyuan7-model.json", "utf8"),
);
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (
  !place?.geometry ||
  JSON.stringify(place.geometry) !== JSON.stringify(v1.geometry.coordinates[0])
)
  throw new Error(
    "Footprint changed; review before generating the standalone draft.",
  );
const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const units = origin.meterInMercatorCoordinateUnits();
const local = (p) => {
  const m = MercatorCoordinate.fromLngLat(p);
  return [(m.x - origin.x) / units, (m.y - origin.y) / units];
};
const sourceOuter = place.geometry.slice(0, -1).map(local);
const court = v1.geometry.coordinates[1].slice(0, -1).map(local);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const signedArea = (ring) =>
  ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0) /
  2;
// Remove only near-collinear redundant display vertices, never edit source GIS.
const outer = sourceOuter.filter((b, i) => {
  const a = sourceOuter[(i + sourceOuter.length - 1) % sourceOuter.length];
  const c = sourceOuter[(i + 1) % sourceOuter.length];
  return (
    Math.abs(cross([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]])) /
      Math.hypot(c[0] - a[0], c[1] - a[1]) >
    0.04
  );
});
function edges(ring, inner = false) {
  const sign = Math.sign(signedArea(ring)) * (inner ? -1 : 1);
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0],
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
// Positive amount offsets inward for an outer ring; outward for a courtyard ring.
function inset(ring, amount, inner = false) {
  const all = edges(ring, inner);
  return ring.map((p, i) => {
    const a = all[(i + all.length - 1) % all.length],
      b = all[i];
    const p1 = [p[0] - a.normal[0] * amount, p[1] - a.normal[1] * amount];
    const p2 = [p[0] - b.normal[0] * amount, p[1] - b.normal[1] * amount];
    const den = cross([a.dx, a.dz], [b.dx, b.dz]);
    if (Math.abs(den) < 0.001)
      return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const t = cross([p2[0] - p1[0], p2[1] - p1[1]], [b.dx, b.dz]) / den;
    return [p1[0] + a.dx * t, p1[1] + a.dz * t];
  });
}
const scene = new Scene();
scene.name = "南苑7栋 · V2";
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
const floors = new InstancedMesh(floorGeometry, materials.ivory, design.levels);
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
      !inner && Math.abs(dx) < Math.abs(dz) * 0.3 && length < 12 && length > 5;
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
        (tower) => Math.abs(distance - tower.center) < tower.width / 2 + margin,
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
let triangles = 0,
  drawCalls = 0;
scene.traverse((node) => {
  if (!node.isMesh) return;
  triangles +=
    ((node.geometry.index?.count ?? node.geometry.attributes.position.count) /
      3) *
    (node.isInstancedMesh ? node.count : 1);
  drawCalls++;
});
const binary = Buffer.from(
  await new GLTFExporter().parseAsync(scene, {
    binary: true,
    copyright:
      "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified geometry. Supplied photos used as visual references only; no image textures.",
  }),
);
const hash = createHash("sha256").update(binary).digest("hex");
if (
  triangles > design.performance.triangleBudget ||
  drawCalls > design.performance.modelDrawCallBudget ||
  binary.length > design.performance.glbByteBudget
)
  throw new Error(
    `Pilot budget exceeded: ${triangles} triangles / ${drawCalls} draws / ${binary.length} bytes`,
  );
await mkdir(folder, { recursive: true });
// Draft URL is stable and served with no-store; the manifest records the exact hash.
const file = "nanyuan7-v2.glb";
await writeFile(folder + "/" + file, binary);
const bounds = new Box3().setFromObject(scene);
const manifest = {
  modelVersion: design.version,
  stage: "standalone_review_only",
  mapIntegrated: false,
  placeId: place.id,
  sourceMapVersion: v1.mapVersion,
  origin: place.coordinate,
  footprintSha256: createHash("sha256")
    .update(JSON.stringify(place.geometry))
    .digest("hex"),
  levels: design.levels,
  heightMeters: design.heightMeters,
  heightAccuracy: design.heightAccuracy,
  appearanceAccuracy: design.appearanceAccuracy,
  bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  courtyard: {
    min: [
      Math.min(...court.map((p) => p[0])),
      Math.min(...court.map((p) => p[1])),
    ],
    max: [
      Math.max(...court.map((p) => p[0])),
      Math.max(...court.map((p) => p[1])),
    ],
    accuracy: "visual_approximation",
  },
  asset: {
    url: "./" + file,
    sha256: hash,
    bytes: binary.length,
    triangles,
    drawCalls,
    materialCount: Object.keys(materials).length,
    textureCount: 0,
  },
};
await writeFile(
  folder + "/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
