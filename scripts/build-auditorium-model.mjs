// Independent auditorium display model. Source campus GIS and approved assets are read-only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
  Group,
  Shape,
  Path,
  Vector2,
  Vector3,
  Matrix4,
  Quaternion,
  Box3,
  ExtrudeGeometry,
  BoxGeometry,
  PlaneGeometry,
  CylinderGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  InstancedMesh,
  DoubleSide,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
const folder = "docs/model-previews/auditorium-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (campus.mapVersion !== design.sourceMapVersion || !place?.geometry)
  throw new Error("Review auditorium footprint before regeneration.");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const sourceLocal = place.geometry.slice(0, -1).map((p) => {
  const m = MercatorCoordinate.fromLngLat(p);
  return [(m.x - origin.x) / units, (m.y - origin.y) / units];
});
const anchor = sourceLocal[0];
const phi = Math.atan2(
  sourceLocal[1][1] - anchor[1],
  sourceLocal[1][0] - anchor[0],
);
const frameAngle = -phi,
  cos = Math.cos(phi),
  sin = Math.sin(phi);
const points = sourceLocal.map(([x, z]) => [
  (x - anchor[0]) * cos + (z - anchor[1]) * sin,
  -(x - anchor[0]) * sin + (z - anchor[1]) * cos,
]);
const leftFront = [points[10][0], 0];
const rightFront = [
  points[3][0] +
    ((points[4][0] - points[3][0]) * points[3][1]) /
      (points[3][1] - points[4][1]),
  0,
];
const main = [
  leftFront,
  points[1],
  rightFront,
  points[4],
  points[7],
  points[8],
  points[9],
  points[10],
];
const apron = [points[1], points[2], points[3], rightFront];
const left = [points[0], leftFront, points[10], points[11]];
const right = [points[4], points[5], points[6], points[7]];
const courts = design.courtyardAlignedMeters;
const eaves = design.eavesMeters,
  base = design.baseMeters;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const area = (ring) =>
  ring.reduce((s, p, i) => s + cross(p, ring[(i + 1) % ring.length]), 0) / 2;
