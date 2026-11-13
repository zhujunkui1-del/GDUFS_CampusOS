// Build an image-free academic exchange center model from its canonical OSM relation rings.
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
  BufferGeometry,
  Float32BufferAttribute,
  ShapeGeometry,
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
      .then((result) => {
        this.result = result;
        this.onloadend?.();
      })
      .catch((error) => (this.onerror = error));
  }
};

const out = "docs/model-previews/academic-exchange-center-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((item) => item.name === "学术交流中心");
if (!place || place.id !== "osm-relation-4105910" || !place.geometryRings)
  throw new Error("Canonical academic exchange center relation is missing.");
if (campus.mapVersion !== "s1-2026-10-14.2")
  throw new Error(`Review source map version ${campus.mapVersion}.`);
if (JSON.stringify(place.geometryRings[0]) !== JSON.stringify(place.geometry))
  throw new Error("Relation outer ring differs from the picked place geometry.");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const meterUnits = origin.meterInMercatorCoordinateUnits();
const toLocal = ([lng, lat]) => {
  const q = MercatorCoordinate.fromLngLat([lng, lat]);
  return [(q.x - origin.x) / meterUnits, (q.y - origin.y) / meterUnits];
};
const ringsWgs84 = place.geometryRings;
const localRings = ringsWgs84.map((ring) => ring.slice(0, -1).map(toLocal));
const [outer, ...holes] = localRings;
if (outer.length !== 28 || holes.length !== 2)
  throw new Error(`Expected one 28-vertex outer ring and two courtyard rings; got ${outer.length}/${holes.length}.`);
const ringHashes = ringsWgs84.map((ring) => hash(JSON.stringify(ring)));

const facadeLevels = 4;
const floorRise = 3.5;
const eaves = 14.75;
const roofPeak = 18.1;
const colors = {
  wall: "#e8e5dc",
  band: "#c47762",
  trim: "#dedbd3",
  glass: "#617983",
  metal: "#87918f",
  roof: "#727875",
  cap: "#d5d2c8",
};

