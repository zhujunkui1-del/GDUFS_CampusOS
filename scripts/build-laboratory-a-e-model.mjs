// Independent laboratory complex display draft; GIS and navigation remain source data.
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
const folder = "docs/model-previews/laboratory-a-e-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (
  campus.mapVersion !== design.sourceMapVersion ||
  place?.geometryRings?.length !== 4
)
  throw new Error(
    "Review laboratory parent footprint and three courtyard rings.",
  );
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const localRings = place.geometryRings.map((r) =>
  r.slice(0, -1).map((p) => {
    const q = MercatorCoordinate.fromLngLat(p);
    return [(q.x - origin.x) / units, (q.y - origin.y) / units];
  }),
);
const anchor = localRings[0][9],
  end = localRings[0][10],
  phi = Math.atan2(end[1] - anchor[1], end[0] - anchor[0]),
  cos = Math.cos(phi),
  sin = Math.sin(phi),
  frameAngle = -phi;
const rings = localRings.map((r) =>
  r.map(([x, z]) => [
    (x - anchor[0]) * cos + (z - anchor[1]) * sin,
    -(x - anchor[0]) * sin + (z - anchor[1]) * cos,
  ]),
);
const points = rings[0],
  holes = rings.slice(1),
  length = points[10][0];
const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const area = (r) =>
  r.reduce((s, p, i) => {
    const q = r[(i + 1) % r.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
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
function edges(ring, inner = false) {
  const sign = Math.sign(area(ring)) * (inner ? -1 : 1);
  return ring.map((a, i) => {
    const c = ring[(i + 1) % ring.length],
      dx = c[0] - a[0],
      dz = c[1] - a[1],
      l = Math.hypot(dx, dz);
    return {
      a,
      dx,
      dz,
      length: l,
      normal: [(sign * dz) / l, (-sign * dx) / l],
    };
  });
}
const at = (e, d, y, offset = 0) => [
  e.a[0] + (e.dx * d) / e.length + e.normal[0] * offset,
  y,
  e.a[1] + (e.dz * d) / e.length + e.normal[1] * offset,
];
const angle = (e) => Math.atan2(e.normal[0], e.normal[1]);
function extrusion(ring, y, height, inner = []) {
  const shape = new Shape(ring.map(([x, z]) => new Vector2(x, -z)));
  for (const h of inner)
    shape.holes.push(new Path(h.map(([x, z]) => new Vector2(x, -z))));
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
// Keep the source outer ring and all holes. Only the display upper frontage is opened.
const cutZ = design.rearFacadeAlignedZ;
function intersectZ(a, b, z) {
  return [a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]), z];
}
const rearParts = [
  {
    ring: [
      ...points.slice(0, 9),
      intersectZ(points[8], points[9], cutZ),
      [points[0][0], cutZ],
    ],
    holes: [holes[0]],
  },
  {
    ring: [
      intersectZ(points[10], points[11], cutZ),
      ...points.slice(11),
      [points[24][0], cutZ],
    ],
    holes: holes.slice(1),
  },
];
const pods = design.frontRoomIntervalsAlignedMeters.map(([a, b]) =>
  rect(a, -2, b, cutZ),
);
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    terracotta: "#c38d65",
    ivory: "#e4e5de",
    roof: "#c2bead",
    roofDark: "#717976",
    metal: "#a8b4b5",
    glazing: "#6d8c98",
    blue: "#6689aa",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Laboratory-A-E-${mode}-owner-height-scale`;
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

function beam(b, mat, a, c, width, depth = width) {
  const from = new Vector3(...a),
    to = new Vector3(...c),
    delta = to.clone().sub(from);
  const g = new BoxGeometry(delta.length(), width, depth);
  const direction = delta.normalize();
  const across = new Vector3()
    .crossVectors(direction, new Vector3(0, 1, 0))
    .normalize();
  const up = new Vector3().crossVectors(across, direction).normalize();
  g.applyMatrix4(new Matrix4().makeBasis(direction, up, across));
  g.translate(...from.add(to).multiplyScalar(0.5).toArray());
  b.geometry(mat, g);
}
function stairs(b, lo, hi, mode) {
  const x0 = lo + Math.max(2, (hi - lo - 16) / 2),
    x1 = x0 + Math.min(16, hi - lo - 4),
    z = -6.1,
    w = 2.8;
  // The exterior flight reaches the second level; three upper flights reach level five.
  for (let level = 0; level < design.heightScaleLevels - 2; level++) {
    const y0 = design.floorDatumsMeters[level + 1],
      y1 = design.floorDatumsMeters[level + 2];
    const start = level % 2 ? x1 : x0,
      finish = level % 2 ? x0 : x1;
    const mat = mode === "3d" ? "ivory" : "volume";
    beam(b, mat, [start, y0 - 0.12, z], [finish, y1 - 0.12, z], 0.22, w);
    for (const x of [x0, x1]) b.box(mat, [2.4, 0.2, 8.1], [x, y0, -10]);
    if (mode !== "3d") continue;
    for (let step = 0; step < 24; step++) {
      const t = (step + 0.5) / 24;
      b.box(
        "ivory",
        [Math.abs(x1 - x0) / 24 + 0.025, 0.14, w],
        [start + (finish - start) * t, y0 + (y1 - y0) * t, z],
      );
    }
    for (const dz of [-w / 2, w / 2]) {
      beam(
        b,
        "metal",
        [start, y0 + 1, z + dz],
        [finish, y1 + 1, z + dz],
        0.045,
      );
      beam(
        b,
        "metal",
        [start, y0 + 0.5, z + dz],
        [finish, y1 + 0.5, z + dz],
        0.035,
      );
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        b.box(
          "metal",
          [0.045, 1, 0.045],
          [start + (finish - start) * t, y0 + (y1 - y0) * t + 0.5, z + dz],
        );
      }
    }
  }
}
function roofGrid(b, mode) {
  const mat = mode === "3d" ? "ivory" : "cap",
    top = design.roofTopMeters;
  for (const z of [-0.15, -6.7, -15.9])
    b.box(mat, [length, 0.35, 0.25], [length / 2, top - 0.175, z]);
  for (let x = 0; x <= length; x += 3.8)
    b.box(mat, [0.2, 0.26, 16.15], [x, top - 0.13, -7.95]);
  if (mode === "3d")
    b.box("blue", [length + 0.2, 0.52, 0.16], [length / 2, top - 0.21, 0.08]);
}
function make(mode) {
  const b = builder(mode),
    detail = mode === "3d",
    body = detail ? "ivory" : "volume",
    roof = detail ? "roof" : "cap";
  b.shape(body, points, 0.08, design.floorDatumsMeters[1] - 0.18, holes);
  for (const part of rearParts) {
    b.shape(
      body,
      part.ring,
      design.floorDatumsMeters[1] - 0.1,
      design.roofTopMeters - design.floorDatumsMeters[1] - 0.12,
      part.holes,
    );
    b.shape(roof, part.ring, design.roofTopMeters - 0.22, 0.15, part.holes);
  }
  for (const pod of pods) {
    b.shape(
      detail ? "terracotta" : "volume",
      pod,
      design.floorDatumsMeters[1],
      11.45,
    );
    b.shape(detail ? "glazing" : "volume", pod, 15.15, 2.83);
    b.shape(detail ? "roof" : "cap", pod, 17.98, 0.12);
  }
  // Shared open deck and recessed galleries; never cap the source courtyard holes.
  b.box(body, [length, 0.23, 16], [length / 2, 3.7, -8]);
  for (const y of design.floorDatumsMeters.slice(2, 5))
    b.box(body, [length, 0.22, 2.6], [length / 2, y, -13.0]);
  for (const x of design.columnAlignedX)
    b.piece(body, "cylinder", [0.32, 18.1, 0.32], [x, 9.05, -0.75]);
  for (const [a, c] of design.openGalleryIntervalsAlignedMeters) {
    for (const y of design.floorDatumsMeters.slice(2, 5)) {
      b.box(body, [c - a, 0.22, 2.4], [(a + c) / 2, y, -2.0]);
      if (detail) {
        b.box("metal", [c - a, 0.055, 0.055], [(a + c) / 2, y + 1, -0.87]);
        b.plane("metal", [c - a, 0.04], [(a + c) / 2, y + 0.55, -0.85]);
        for (let x = a + 0.5; x < c; x += 2)
          b.box("metal", [0.045, 1, 0.045], [x, y + 0.5, -0.86]);
      }
    }
  }
  for (const [lo, hi] of design.stairAtriumIntervalsAlignedMeters)
    stairs(b, lo, hi, mode);
  roofGrid(b, mode);
  // Two shallow exterior access flights are visual geometry only, not GIS entrances.
  for (const x of design.exteriorStairAlignedX) {
    for (let step = 0; step < (detail ? 22 : 1); step++) {
      if (!detail) {
        beam(b, "volume", [x, 0.2, 7.0], [x, 3.7, 0.0], 0.22, 3.2);
        break;
      }
      const t = (step + 0.5) / 22;
      b.box(
        "ivory",
        [3.2, 0.17, 7 / 22 + 0.025],
        [x, 0.2 + 3.5 * t, 7 * (1 - t)],
      );
    }
    if (detail) {
      for (const dx of [-1.6, 1.6])
        beam(b, "blue", [x + dx, 0.7, 7], [x + dx, 4.2, 0], 0.16, 0.18);
    }
  }
  if (detail) {
    b.box("blue", [length, 0.38, 0.18], [length / 2, 3.6, 0.03]);
    for (const [lo, hi] of design.stairAtriumIntervalsAlignedMeters) {
      b.plane("glazing", [hi - lo, 14.0], [(lo + hi) / 2, 10.85, -15.7]);
      for (let x = lo; x <= hi; x += 3.4)
        b.plane("metal", [0.075, 14.0], [x, 10.85, -15.62]);
      for (const y of [7.3, 10.9, 14.5])
        b.plane("metal", [hi - lo, 0.06], [(lo + hi) / 2, y, -15.6]);
    }
    for (const [
      podIndex,
      [lo, hi],
    ] of design.frontRoomIntervalsAlignedMeters.entries()) {
      const asymmetric = design.asymmetricRoomIndices.includes(podIndex);
      for (const y of [5.6, 9.2, 12.8]) {
        const width = (hi - lo - 5) / 2;
        const windows = asymmetric
          ? [
              [lo + 2.4, 2.1],
              [lo + (hi - lo) * 0.56, (hi - lo) * 0.24],
              [lo + (hi - lo) * 0.86, (hi - lo) * 0.21],
            ]
          : [
              [lo + 1.6 + width / 2, width],
              [hi - 1.6 - width / 2, width],
            ];
        for (const [x, windowWidth] of windows) {
          b.plane("glazing", [windowWidth, 1.75], [x, y, -1.96]);
          for (const dy of [-0.9, 0.35, 0.9])
            b.plane("ivory", [windowWidth + 0.12, 0.065], [x, y + dy, -1.9]);
          for (let j = 0; j <= 4; j++)
            b.plane(
              "ivory",
              [0.045, 1.8],
              [x - windowWidth / 2 + (windowWidth * j) / 4, y, -1.88],
            );
        }
      }
      b.plane("terracotta", [hi - lo, 3.38], [(lo + hi) / 2, 1.85, 0.025]);
      if (asymmetric) {
        const x = lo + (hi - lo) * 0.285;
        b.plane("glazing", [2.4, 14.13], [x, 10.8, -1.955]);
        for (let y = 3.75; y < 18; y += 0.72)
          b.plane("metal", [2.45, 0.055], [x, y, -1.87]);
        for (const dx of [-1.2, 0, 1.2])
          b.plane("metal", [0.055, 14.15], [x + dx, 10.8, -1.86]);
      }
      for (let x = lo + 0.15; x < hi; x += 1.6)
        b.plane("metal", [0.06, 2.78], [x, 16.56, -1.91]);
      for (const y of [15.2, 15.85, 16.5, 17.15, 17.8])
        b.plane("metal", [hi - lo, 0.065], [(lo + hi) / 2, y, -1.9]);
    }
    for (const part of rearParts) {
      for (const e of [
        ...edges(part.ring),
        ...part.holes.flatMap((r) => edges(r, true)),
      ]) {
        if (e.length < 1) continue;
        const bearing = angle(e);
        b.box(
          "ivory",
          [e.length, 0.38, 0.18],
          at(e, e.length / 2, 18.22, -0.05),
          bearing,
        );
        const n = Math.floor(e.length / 3.3);
        if (n < 1) continue;
        for (const y of [1.95, 5.5, 9.1, 12.7, 16.3]) {
          b.plane(
            "glazing",
            [e.length - 0.6, 1.45],
            at(e, e.length / 2, y, 0.035),
            bearing,
          );
          b.box(
            "ivory",
            [e.length, 0.19, 0.3],
            at(e, e.length / 2, y - 1.65, 0.03),
            bearing,
          );
          for (let i = 0; i <= n; i++)
            b.plane(
              "ivory",
              [0.25, 1.55],
              at(e, 0.3 + ((e.length - 0.6) * i) / n, y, 0.09),
              bearing,
            );
        }
      }
    }
    // Schematic rear stair/service end walls, kept on the supplied parent outline.
    for (const i of design.orangeRearEdgeIndices) {
      const e = edges(points)[i];
      if (e.length > 5)
        b.plane(
          "terracotta",
          [e.length - 0.35, 14.3],
          at(e, e.length / 2, 10.8, 0.12),
          angle(e),
        );
    }
    // The ground frontage is lower and recessed, distinct from the tall atria.
    for (let x = 7; x < length; x += 7) {
      b.plane("glazing", [3.8, 1.65], [x, 1.95, 0.045]);
      b.plane("ivory", [0.06, 1.7], [x, 1.95, 0.1]);
    }
  }
  // Finite raised service rooms are display approximations, not extra verified floors.
  for (const i of design.roofCoreEdgeIndices) {
    const e = edges(points)[i];
    if (e.length < 7) continue;
    const along = Math.min(7, e.length - 1),
      center = at(e, e.length / 2, 0, -3.1);
    const r = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => [
      center[0] + ((e.dx / e.length) * u * along) / 2 + e.normal[0] * v * 2.5,
      center[2] + ((e.dz / e.length) * u * along) / 2 + e.normal[1] * v * 2.5,
    ]);
    if (
      !r.every((p) => contains(points, p) && !holes.some((h) => contains(h, p)))
    )
      continue;
    b.shape(detail ? "terracotta" : "volume", r, 18.1, 1.8);
    b.shape(detail ? "roofDark" : "cap", r, 19.9, 0.1);
  }
  return b.finish();
}
await mkdir(folder, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  assets = {};
for (const mode of ["2.5d", "3d"]) {
  const scene = make(mode);
  let triangles = 0,
    drawCalls = 0;
  const mats = new Set(),
    bounds = new Box3(),
    matrix = new Matrix4(),
    instance = new Matrix4(),
    vertex = new Vector3();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position;
    triangles +=
      ((node.geometry.index?.count ?? positions.count) / 3) *
      (node.isInstancedMesh ? node.count : 1);
    drawCalls++;
    mats.add(node.material.name);
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
        "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original laboratory A-E simplified geometry. Owner describes five-storey height; metric dimensions and frontage parts are visual estimates. Three source courtyards retained. Supplied photographs used only as internal references; no photograph textures or verified interiors.",
    }),
  );
  if (
    triangles > design.performance.triangleBudget ||
    drawCalls > design.performance.modelDrawCallBudget ||
    binary.length > design.performance.glbByteBudget
  )
    throw new Error(
      `${mode} budget exceeded: ${triangles}/${drawCalls}/${binary.length}`,
    );
  const file = `laboratory-a-e-${mode}.glb`;
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
  const [x, z] = toLocal(p),
    q = new MercatorCoordinate(
      origin.x + x * units,
      origin.y + z * units,
    ).toLngLat();
  return [q.lng, q.lat];
};
const closed = (r) => [...r.map(wgs84), wgs84(r[0])];
const features = [
  {
    type: "Feature",
    id: "laboratory-source-base",
    properties: {
      placeId: place.id,
      part: "source_parent_base",
      base: 0.08,
      height: 3.7,
      heightAccuracy: design.heightAccuracy,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: place.geometryRings },
  },
];
for (const [i, p] of [
  ...rearParts,
  ...pods.map((r) => ({ ring: r, holes: [] })),
].entries())
  features.push({
    type: "Feature",
    id: `laboratory-display-${i}`,
    properties: {
      placeId: place.id,
      part: i < 2 ? "rear_courtyard_cluster" : "orange_front_room",
      base: 3.7,
      height: 18.45,
      heightAccuracy: design.heightAccuracy,
      geometryAccuracy: "photo_informed_display_part_not_A_E_boundary",
      heightScaleLevels: 5,
      interiorLevelsVerified: false,
      approvedForMap: false,
    },
    geometry: {
      type: "Polygon",
      coordinates: [closed(p.ring), ...p.holes.map(closed)],
    },
  });
await writeFile(
  `${folder}/laboratory-a-e-2.5d.geojson`,
  JSON.stringify(
    {
      type: "FeatureCollection",
      stage: "visual_review_only_not_navigation_GIS",
      note: "Open galleries, stairs and perforated roof frame are in the GLBs; these display volumes do not define five separate buildings.",
      features,
    },
    null,
    2,
  ) + "\n",
);
const labels = campus.places
  .filter((p) => p.parentId === place.id)
  .map((p) => ({
    id: p.id,
    name: p.name,
    coordinate: p.coordinate,
    parentId: p.parentId,
  }));
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  placeId: place.id,
  sourceMapVersion: campus.mapVersion,
  origin: place.coordinate,
  footprintSha256: sha(JSON.stringify(place.geometryRings)),
  sourceGeometryRingsWgs84: place.geometryRings,
  footprintRingsAlignedMeters: rings,
  previewEnvelopeAlignedMeters: [
    ...points,
    ...design.exteriorStairAlignedX.flatMap((x) => [
      [x - 2, 7.3],
      [x + 2, 7.3],
    ]),
  ],
  heightScaleLevels: 5,
  levelsSource: design.levelsSource,
  levelsAccuracy: design.levelsAccuracy,
  interiorLevelsVerified: false,
  heightAccuracy: design.heightAccuracy,
  appearanceAccuracy: design.appearanceAccuracy,
  geometryAccuracy: design.geometryAccuracy,
  labelBindings: labels,
  independentBlockBoundariesVerified: false,
  sourceCourtyards: 3,
  alignedToLocal: { anchor, rotationYRadians: frameAngle },
  assets,
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { version: manifest.modelVersion, sourceCourtyards: 3, assets },
    null,
    2,
  ),
);
