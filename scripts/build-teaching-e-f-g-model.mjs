// Offline visual model of the shared E/F/G parent; source GIS is read-only.
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
const folder = "docs/model-previews/teaching-e-f-g-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (
  campus.mapVersion !== design.sourceMapVersion ||
  place?.geometryRings?.length !== 4
)
  throw new Error("Review E/F/G source parent and three courtyards.");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits(),
  anchor = [0, 0],
  frameAngle = 0;
const rings = place.geometryRings.map((r) =>
  r.slice(0, -1).map((p) => {
    const q = MercatorCoordinate.fromLngLat(p);
    return [(q.x - origin.x) / units, (q.y - origin.y) / units];
  }),
);
const points = rings[0],
  holes = rings.slice(1);
const area = (r) =>
  r.reduce((s, a, i) => {
    const b = r[(i + 1) % r.length];
    return s + a[0] * b[1] - b[0] * a[1];
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
function edges(r, inner = false) {
  const sign = Math.sign(area(r)) * (inner ? -1 : 1);
  return r.map((a, i) => {
    const b = r[(i + 1) % r.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    return {
      a,
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
function lineIntersection(a, u, b, v) {
  const cross = (p, q) => p[0] * q[1] - p[1] * q[0],
    t = cross([b[0] - a[0], b[1] - a[1]], v) / cross(u, v);
  return [a[0] + u[0] * t, a[1] + u[1] * t];
}
function expand(r, width) {
  const es = edges(r);
  return r.map((p, i) => {
    const a = es[(i + es.length - 1) % es.length],
      b = es[i];
    return lineIntersection(
      [p[0] + a.normal[0] * width, p[1] + a.normal[1] * width],
      [a.dx, a.dz],
      [p[0] + b.normal[0] * width, p[1] + b.normal[1] * width],
      [b.dx, b.dz],
    );
  });
}
function extrusion(r, y, height, inner = []) {
  const s = new Shape(r.map(([x, z]) => new Vector2(x, -z)));
  for (const h of inner)
    s.holes.push(new Path(h.map(([x, z]) => new Vector2(x, -z))));
  const g = new ExtrudeGeometry(s, {
    depth: height,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
const idx = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i),
  poly = (is) => is.map((i) => points[i]);
const parts = {
  E: {
    indices: [...idx(0, 13), ...idx(68, 74)],
    hole: holes[2],
    projectorIndices: idx(4, 7),
    remove: [5, 6],
    frontEdge: 5,
    exteriorWindowEdge: 68,
  },
  F: {
    indices: [...idx(14, 28), ...idx(57, 67)],
    hole: holes[1],
    projectorIndices: idx(19, 22),
    remove: [20, 21],
    frontEdge: 20,
    exteriorWindowEdge: 57,
  },
  G: {
    indices: idx(29, 56),
    hole: holes[0],
    projectorIndices: idx(37, 44),
    remove: idx(38, 43),
    frontEdge: 40,
    exteriorWindowEdge: 49,
  },
};
const connectors = [poly([13, 14, 67, 68]), poly([28, 29, 56, 57])];
for (const p of Object.values(parts)) {
  p.ring = poly(p.indices);
  p.bodyIndices = p.indices.filter((i) => !p.remove.includes(i));
  p.body = poly(p.bodyIndices);
  p.projector = poly(p.projectorIndices);
  p.roomHole = expand(p.hole, design.galleryDepthMeters);
  if (!p.roomHole.every((q) => contains(p.body, q)))
    throw new Error("Expanded gallery leaves its display massing.");
}
const sourceArea =
  Math.abs(area(points)) - holes.reduce((s, r) => s + Math.abs(area(r)), 0);
const displayArea =
  Object.values(parts).reduce(
    (s, p) =>
      s +
      Math.abs(area(p.body)) +
      Math.abs(area(p.projector)) -
      Math.abs(area(p.hole)),
    0,
  ) + connectors.reduce((s, r) => s + Math.abs(area(r)), 0);
if (Math.abs(sourceArea - displayArea) > 0.0001)
  throw new Error("Display partitions changed parent footprint area.");
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    ivory: "#e4e5de",
    terracotta: "#c68e63",
    roof: "#c7c2b1",
    roofDark: "#777e78",
    glazing: "#75929c",
    metal: "#a2afb0",
    blue: "#6a9fc5",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Teaching-E-F-G-${mode}-owner-height-scale`;
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
    delta = to.clone().sub(from),
    g = new BoxGeometry(delta.length(), width, depth),
    direction = delta.normalize(),
    across = new Vector3()
      .crossVectors(direction, new Vector3(0, 1, 0))
      .normalize(),
    up = new Vector3().crossVectors(across, direction).normalize();
  g.applyMatrix4(new Matrix4().makeBasis(direction, up, across));
  g.translate(...from.add(to).multiplyScalar(0.5).toArray());
  b.geometry(mat, g);
}
function facades(
  b,
  e,
  {
    orange = false,
    blue = false,
    skipGroundInterval = null,
    small = false,
  } = {},
) {
  if (e.length < 1) return;
  const bearing = angle(e),
    n = Math.max(1, Math.floor(e.length / (small ? 3.2 : 4.1))),
    usable = e.length - 0.5;
  if (orange)
    b.plane(
      "terracotta",
      [e.length * 0.72, 10.8],
      at(e, e.length / 2, 9.1, 0.035),
      bearing,
    );
  for (const [level, datum] of design.floorDatumsMeters.slice(0, 5).entries()) {
    const y = datum + 1.8;
    if (blue && level > 0 && level < 4)
      b.plane(
        "blue",
        [e.length - 0.1, 3.15],
        at(e, e.length / 2, datum + 1.72, 0.04),
        bearing,
      );
    for (let i = 0; i < n; i++) {
      const d = 0.25 + ((i + 0.5) * usable) / n;
      if (
        level === 0 &&
        skipGroundInterval &&
        d > skipGroundInterval[0] &&
        d < skipGroundInterval[1]
      )
        continue;
      const w = Math.max(0.4, usable / n - (small ? 1.1 : 0.75)),
        h = small ? 1.65 : 1.9;
      b.plane("glazing", [w, h], at(e, d, y, 0.09), bearing);
      for (const dy of [-h / 2, 0.35, h / 2])
        b.plane("ivory", [w + 0.12, 0.06], at(e, d, y + dy, 0.14), bearing);
      b.plane("metal", [0.045, h + 0.05], at(e, d, y, 0.16), bearing);
    }
  }
  b.box(
    "ivory",
    [e.length, 0.4, 0.18],
    at(e, e.length / 2, 18.32, -0.02),
    bearing,
  );
}
function gallery(b, e, mode, depth = design.galleryDepthMeters) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume",
    bearing = angle(e),
    a = at(e, 0, 0),
    c = at(e, e.length, 0),
    r = [
      [a[0], a[2]],
      [c[0], c[2]],
      [c[0] - e.normal[0] * depth, c[2] - e.normal[1] * depth],
      [a[0] - e.normal[0] * depth, a[2] - e.normal[1] * depth],
    ];
  for (const y of design.floorDatumsMeters.slice(1, 5)) {
    b.shape(mat, r, y - 0.12, 0.22);
    b.box(
      mat,
      [e.length, 0.68, 0.17],
      at(e, e.length / 2, y + 0.42, -0.015),
      bearing,
    );
    if (detail)
      b.box(
        "metal",
        [e.length, 0.05, 0.045],
        at(e, e.length / 2, y + 1.0, 0.04),
        bearing,
      );
  }
  const n = Math.max(1, Math.ceil(e.length / 4.6));
  for (let i = 0; i <= n; i++)
    b.box(
      mat,
      [0.24, 18, 0.24],
      at(e, (e.length * i) / n, 9.05, -0.1),
      bearing,
    );
  if (detail) {
    const back = {
      ...e,
      a: [e.a[0] - e.normal[0] * depth, e.a[1] - e.normal[1] * depth],
    };
    facades(b, back, { small: true });
  }
}
function connector(b, ring, mode) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume",
    es = edges(ring),
    long = es.filter((e) => e.length > 15);
  for (const y of design.floorDatumsMeters.slice(1, 5)) {
    b.shape(mat, ring, y - 0.12, 0.24);
    for (const e of long) {
      b.box(
        mat,
        [e.length, 0.75, 0.2],
        at(e, e.length / 2, y + 0.45, -0.02),
        angle(e),
      );
      if (detail)
        b.box(
          "metal",
          [e.length, 0.05, 0.05],
          at(e, e.length / 2, y + 1.05, 0.025),
          angle(e),
        );
    }
  }
  b.shape(detail ? "roof" : "cap", ring, 18.1, 0.18);
  for (const e of long) {
    const n = Math.ceil(e.length / 5);
    for (let i = 0; i <= n; i++)
      b.box(
        mat,
        [0.28, 18.15, 0.28],
        at(e, (e.length * i) / n, 9.15, -0.08),
        angle(e),
      );
  }
}
function projector(b, p, mode) {
  const detail = mode === "3d",
    orange = detail ? "terracotta" : "volume",
    front = edges(points)[p.frontEdge],
    start = front.a,
    bearing = angle(front),
    roofTop = design.projectorRoofMeters;
  b.shape(orange, p.projector, 3.7, roofTop - 3.7);
  b.shape(detail ? "roof" : "cap", p.projector, roofTop, 0.12);
  // Support the elevated volume on finite orange piers. No fictitious interior plan.
  for (const q of p.projector.length === 4
    ? p.projector
    : p.projector.filter((_, i) => i % 2 === 0))
    b.box(orange, [0.55, 3.65, 0.55], [q[0], 1.9, q[1]]);
  const inner = (u, v, y) => [
    start[0] + (front.dx / front.length) * u - front.normal[0] * v,
    y,
    start[1] + (front.dz / front.length) * u - front.normal[1] * v,
  ];
  if (detail) {
    const width = front.length * 0.55,
      d = front.length * 0.62;
    for (const y of [6.4, 11.15]) {
      b.plane("ivory", [width + 1.0, 3.9], at(front, d, y, 0.06), bearing);
      b.plane("glazing", [width, 2.65], at(front, d, y, 0.12), bearing);
      for (const du of [-width / 2, 0, width / 2])
        b.plane("ivory", [0.065, 2.72], at(front, d + du, y, 0.17), bearing);
    }
    b.plane(
      "ivory",
      [1.0, 8.1],
      at(front, front.length * 0.17, 8.3, 0.06),
      bearing,
    );
    for (const y of [5.4, 8.3, 11.2])
      b.plane(
        "glazing",
        [0.62, 1.9],
        at(front, front.length * 0.17, y, 0.11),
        bearing,
      );
  }
  // The front orange roof frame and terrace stay below the main building's fifth-floor roof.
  const u0 = 1.1,
    u1 = front.length - 1.1,
    v0 = 1.3,
    v1 = Math.min(6.5, design.projectorPergolaDepthMeters),
    top = design.projectorPergolaTopMeters;
  for (const v of [v0, v1])
    b.box(
      orange,
      [u1 - u0, 0.3, 0.28],
      inner((u0 + u1) / 2, v, top - 0.15),
      bearing,
    );
  const n = Math.max(3, Math.round((u1 - u0) / 2));
  for (let i = 0; i <= n; i++)
    b.box(
      orange,
      [0.25, 0.26, v1 - v0],
      inner(u0 + ((u1 - u0) * i) / n, (v0 + v1) / 2, top - 0.13),
      bearing,
    );
  for (const u of [u0, u1])
    for (const v of [v0, v1])
      b.box(
        orange,
        [0.35, top - roofTop, 0.35],
        inner(u, v, (top + roofTop) / 2),
        bearing,
      );
  for (const e of edges(p.projector))
    b.box(
      orange,
      [e.length, 0.32, 0.16],
      at(e, e.length / 2, roofTop + 0.22, -0.04),
      angle(e),
    );
}
function roofCore(b, p, mode) {
  const e = edges(points)[p.exteriorWindowEdge],
    center = at(e, e.length * 0.86, 0, -3.6),
    w = 5.3,
    d = 3.8;
  const r = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => [
    center[0] + ((e.dx / e.length) * u * w) / 2 + (e.normal[0] * v * d) / 2,
    center[2] + ((e.dz / e.length) * u * w) / 2 + (e.normal[1] * v * d) / 2,
  ]);
  if (!r.every((q) => contains(p.body, q) && !contains(p.hole, q))) return;
  b.shape(mode === "3d" ? "terracotta" : "volume", r, 18.18, 1.35);
  b.shape(mode === "3d" ? "roofDark" : "cap", r, 19.53, 0.1);
}
function stair(b, e, mode) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume";
  for (let level = 0; level < 4; level++) {
    const y0 = design.floorDatumsMeters[level],
      y1 = design.floorDatumsMeters[level + 1],
      d0 = level % 2 ? e.length - 1 : 1,
      d1 = level % 2 ? 1 : e.length - 1;
    const a = at(e, d0, y0 + 0.08, -1.45),
      c = at(e, d1, y1 + 0.08, -1.45);
    beam(b, mat, a, c, 0.18, 1.5);
    if (detail) {
      for (let i = 0; i < 16; i++) {
        const t = (i + 0.5) / 16;
        b.box(
          "ivory",
          [(e.length - 2) / 16 + 0.03, 0.14, 1.5],
          at(e, d0 + (d1 - d0) * t, y0 + (y1 - y0) * t, -1.45),
          angle(e),
        );
      }
      for (const offset of [-0.7, -2.2])
        beam(
          b,
          "metal",
          at(e, d0, y0 + 1, offset),
          at(e, d1, y1 + 1, offset),
          0.04,
        );
    }
  }
}
function make(mode) {
  const b = builder(mode),
    detail = mode === "3d",
    mat = detail ? "ivory" : "volume";
  b.shape(mat, points, 0.015, 0.075, holes);
  for (const [key, p] of Object.entries(parts)) {
    let body = p.body.map((q) => [...q]);
    let external = null;
    if (key === "G") {
      external = edges(points)[50];
      for (const sourceIndex of [50, 51]) {
        const i = p.bodyIndices.indexOf(sourceIndex);
        body[i] = [
          body[i][0] - external.normal[0] * 2.4,
          body[i][1] - external.normal[1] * 2.4,
        ];
      }
    }
    let ground = body;
    const entryEdge = edges(points)[p.exteriorWindowEdge],
      entryLo = entryEdge.length * 0.4,
      entryHi = entryEdge.length * 0.58;
    if (key === "F") {
      const i = p.bodyIndices.indexOf(p.exteriorWindowEdge),
        a = at(entryEdge, entryLo, 0),
        c = at(entryEdge, entryHi, 0),
        ai = at(entryEdge, entryLo, 0, -5),
        ci = at(entryEdge, entryHi, 0, -5);
      ground = body.flatMap((q, j) =>
        j === i
          ? [q, [a[0], a[2]], [ai[0], ai[2]], [ci[0], ci[2]], [c[0], c[2]]]
          : [q],
      );
    }
    const h = detail ? p.roomHole : p.hole;
    b.shape(mat, ground, 0.1, 3.6, [h]);
    b.shape(mat, body, 3.7, 14.35, [h]);
    b.shape(detail ? "roof" : "cap", p.body, 18.05, 0.18, [p.hole]);
    if (detail) for (const e of edges(p.hole, true)) gallery(b, e, mode);
    if (external) {
      gallery(b, external, mode, 2.4);
      stair(b, external, mode);
    }
    if (detail) {
      for (const [i, e] of edges(body).entries()) {
        const sourceIndex = p.bodyIndices[i];
        if (sourceIndex === 50 && key === "G") continue;
        facades(b, e, {
          orange: sourceIndex === p.exteriorWindowEdge,
          blue: design.blueBandSourceEdgeIndices.includes(sourceIndex),
          skipGroundInterval:
            key === "F" && sourceIndex === p.exteriorWindowEdge
              ? [entryLo, entryHi]
              : null,
        });
      }
      if (key === "F")
        for (const d of [entryLo, entryHi])
          b.box(
            "terracotta",
            [0.65, 3.5, 0.65],
            at(entryEdge, d, 1.9, -0.25),
            angle(entryEdge),
          );
      // A short skylight strip follows the diagonal corridor behind the front projector.
      const e = edges(p.body).find(
        (e) =>
          Math.abs(e.length - edges(points)[p.frontEdge].length) < 0.3 &&
          e.normal[0] > 0.5 &&
          e.normal[1] < -0.4,
      );
      if (e) {
        const a = at(e, 1.2, 18.32, -2.7),
          c = at(e, e.length - 1.2, 18.32, -2.7);
        beam(b, "roofDark", a, c, 0.12, 2.0);
        for (let d = 2; d < e.length - 1; d += 1.9)
          b.box("glazing", [1.65, 0.08, 1.7], at(e, d, 18.43, -2.7), angle(e));
      }
    }
    projector(b, p, mode);
    roofCore(b, p, mode);
  }
  for (const r of connectors) connector(b, r, mode);
  const scene = b.finish();
  scene.userData.labelBindings = campus.places
    .filter((p) => p.parentId === place.id)
    .map((p) => p.id);
  scene.userData.independentEFGBoundariesVerified = false;
  return scene;
}
await mkdir(folder, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  assets = {};
for (const mode of ["2.5d", "3d"]) {
  const scene = make(mode),
    bounds = new Box3(),
    matrix = new Matrix4(),
    instance = new Matrix4(),
    vertex = new Vector3(),
    mats = new Set();
  let triangles = 0,
    drawCalls = 0;
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
        bounds.expandByPoint(
          vertex.fromBufferAttribute(p, j).applyMatrix4(matrix),
        );
    }
  });
  const binary = Buffer.from(
    await new GLTFExporter().parseAsync(scene, {
      binary: true,
      copyright:
        "OSM parent footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified teaching E/F/G geometry. Owner describes five-storey height. Three source courtyards retained. Component boundaries and metric heights are visual approximations, not independent verified E/F/G footprints. No photo textures, surveyed interiors or navigation entrances.",
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
  const file = `teaching-e-f-g-${mode}.glb`;
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
const wgs84 = ([x, z]) => {
  const p = new MercatorCoordinate(
    origin.x + x * units,
    origin.y + z * units,
  ).toLngLat();
  return [p.lng, p.lat];
};
const close = (r) => [...r.map(wgs84), wgs84(r[0])];
const features = [
  {
    type: "Feature",
    id: "efg-source-base",
    properties: {
      placeId: place.id,
      part: "original_parent_base",
      base: 0.015,
      height: 0.09,
      sourceFootprint: true,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: place.geometryRings },
  },
];
for (const [key, p] of Object.entries(parts))
  for (const [type, r, base, height, inner] of [
    ["main", p.body, 0.1, 18.55, [p.hole]],
    ["projector", p.projector, 3.7, 14.82, []],
  ])
    features.push({
      type: "Feature",
      id: `efg-display-${key}-${type}`,
      properties: {
        placeId: place.id,
        part: `${key}-${type}`,
        base,
        height,
        heightScaleLevels: type === "main" ? 5 : null,
        parentHeightScaleLevels: 5,
        heightAccuracy: design.heightAccuracy,
        geometryAccuracy:
          "photo_informed_display_partition_not_independent_EFG_GIS",
        approvedForMap: false,
      },
      geometry: {
        type: "Polygon",
        coordinates: [close(r), ...inner.map(close)],
      },
    });
for (const [i, ring] of connectors.entries())
  features.push({
    type: "Feature",
    id: `efg-display-connector-${i}`,
    properties: {
      placeId: place.id,
      part: i === 0 ? "E-F-display-connector" : "F-G-display-connector",
      base: 3.58,
      height: 18.28,
      heightKind: "maximum_visual_envelope_open_storeys_in_GLB",
      heightAccuracy: design.heightAccuracy,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: [close(ring)] },
  });
await writeFile(
  `${folder}/teaching-e-f-g-2.5d.geojson`,
  JSON.stringify(
    {
      type: "FeatureCollection",
      stage: "visual_review_only_not_navigation_GIS",
      note: "Display envelopes; open galleries/connectors and rooftop frames are in GLBs. E/F/G divisions are not verified GIS boundaries.",
      features,
    },
    null,
    2,
  ) + "\n",
);
const labelBindings = campus.places
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
  sourceGeometryRingsWgs84: place.geometryRings,
  sourceFootprintSha256: sha(JSON.stringify(place.geometryRings)),
  footprintRingsLocalMeters: rings,
  sourceCourtyards: 3,
  sourceAreaMeters2: sourceArea,
  displayPartitionAreaMeters2: displayArea,
  labelBindings,
  independentEFGBoundariesVerified: false,
  heightScaleLevels: 5,
  levelsSource: design.levelsSource,
  heightAccuracy: design.heightAccuracy,
  interiorLevelsVerified: false,
  partEnvelopes: {
    complex: points,
    ...Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p.ring])),
  },
  displayParts: Object.fromEntries(
    Object.entries(parts).map(([k, p]) => [
      k,
      {
        outer: p.ring,
        body: p.body,
        projector: p.projector,
        courtyard: p.hole,
        roomVoid: p.roomHole,
      },
    ]),
  ),
  displayConnectors: connectors,
  alignedToLocal: { anchor, rotationYRadians: frameAngle },
  focusButtonsChangeCameraOnly: true,
  assets,
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      version: design.version,
      sourceAreaMeters2: sourceArea,
      displayPartitionAreaMeters2: displayArea,
      assets,
    },
    null,
    2,
  ),
);