const signedArea = (ring) =>
  ring.reduce((sum, a, index) => {
    const b = ring[(index + 1) % ring.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const pointInside = (point, ring) => {
  const [x, z] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};
const pointInsideComplex = (point) =>
  pointInside(point, outer) && !holes.some((ring) => pointInside(point, ring));
const rectangle = (x0, x1, z0, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
function makeShape(exterior, innerRings = []) {
  const shape = new Shape(exterior.map(([x, z]) => new Vector2(x, -z)));
  for (const ring of innerRings)
    shape.holes.push(new Path(ring.map(([x, z]) => new Vector2(x, -z))));
  return shape;
}
function extrude(exterior, base, depth, innerRings = []) {
  const geometry = new ExtrudeGeometry(makeShape(exterior, innerRings), {
    depth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  return geometry;
}
function triangleGeometry(vertices) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
function verticalWallShell(rings, bottom, top) {
  const vertices = [];
  const triangle = (a, b, c) => vertices.push(...a, ...b, ...c);
  for (const ring of rings)
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const a0 = [a[0], bottom, a[1]];
      const b0 = [b[0], bottom, b[1]];
      const b1 = [b[0], top, b[1]];
      const a1 = [a[0], top, a[1]];
      triangle(a0, b0, b1);
      triangle(a0, b1, a1);
    }
  return triangleGeometry(vertices);
}
function roofDeck(exterior, interiorRings, height) {
  const shape = new Shape(exterior.map(([x, z]) => new Vector2(x, -z)));
  for (const ring of interiorRings)
    shape.holes.push(new Path(ring.map(([x, z]) => new Vector2(x, -z))));
  const geometry = new ShapeGeometry(shape, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height, 0);
  return geometry;
}
function hipRoof([x0, x1, z0, z1], eave, peak) {
  const vertices = [];
  const tri = (a, b, c) => vertices.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  const dx = x1 - x0;
  const dz = z1 - z0;
  if (dx >= dz) {
    const mid = (z0 + z1) / 2;
    const run = dz / 2;
    const r0 = [x0 + run, peak, mid];
    const r1 = [x1 - run, peak, mid];
    quad([x0, eave, z1], [x1, eave, z1], r1, r0);
    quad([x1, eave, z0], [x0, eave, z0], r0, r1);
    tri([x0, eave, z0], [x0, eave, z1], r0);
    tri([x1, eave, z1], [x1, eave, z0], r1);
  } else {
    const mid = (x0 + x1) / 2;
    const run = dx / 2;
    const r0 = [mid, peak, z0 + run];
    const r1 = [mid, peak, z1 - run];
    quad([x0, eave, z0], [x0, eave, z1], r1, r0);
    quad([x1, eave, z1], [x1, eave, z0], r0, r1);
    tri([x1, eave, z0], [x0, eave, z0], r0);
    tri([x0, eave, z1], [x1, eave, z1], r1);
  }
  return triangleGeometry(vertices);
}
function createMaterials(palette = colors) {
  return Object.fromEntries(
    Object.entries(palette).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: name === "glass" ? 0.56 : name === "metal" ? 0.75 : 0.9,
        metalness: name === "metal" ? 0.12 : 0,
      });
      material.name = name;
      return [name, material];
    }),
  );
}
function makeBuckets() {
  return new Map();
}
function addInstance(buckets, material, type, size, position, angle = 0) {
  const key = `${material}:${type}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(
    new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
      new Vector3(...size),
    ),
  );
}
function addBatches(scene, materials, buckets) {
  for (const [key, matrices] of buckets) {
    const [material, type] = key.split(":");
    const mesh = new InstancedMesh(
      type === "plane" ? new PlaneGeometry(1, 1) : new BoxGeometry(1, 1, 1),
      materials[material],
      matrices.length,
    );
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.name = key;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}
function sceneStats(scene, materials) {
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
  let triangles = 0;
  let drawCalls = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position;
    triangles +=
      ((node.geometry.index?.count ?? p.count) / 3) *
      (node.isInstancedMesh ? node.count : 1);
    drawCalls++;
  });
  return {
    triangles: Math.round(triangles),
    drawCalls,
    materialCount: Object.keys(materials).length,
    textureCount: 0,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
}

// Roof bays are aligned to the satellite-visible orthogonal wings and kept inside the exact source rings.
const roofModules = [
  { id: "north-east", box: [24, 57, -39, -21] },
  { id: "north-connector", box: [8, 21, -33, -20] },
  { id: "north-center", box: [-20, 5, -17, -9] },
  { id: "west-wing", box: [-61, -25, -5, 12] },
  { id: "east-wing", box: [44, 54, -6, 5] },
  { id: "south-east", box: [12, 40, 13, 25] },
  { id: "south-west", box: [-32, 2, 24, 34] },
];
for (const roofPart of roofModules) {
  const rect = rectangle(...roofPart.box);
  if (!rect.every(pointInsideComplex))
    throw new Error(`Roof module ${roofPart.id} leaves the source ring or overlaps a courtyard.`);
}

function createMass() {
  const palette = { wall: "#e8e5dc", roof: "#d5d2c8" };
  const materials = createMaterials(palette);
  const scene = new Scene();
  scene.name = "学术交流中心-2.5d-white-mass";
  scene.add(new Mesh(extrude(outer, 0, 15.0, holes), materials.wall));
  scene.add(new Mesh(extrude(outer, 15.0, 0.2, holes), materials.roof));
  for (const roofPart of roofModules)
    scene.add(new Mesh(hipRoof(roofPart.box, 15.1, 17.4), materials.roof));
  scene.userData = {
    modelVersion: "academic-exchange-center-v1-2026-11-13",
    sourcePlaceId: place.id,
    sourceMapVersion: campus.mapVersion,
    sourceOuterHash: hash(JSON.stringify(ringsWgs84[0])),
    sourceRingHashes: ringHashes,
    sourceVertexCount: outer.length,
    mode: "2.5d",
    appearanceStyle: "plain-white-office-mass-with-simplified-hip-roofs",
    levels: facadeLevels,
    heightMeters: 17.4,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    innerCourtyardCount: holes.length,
    imagesEmbedded: false,
    textureCount: 0,
  };
  return { scene, stats: sceneStats(scene, materials) };
}

function createDetailed() {
  const materials = createMaterials();
  materials.wall.side = DoubleSide;
  materials.roof.side = DoubleSide;
  const scene = new Scene();
  scene.name = "学术交流中心-3d";
  const buckets = makeBuckets();
  // Vertical walls + a light top deck retain the relation courtyards without the two unused caps
  // of a closed extrusion; this keeps the full resident 3D model budget below the campus limit.
  scene.add(new Mesh(verticalWallShell([outer, ...holes], 0.15, eaves), materials.wall));
  scene.add(new Mesh(roofDeck(outer, holes, eaves), materials.roof));
  for (const roofPart of roofModules)
    scene.add(new Mesh(hipRoof(roofPart.box, eaves, roofPeak), materials.roof));

  const rings = [outer, ...holes];
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex];
    const isCourtyardEdge = ringIndex > 0;
    const sign = Math.sign(signedArea(ring)) || 1;
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 7.5) continue;
      // Outer faces point away from the building. Courtyard faces point into the courtyard.
      const direction = (isCourtyardEdge ? -1 : 1) * sign;
      const nx = (direction * dz) / length;
      const nz = (-direction * dx) / length;
      const angle = Math.atan2(nx, nz);
      const pointAt = (distance, y, offset = 0) => [
        a[0] + dx * (distance / length) + nx * offset,
        y,
        a[1] + dz * (distance / length) + nz * offset,
      ];
      const bays = Math.max(1, Math.round(length / 11));
      for (let floor = 0; floor < facadeLevels; floor++) {
        const base = floor * floorRise;
        const centerY = base + 1.75;
        // Repeated glass bays are sparse enough for the existing full-catalog map budget.
        for (let bay = 0; bay < bays; bay++) {
          const distance = (length * (bay + 0.5)) / bays;
          const width = Math.min(3.6, length / bays - 0.8);
          addInstance(
            buckets,
            "glass",
            "plane",
            [width, 1.75, 1],
            pointAt(distance, centerY, 0.1),
            angle,
          );
        }
        if (length >= 12)
          addInstance(
            buckets,
            floor % 2 === 0 ? "red" : "trim",
            "plane",
            [length, 0.34, 1],
            pointAt(length / 2, base + 0.82, 0.11),
            angle,
          );
      }
      // Sparse vertical pilasters echo the office/faculty reference facades.
      if (length >= 28) {
        const columns = Math.max(2, Math.floor(length / 15));
        for (let column = 0; column <= columns; column++)
          addInstance(
            buckets,
            "trim",
            "plane",
            [0.24, eaves - 0.2, 1],
            pointAt((column * length) / columns, (eaves - 0.2) / 2, 0.14),
            angle,
          );
      }
    }
  }
  addBatches(scene, materials, buckets);
  scene.userData = {
    modelVersion: "academic-exchange-center-v1-2026-11-13",
    sourcePlaceId: place.id,
    sourceMapVersion: campus.mapVersion,
    sourceOuterHash: hash(JSON.stringify(ringsWgs84[0])),
    sourceRingHashes: ringHashes,
    sourceVertexCount: outer.length,
    facadeLevels,
    heightMeters: roofPeak,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    roofStyle: "hipped-grey-roofs-referenced-from-admin-and-faculty-models",
    innerCourtyardCount: holes.length,
    imagesEmbedded: false,
    textureCount: 0,
  };
  return { scene, stats: sceneStats(scene, materials) };
}

await mkdir(out, { recursive: true });
const assets = {};
for (const mode of ["2.5d", "3d"]) {
  const built = mode === "2.5d" ? createMass() : createDetailed();
  const binary = Buffer.from(
    await new GLTFExporter().parseAsync(built.scene, {
      binary: true,
      trs: false,
      onlyVisible: true,
      copyright:
        "Procedural image-free academic exchange center model from canonical OSM relation rings; style references are internal photographs, heights remain visual estimates.",
    }),
  );
  const file = `academic-exchange-center-${mode}.glb`;
  await writeFile(`${out}/${file}`, binary);
  assets[mode] = { file, sha256: hash(binary), bytes: binary.length, ...built.stats };
}

const manifest = {
  modelVersion: "academic-exchange-center-v1-2026-11-13",
  stage: "map_ready_visual_estimate",
  mapIntegrated: false,
  sourceMapVersion: campus.mapVersion,
  placeId: place.id,
  name: place.name,
  origin: place.coordinate,
  sourceGeometryWgs84: place.geometry,
  sourceGeometryRingsWgs84: ringsWgs84,
  sourceOuterHash: hash(JSON.stringify(ringsWgs84[0])),
  sourceRingHashes: ringHashes,
  ringVertexCounts: ringsWgs84.map((ring) => ring.length - 1),
  orientationBasis: "roof modules aligned to the existing local GIS axes; facade compass direction is unverified",
  levels: facadeLevels,
  levelsSource: "Four-storey office/faculty reference style; visual estimate only, not a source-map level tag.",
  eavesHeightMeters: eaves,
  roofPeakMeters: roofPeak,
  heightAccuracy: "visual_estimate_only_not_surveyed",
  roofModules,
  assets,
  visualInputs: [
    {
      path: "C:/Users/zhuju/Downloads/学术交流中心卫星图.png",
      usage: "top-down roof-module and two-courtyard arrangement reference; compass bearing is not independently verified",
    },
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/校行政办公楼正面99.png",
      usage: "facade material and portico style reference only",
    },
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/院系办公楼正面11.png",
      usage: "pale wall/red accent and window rhythm style reference only",
    },
    {
      path: "docs/model-previews/administration-complex-v1/manifest.json",
      usage: "hipped-roof and pale-wall/red-accent style reference",
    },
    {
      path: "docs/model-previews/faculty-office-v1/manifest.json",
      usage: "four-storey window rhythm and roof style reference",
    },
  ],
  limitations: [
    "The source relation supplies one outer ring and two inner rings; all three are kept unchanged.",
    "Four levels and approximately 18 m are image/reference-style estimates; campus GIS does not carry surveyed height tags.",
    "Roof-module boundaries follow the north-up satellite and are visual subdivisions, not separate GIS buildings.",
    "No facade photo or measured entrance is provided; windows and red bands are simple office-style visual estimates.",
    "Photos are not copied into public assets or embedded as textures.",
  ],
};
await writeFile(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  `${out}/academic-exchange-center-2.5d.geojson`,
  `${JSON.stringify(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { displayOnly: true, sourcePlaceId: place.id },
          geometry: { type: "Polygon", coordinates: ringsWgs84 },
        },
      ],
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  `${out}/design.json`,
  `${JSON.stringify(
    {
      version: manifest.modelVersion,
      sourceMapVersion: manifest.sourceMapVersion,
      placeId: manifest.placeId,
      sourceOuterHash: manifest.sourceOuterHash,
      sourceRingHashes: ringHashes,
      orientationBasis: manifest.orientationBasis,
      levels: facadeLevels,
      eavesHeightMeters: eaves,
      roofPeakMeters: roofPeak,
      heightAccuracy: manifest.heightAccuracy,
      roofModules,
      palette: colors,
      styles: {
        "2.5d": "plain pale mass, exact source courtyard holes and light cap",
        "3d": "administration/faculty pale walls, red bands, window rhythm and hipped grey roof modules",
      },
      assets,
      noEmbeddedImages: true,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify(
    {
      group: place.name,
      placeId: place.id,
      outerVertices: outer.length,
      innerRingVertexCounts: holes.map((ring) => ring.length),
      sourceOuterHash: hash(JSON.stringify(ringsWgs84[0])),
      assets,
    },
    null,
    2,
  ),
);