function edges(ring) {
  const sign = Math.sign(area(ring));
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length],
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
const at = (e, d, y, offset = 0) => [
  e.a[0] + (e.dx * d) / e.length + e.normal[0] * offset,
  y,
  e.a[1] + (e.dz * d) / e.length + e.normal[1] * offset,
];
const angle = (e) => Math.atan2(e.normal[0], e.normal[1]);
function extrusion(ring, y, height, holes = []) {
  const shape = new Shape(ring.map(([x, z]) => new Vector2(x, -z)));
  for (const hole of holes)
    shape.holes.push(new Path(hole.map(([x, z]) => new Vector2(x, -z))));
  const g = new ExtrudeGeometry(shape, {
    depth: height,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    terracotta: "#bf846c",
    ivory: "#e8e4da",
    silver: "#d1d7d7",
    glazing: "#547889",
    metal: "#9aa6a8",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Auditorium-${mode}-owner-height-scale`;
  const frame = new Group();
  frame.name = "local-east-up-south-frame";
  scene.add(frame);
  const materials = Object.fromEntries(
    Object.entries(palettes[mode]).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: name === "glazing" ? 0.5 : 0.9,
        metalness: name === "silver" ? 0.12 : 0,
      });
      material.name = name;
      if (name === "glazing") material.side = DoubleSide;
      return [name, material];
    }),
  );
  const geometryBuckets = new Map(),
    instances = new Map();
  function geometry(material, g) {
    if (!geometryBuckets.has(material)) geometryBuckets.set(material, []);
    geometryBuckets.get(material).push(g.index ? g.toNonIndexed() : g);
  }
  const shape = (mat, ring, base, height, holes = []) =>
    geometry(mat, extrusion(ring, base, height, holes));
  function piece(mat, type, size, position, bearing = 0) {
    const key = `${mat}:${type}`;
    if (!instances.has(key)) instances.set(key, []);
    instances
      .get(key)
      .push(
        new Matrix4().compose(
          new Vector3(...position),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), bearing),
          new Vector3(...size),
        ),
      );
  }
  const box = (mat, size, position, bearing = 0) =>
    piece(mat, "box", size, position, bearing);
  const plane = (mat, size, position, bearing = 0) =>
    piece(mat, "plane", [size[0], size[1], 1], position, bearing);
  function finish() {
    for (const [mat, all] of geometryBuckets) {
      const g = mergeGeometries(all);
      g.computeVertexNormals();
      const mesh = new Mesh(g, materials[mat]);
      mesh.name = `${mat}-volumes`;
      frame.add(mesh);
    }
    for (const [key, matrices] of instances) {
      const [mat, type] = key.split(":");
      const g =
        type === "box"
          ? new BoxGeometry(1, 1, 1)
          : type === "plane"
            ? new PlaneGeometry(1, 1)
            : new CylinderGeometry(1, 1, 1, 8, 1, true);
      const mesh = new InstancedMesh(g, materials[mat], matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.name = key;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      frame.add(mesh);
    }
    scene.userData = {
      modelVersion: design.version,
      mode,
      heightScaleLevels: design.heightScaleLevels,
      interiorLevelsVerified: false,
      heightAccuracy: design.heightAccuracy,
      mapIntegrated: false,
    };
    frame.rotation.y = frameAngle;
    frame.position.set(anchor[0], 0, anchor[1]);
    scene.updateMatrixWorld(true);
    return scene;
  }
  return { geometry, shape, piece, box, plane, finish };
}

function geometryFromTriangles(vertices) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  g.setAttribute(
    "uv",
    new Float32BufferAttribute(new Array((vertices.length / 3) * 2).fill(0), 2),
  );
  g.computeVertexNormals();
  return g;
}
const roofSections = [
  { x0: 26.4, x1: 79.5, z0: -78.5, z1: -46.0 },
  { x0: 31.3, x1: 74.7, z0: -46.0, z1: -40.0 },
  { x0: 36.2, x1: 70.8, z0: -40.0, z1: -10.5 },
];
const roofHeight = (z) =>
  eaves +
  0.12 +
  design.vaultRiseMeters *
    Math.sin(Math.PI * Math.max(0, Math.min(1, (z + 78.5) / 68)));
function vault(b, material, seams = false) {
  const vertices = [],
    ribs = [];
  const quad = (list, p, q, r, s) =>
    list.push(...p, ...q, ...r, ...p, ...r, ...s);
  for (const sec of roofSections) {
    const n = Math.max(3, Math.ceil((sec.z1 - sec.z0) / 2.0));
    for (let i = 0; i < n; i++) {
      const z0 = sec.z0 + ((sec.z1 - sec.z0) * i) / n,
        z1 = sec.z0 + ((sec.z1 - sec.z0) * (i + 1)) / n;
      const y0 = roofHeight(z0),
        y1 = roofHeight(z1);
      quad(
        vertices,
        [sec.x0, y0, z0],
        [sec.x0, y1, z1],
        [sec.x1, y1, z1],
        [sec.x1, y0, z0],
      );
      quad(
        vertices,
        [sec.x0, eaves, z0],
        [sec.x0, eaves, z1],
        [sec.x0, y1, z1],
        [sec.x0, y0, z0],
      );
      quad(
        vertices,
        [sec.x1, eaves, z1],
        [sec.x1, eaves, z0],
        [sec.x1, y0, z0],
        [sec.x1, y1, z1],
      );
      if (seams)
        for (let j = 1; j < 13; j++) {
          const x = sec.x0 + ((sec.x1 - sec.x0) * j) / 13;
          quad(
            ribs,
            [x - 0.025, y0 + 0.025, z0],
            [x - 0.025, y1 + 0.025, z1],
            [x + 0.025, y1 + 0.025, z1],
            [x + 0.025, y0 + 0.025, z0],
          );
        }
    }
    for (const z of [sec.z0, sec.z1])
      quad(
        vertices,
        [sec.x0, eaves, z],
        [sec.x1, eaves, z],
        [sec.x1, roofHeight(z), z],
        [sec.x0, roofHeight(z), z],
      );
  }
  b.geometry(material, geometryFromTriangles(vertices));
  if (seams) b.geometry("metal", geometryFromTriangles(ribs));
}
function volume() {
  const b = builder("2.5d");
  b.shape("volume", main, 0, eaves);
  vault(b, "cap");
  b.shape("cap", apron, 0, base);
  b.shape("volume", left, 0, design.leftAnnexTopMeters - 0.25, [courts.left]);
  b.shape("cap", left, design.leftAnnexTopMeters - 0.25, 0.25, [courts.left]);
  b.shape("volume", right, 0, design.rightAnnexTopMeters - 0.25, [
    courts.right,
  ]);
  b.shape("cap", right, design.rightAnnexTopMeters - 0.25, 0.25, [
    courts.right,
  ]);
  return b.finish();
}
function detailed() {
  const b = builder("3d");
  // The front recess is visual only. It is never registered as a navigation entrance.
  const core = [
    leftFront,
    points[1],
    [points[1][0], -4.0],
    [73.5, -4.0],
    [73.5, 0],
    rightFront,
    points[4],
    points[7],
    points[8],
    points[9],
    points[10],
  ];
  b.shape("terracotta", core, base, eaves - base);
  b.shape("ivory", main, base - 0.22, 0.22);
  vault(b, "silver", true);

  // Curved red parapet spurs flank the foyer, without detailed cladding meshes.
  const spurLeft = [
    [26.3, -46],
    [36.2, -46],
    [36.2, -18],
    [35.8, -10],
    [34.7, -4],
    [32.5, -0.2],
    [26.3, -0.2],
  ];
  const spurRight = spurLeft.map(([x, z]) => [106.0 - x, z]).reverse();
  for (const ring of [spurLeft, spurRight]) {
    b.shape("terracotta", ring, 14.8, design.frontSpurTopMeters - 14.8);
    b.shape("ivory", ring, design.frontSpurTopMeters, 0.12);
    for (const e of edges(ring))
      b.box(
        "terracotta",
        [e.length, 0.2, 0.14],
        at(e, e.length / 2, design.frontSpurTopMeters + 0.1, 0.02),
        angle(e),
      );
  }
  // Three glazed foyer bands are visible in the reference; the owner supplied a height scale.
  const frontX0 = 37.2,
    frontX1 = 73.4,
    mid = (frontX0 + frontX1) / 2;
  b.plane("glazing", [frontX1 - frontX0, 12.85], [mid, 8.2, -3.94]);
  for (const y of [2.0, 6.2, 10.4, 14.6])
    b.box("ivory", [frontX1 - frontX0, 0.46, 0.28], [mid, y, -3.65]);
  for (let i = 0; i <= 6; i++) {
    const x = frontX0 + ((frontX1 - frontX0) * i) / 6;
    b.box("ivory", [0.28, 12.9, 0.3], [x, 8.2, -3.65]);
    for (const dx of [-1.1, 1.1])
      b.plane("silver", [0.065, 12.8], [x + dx, 8.2, -3.55]);
  }
  for (const y of [4.05, 8.2, 12.4])
    b.plane("silver", [frontX1 - frontX0, 0.075], [mid, y, -3.5]);
  for (const x of [40.8, 50.6, 60.4, 70.2])
    b.piece("ivory", "cylinder", [0.38, 15.2, 0.38], [x, base + 7.6, 0.7]);
  // Glass canopy panes and a sparse grid reproduce the large skylights, without transparency cost.
  const canopy = design.canopyTopMeters;
  for (const z of [-4.2, 4.1])
    b.box("ivory", [43.2, 0.3, 0.32], [55.5, canopy, z]);
  for (let i = 0; i <= 5; i++) {
    const x = 33.9 + i * 8.64;
    b.box("ivory", [0.22, 0.28, 8.3], [x, canopy, -0.05]);
    if (i < 5) {
      b.box("glazing", [6.4, 0.08, 5.6], [x + 4.32, canopy - 0.06, -0.1]);
      b.box("ivory", [8.4, 0.15, 1.15], [x + 4.32, canopy, 3.37]);
      b.box("ivory", [8.4, 0.15, 1.05], [x + 4.32, canopy, -3.42]);
      for (const t of [-1, 1])
        b.box("silver", [6.4, 0.09, 0.065], [x + 4.32, canopy, t * 1.0]);
    }
  }
  // Corner glass strips on both red towers.
  for (const x of [28.0, 77.3]) {
    b.plane("glazing", [3.0, 16.4], [x, 10.0, 0.05]);
    for (const y of [2, 5.8, 9.6, 13.4, 17.2])
      b.box("silver", [3.0, 0.12, 0.14], [x, y, 0.17]);
    b.box("silver", [0.1, 16.5, 0.12], [x, 10.0, 0.17]);
  }
  // Three broad stair flights; no internal auditorium or floor plans are invented.
  for (const x of [43.0, 55.8, 68.6])
    for (let step = 0; step < 8; step++)
      b.box(
        "ivory",
        [10.4, 0.225 * (step + 1), 0.74],
        [x, 0.1125 * (step + 1), 5.65 - step * 0.7],
      );

  // Tall side window walls, brick forward/rear bays and small flat ventilation marks.
  const sideLeft = {
    a: [26.204, 0],
    b: [26.204, -78.6],
    dx: 0,
    dz: -78.6,
    length: 78.6,
    normal: [-1, 0],
  };
  const sideRight = {
    a: [79.5, -78.6],
    b: [79.5, 0],
    dx: 0,
    dz: 78.6,
    length: 78.6,
    normal: [1, 0],
  };
  for (const e of [sideLeft, sideRight]) {
    const d = e === sideLeft ? 31.0 : 47.6;
    b.plane("glazing", [33.8, 14.8], at(e, d, 9.1, 0.18), angle(e));
    for (let i = 0; i <= 18; i++)
      b.box(
        "ivory",
        [0.17, 15.1, 0.4],
        at(e, d - 16.9 + (i * 33.8) / 18, 9.1, 0.31),
        angle(e),
      );
    for (const y of [2.0, 5.7, 9.4, 13.1, 16.5])
      b.plane("silver", [33.8, 0.1], at(e, d, y, 0.54), angle(e));
    const frontD = e === sideLeft ? 6.6 : 72.0;
    for (let col = 0; col < 5; col++)
      for (let row = 0; row < 8; row++)
        b.plane(
          "metal",
          [0.22, 0.28],
          at(e, frontD - 4 + col * 1.6, 3.3 + row * 1.75, 0.18),
          angle(e),
        );
    b.box("ivory", [9.0, 0.18, 2.7], at(e, d, 4.0, 1.3), angle(e));
  }
  // Two low wings with display-only courtyard openings.
  b.shape("terracotta", left, 0.35, design.leftAnnexTopMeters - 0.35, [
    courts.left,
  ]);
  b.shape("ivory", left, design.leftAnnexTopMeters, 0.22, [courts.left]);
  for (const e of edges(left)) {
    b.box(
      "ivory",
      [e.length, 0.28, 0.7],
      at(e, e.length / 2, design.leftAnnexTopMeters + 0.17, 0.12),
      angle(e),
    );
    const count = Math.max(1, Math.floor(e.length / 5));
    for (let i = 0; i < count; i++)
      for (const y of [2.0, 5.3]) {
        b.plane(
          "glazing",
          [2.5, 2.15],
          at(e, (e.length * (i + 0.5)) / count, y, 0.1),
          angle(e),
        );
        for (const dx of [-0.7, 0.7])
          b.plane(
            "silver",
            [0.065, 2.15],
            at(e, (e.length * (i + 0.5)) / count + dx, y, 0.19),
            angle(e),
          );
      }
  }
  // Right portico uses pillars and a shallow fascia, so the covered walk remains visually open.
  const rightRoof = design.rightAnnexTopMeters;
  b.shape("ivory", right, rightRoof - 0.28, 0.28, [courts.right]);
  for (const e of edges(right)) {
    b.box(
      "terracotta",
      [e.length, 0.4, 0.55],
      at(e, e.length / 2, rightRoof - 0.48, 0),
      angle(e),
    );
    b.box(
      "ivory",
      [e.length, 0.2, 0.8],
      at(e, e.length / 2, rightRoof + 0.1, 0.05),
      angle(e),
    );
    const n = Math.max(1, Math.ceil(e.length / 5.8));
    for (let i = 0; i < n; i++)
      b.box(
        "ivory",
        [0.4, rightRoof - 0.55, 0.4],
        at(e, (e.length * i) / n, (rightRoof - 0.55) / 2, -0.18),
        angle(e),
      );
  }
  // Low rear utility rooms stay within the right wing, away from its courtyard.
  b.box("terracotta", [22.3, 4.3, 5.5], [90.4, 2.15, -46.0]);
  for (const x of [83.5, 89.3, 95.1])
    b.plane("glazing", [2.2, 1.7], [x, 2.3, -48.82], Math.PI);
  // A few rooftop service forms behind the canopy, simplified from the photographs.
  for (let i = 0; i < 5; i++) {
    b.box("metal", [2.0, 1.0, 1.4], [39.5 + i * 6.5, 18.0, -7.4]);
    b.box("ivory", [2.2, 0.12, 1.6], [39.5 + i * 6.5, 18.56, -7.4]);
  }
  return b.finish();
}

await mkdir(folder, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  assets = {};
for (const [mode, scene] of [
  ["2.5d", volume()],
  ["3d", detailed()],
]) {
  let triangles = 0,
    drawCalls = 0;
  const mats = new Set(),
    bounds = new Box3();
  const matrix = new Matrix4(),
    instance = new Matrix4(),
    vertex = new Vector3();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position;
    triangles +=
      ((node.geometry.index?.count ?? positions.count) / 3) *
      (node.isInstancedMesh ? node.count : 1);
    mats.add(node.material.name);
    drawCalls++;
    for (let i = 0; i < (node.isInstancedMesh ? node.count : 1); i++) {
      if (node.isInstancedMesh) {
        node.getMatrixAt(i, instance);
        matrix.multiplyMatrices(node.matrixWorld, instance);
      } else matrix.copy(node.matrixWorld);
      for (let j = 0; j < positions.count; j++)
        bounds.expandByPoint(
          vertex.fromBufferAttribute(positions, j).applyMatrix4(matrix),
        );
    }
  });
  const binary = Buffer.from(
    await new GLTFExporter().parseAsync(scene, {
      binary: true,
      copyright:
        "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified auditorium geometry. Owner described four-storey height; metric height/courtyards/facade are visual estimates. No photograph textures or surveyed interior layouts.",
    }),
  );
  if (
    triangles > design.performance.triangleBudget ||
    drawCalls > design.performance.modelDrawCallBudget ||
    binary.length > design.performance.glbByteBudget
  )
    throw new Error(
      `Auditorium ${mode} budget exceeded: ${triangles} / ${drawCalls} / ${binary.length}`,
    );
  const file = `auditorium-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  assets[mode] = {
    url: `./${file}`,
    sha256: sha(binary),
    bytes: binary.length,
    triangles,
    drawCalls,
    materialCount: mats.size,
    textureCount: 0,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
}
const toLocal = ([x, z]) => [
  anchor[0] + x * cos - z * sin,
  anchor[1] + x * sin + z * cos,
];
const wgs84 = (p) => {
  const [x, z] = toLocal(p);
  const ll = new MercatorCoordinate(
    origin.x + x * units,
    origin.y + z * units,
  ).toLngLat();
  return [ll.lng, ll.lat];
};
const closed = (ring) => [...ring.map(wgs84), wgs84(ring[0])];
const volumes = {
  type: "FeatureCollection",
  stage: "visual_review_only_not_navigation_GIS",
  features: [
    ["main", main, [], eaves + design.vaultRiseMeters + 0.12],
    ["entrance_platform", apron, [], base],
    ["left_annex", left, [courts.left], design.leftAnnexTopMeters],
    ["right_annex", right, [courts.right], design.rightAnnexTopMeters],
  ].map(([part, ring, holes, height]) => ({
    type: "Feature",
    id: `auditorium-preview-${part}`,
    properties: {
      placeId: place.id,
      part,
      height,
      heightAccuracy: design.heightAccuracy,
      heightKind: part === "main" ? "maximum_visual_envelope" : "visual_part_height",
      roofProfile: part === "main" ? "curved_vault_in_GLB_and_generator" : null,
      heightScaleLevels: part === "main" ? 4 : null,
      interiorLevelsVerified: false,
      approvedForMap: false,
    },
    geometry: {
      type: "Polygon",
      coordinates: [closed(ring), ...holes.map(closed)],
    },
  })),
};
await writeFile(
  `${folder}/auditorium-2.5d.geojson`,
  JSON.stringify(volumes, null, 2) + "\n",
);
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  placeId: place.id,
  sourceMapVersion: campus.mapVersion,
  origin: place.coordinate,
  footprintSha256: sha(JSON.stringify(place.geometry)),
  sourceGeometryWgs84: place.geometry,
  footprintAlignedMeters: points,
  heightScaleLevels: 4,
  levelsSource: design.levelsSource,
  levelsAccuracy: design.levelsAccuracy,
  interiorLevelsVerified: false,
  heightAccuracy: design.heightAccuracy,
  appearanceAccuracy: design.appearanceAccuracy,
  courtyard: { alignedMeters: courts, accuracy: design.courtyardAccuracy },
  alignedToLocal: { anchor, rotationYRadians: frameAngle },
  assets,
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { version: manifest.modelVersion, heightScaleLevels: 4, assets },
    null,
    2,
  ),
);
