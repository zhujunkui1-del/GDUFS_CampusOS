// Offline display geometry for the four existing A-D footprints; never rewrites GIS.
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
const folder = "docs/model-previews/teaching-a-d-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
if (campus.mapVersion !== design.sourceMapVersion)
  throw new Error("Review fixed campus map version.");
const places = Object.fromEntries(
  Object.entries(design.placeIds).map(([key, id]) => [
    key,
    campus.places.find((p) => p.id === id),
  ]),
);
if (Object.values(places).some((p) => !p?.geometry))
  throw new Error("Missing A-D footprint.");
const origin = MercatorCoordinate.fromLngLat(places.C.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const anchor = [0, 0],
  frameAngle = 0;
const toLocal = (p) => {
  const q = MercatorCoordinate.fromLngLat(p);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
};
const buildings = Object.fromEntries(
  Object.entries(places).map(([key, p]) => [
    key,
    {
      place: p,
      rings: (p.geometryRings || [p.geometry]).map((r) =>
        r.slice(0, -1).map(toLocal),
      ),
    },
  ]),
);
const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const area = (r) =>
  r.reduce((s, a, i) => {
    const b = r[(i + 1) % r.length];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
function edges(ring, inner = false) {
  const sign = Math.sign(area(ring)) * (inner ? -1 : 1);
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length],
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
function extrusion(ring, y, height, holes = []) {
  const s = new Shape(ring.map(([x, z]) => new Vector2(x, -z)));
  for (const h of holes)
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
function lineIntersection(a, u, b, v) {
  const cross = (p, q) => p[0] * q[1] - p[1] * q[0],
    t = cross([b[0] - a[0], b[1] - a[1]], v) / cross(u, v);
  return [a[0] + u[0] * t, a[1] + u[1] * t];
}
// Both source courtyard holes are convex quadrilaterals. Expand the room void to recess galleries.
function expand(ring, width) {
  const es = edges(ring);
  return ring.map((p, i) => {
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
function clip(ring, axis, value, less) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      ai = less ? a[axis] <= value : a[axis] >= value,
      bi = less ? b[axis] <= value : b[axis] >= value;
    if (ai) out.push(a);
    if (ai !== bi) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
function removeRect(ring, [x0, z0, x1, z1]) {
  const middle = clip(clip(ring, 0, x0, false), 0, x1, true);
  return [
    clip(ring, 0, x0, true),
    clip(ring, 0, x1, false),
    clip(middle, 1, z0, true),
    clip(middle, 1, z1, false),
  ].filter((r) => r.length >= 3 && Math.abs(area(r)) > 0.001);
}
const clockRing = [0, 1, 2, 3, 4].map((i) => buildings.C.rings[0][i]);
const cBody = buildings.C.rings[0].filter((_, i) => ![1, 2, 3].includes(i));
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    terracotta: "#c38c60",
    ivory: "#e4e5de",
    roof: "#c8c3b2",
    roofDark: "#737b78",
    glazing: "#77949c",
    metal: "#a0aeaf",
    clockInk: "#3e5157",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Teaching-A-D-${mode}-owner-height-scale`;
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
    g = new BoxGeometry(delta.length(), width, depth);
  const direction = delta.normalize(),
    across = new Vector3()
      .crossVectors(direction, new Vector3(0, 1, 0))
      .normalize(),
    up = new Vector3().crossVectors(across, direction).normalize();
  g.applyMatrix4(new Matrix4().makeBasis(direction, up, across));
  g.translate(...from.add(to).multiplyScalar(0.5).toArray());
  b.geometry(mat, g);
}
const inRect = ([x, z], [a, b, c, d]) =>
  x > a - 0.15 && x < c + 0.15 && z > b - 0.15 && z < d + 0.15;
function windows(
  b,
  e,
  { orange = false, skipGround = null, base = 0.1, top = 18.1 } = {},
) {
  if (e.length < 1) return;
  const bearing = angle(e),
    n = Math.max(1, Math.floor(e.length / 3.3)),
    usable = e.length - 0.4;
  if (orange)
    b.plane(
      "terracotta",
      [e.length - 0.08, top - 3.7],
      at(e, e.length / 2, (top + 3.7) / 2, 0.035),
      bearing,
    );
  for (const datum of design.floorDatumsMeters.slice(0, 5)) {
    const y = datum + 1.85;
    if (y < base || y > top) continue;
    for (let i = 0; i < n; i++) {
      const d = 0.2 + ((i + 0.5) * usable) / n,
        p = at(e, d, y, 0.07);
      if (datum < 1 && skipGround && inRect([p[0], p[2]], skipGround)) continue;
      const width = Math.max(0.35, usable / n - 0.68);
      b.plane("glazing", [width, 1.85], p, bearing);
      for (const dy of [-0.95, 0.4, 0.95])
        b.plane("ivory", [width + 0.1, 0.06], at(e, d, y + dy, 0.115), bearing);
      b.plane("metal", [0.04, 1.9], at(e, d, y, 0.13), bearing);
    }
  }
  b.box(
    "ivory",
    [e.length, 0.45, 0.22],
    at(e, e.length / 2, 18.3, -0.02),
    bearing,
  );
}
function gallery(b, edge, mode, inset = 2.4) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume",
    roof = detail ? "ivory" : "cap",
    bearing = angle(edge);
  const a = at(edge, 0, 0),
    c = at(edge, edge.length, 0),
    r = [
      [a[0], a[2]],
      [c[0], c[2]],
      [c[0] - edge.normal[0] * inset, c[2] - edge.normal[1] * inset],
      [a[0] - edge.normal[0] * inset, a[2] - edge.normal[1] * inset],
    ];
  for (const y of design.floorDatumsMeters.slice(1, 5)) {
    b.shape(mat, r, y - 0.12, 0.22);
    b.box(
      mat,
      [edge.length, 0.55, 0.17],
      at(edge, edge.length / 2, y + 0.32, -0.03),
      bearing,
    );
    if (detail) {
      b.box(
        "metal",
        [edge.length, 0.045, 0.05],
        at(edge, edge.length / 2, y + 1.0, 0.04),
        bearing,
      );
    }
  }
  b.shape(roof, r, 18.05, 0.18);
  const n = Math.max(1, Math.ceil(edge.length / 4.6));
  for (let i = 0; i <= n; i++)
    b.box(
      mat,
      [0.24, 18.0, 0.24],
      at(edge, (edge.length * i) / n, 9.05, -0.08),
      bearing,
    );
  if (detail) {
    const back = {
      ...edge,
      a: [
        edge.a[0] - edge.normal[0] * inset,
        edge.a[1] - edge.normal[1] * inset,
      ],
    };
    windows(b, back);
    // Alternating finite posts avoid the cost of per-bar railing geometry.
    for (const y of design.floorDatumsMeters.slice(1, 5))
      for (let i = 0; i <= n; i++)
        b.box(
          "ivory",
          [0.25, 0.5, 0.18],
          at(edge, (edge.length * i) / n, y + 0.76, 0.025),
          bearing,
        );
  }
}
function pergola(b, [x0, z0, x1, z1], mode) {
  const mat = mode === "3d" ? "terracotta" : "cap",
    y = design.pergolaTopMeters;
  for (const x of [x0, x1])
    b.box(mat, [0.28, 0.3, z1 - z0 + 0.3], [x, y - 0.15, (z0 + z1) / 2]);
  for (let z = z0; z <= z1 + 0.05; z += 2.0)
    b.box(mat, [x1 - x0, 0.25, 0.28], [(x0 + x1) / 2, y - 0.13, z]);
  for (const x of [x0, x1])
    for (const z of [z0, z1])
      b.box(
        mode === "3d" ? "ivory" : "volume",
        [0.3, y - 18.1, 0.3],
        [x, (y + 18.1) / 2, z],
      );
}
function courtyardBlock(b, key, mode) {
  const detail = mode === "3d",
    { rings } = buildings[key],
    outer = rings[0],
    hole = rings[1],
    roomHole = expand(hole, design.galleryDepthMeters);
  b.shape(detail ? "ivory" : "volume", outer, 0.1, 17.95, [roomHole]);
  b.shape(detail ? "roof" : "cap", outer, 18.05, 0.12, [hole]);
  for (const e of edges(hole, true)) gallery(b, e, mode);
  if (detail)
    for (const e of edges(outer))
      windows(b, e, { orange: e.normal[0] < -0.6 || e.normal[1] > 0.6 });
  for (const r of design.pergolas[key]) pergola(b, r, mode);
  for (const r of design.roofCores[key]) {
    b.shape(detail ? "terracotta" : "volume", rect(...r), 18.17, 1.4);
    b.shape(detail ? "roofDark" : "cap", rect(...r), 19.57, 0.1);
  }
}
function teachingA(b, mode) {
  const detail = mode === "3d",
    ring = buildings.A.rings[0],
    portal = design.aPortalRectMeters,
    mat = detail ? "ivory" : "volume";
  const core = ring.map(([x, z]) => [
    x,
    z < 100 ? z + design.galleryDepthMeters : z,
  ]);
  for (const r of removeRect(core, portal)) b.shape(mat, r, 0.1, 18.0);
  const upper = clip(clip(core, 0, portal[0], false), 0, portal[2], true);
  b.shape(mat, upper, 14.5, 3.6);
  b.shape(detail ? "roof" : "cap", ring, 18.1, 0.15);
  const z0 = ring[0][1] + 1.2,
    z1 = ring[2][1] - 0.35;
  for (const x of [97.5, 104.8, 112.1])
    b.box(mat, [0.55, 14.4, 0.55], [x, 7.3, z1 - 0.3]);
  for (const y of [7.3, 10.9]) {
    b.box(
      mat,
      [portal[2] - portal[0], 0.23, 2.5],
      [(portal[0] + portal[2]) / 2, y, z0],
    );
    b.box(
      mat,
      [portal[2] - portal[0], 0.7, 0.2],
      [(portal[0] + portal[2]) / 2, y + 0.4, z0 + 1.3],
    );
  }
  if (detail) {
    for (const e of edges(ring)) {
      // Portal faces remain physically open below the upper teaching room.
      if (e.length > 30) {
        const cuts = [
          0,
          ((portal[0] - e.a[0]) * e.length) / e.dx,
          ((portal[2] - e.a[0]) * e.length) / e.dx,
          e.length,
        ].sort((a, b) => a - b);
        for (let i = 0; i < 3; i++) {
          const lo = Math.max(0, cuts[i]),
            hi = Math.min(e.length, cuts[i + 1]);
          if (hi - lo < 0.1) continue;
          const p = at(e, lo, 0),
            part = {
              ...e,
              a: [p[0], p[2]],
              length: hi - lo,
              dx: (e.dx * (hi - lo)) / e.length,
              dz: (e.dz * (hi - lo)) / e.length,
            };
          if (e.normal[1] < -0.9 && i !== 1) gallery(b, part, mode);
          else
            windows(b, part, {
              orange: i !== 1 && e.normal[1] > 0,
              base: i === 1 ? 14.6 : 0.1,
            });
        }
      } else windows(b, e, { orange: true });
    }
  }
  if (!detail) {
    for (const e of edges(ring).filter(
      (e) => e.normal[1] < -0.9 && e.length > 30,
    )) {
      for (const [lo, hi] of [
        [e.a[0], portal[0]],
        [portal[2], e.a[0] + e.dx],
      ]) {
        if (hi <= lo) continue;
        const d0 = ((lo - e.a[0]) * e.length) / e.dx;
        const p = at(e, d0, 0),
          length = ((hi - lo) * e.length) / e.dx;
        gallery(
          b,
          {
            ...e,
            a: [p[0], p[2]],
            length,
            dx: hi - lo,
            dz: (e.dz * length) / e.length,
          },
          mode,
        );
      }
    }
  }
  for (const r of design.roofCores.A) {
    b.shape(detail ? "terracotta" : "volume", rect(...r), 18.25, 1.5);
    b.shape(detail ? "roofDark" : "cap", rect(...r), 19.75, 0.1);
  }
}
function clock(b, mode) {
  const detail = mode === "3d",
    mat = detail ? "terracotta" : "volume";
  b.shape(mat, clockRing, 0.1, design.clockTopMeters - 0.1);
  const es = edges([clockRing[0], clockRing[1], clockRing[3], clockRing[4]]);
  const north = es.find((e) => e.normal[1] < -0.9),
    west = es.find((e) => e.normal[0] < -0.9);
  if (detail) {
    const front = at(north, north.length / 2, 12.35, 0.06),
      bearing = angle(north);
    b.plane("glazing", [north.length - 1.15, 24.1], front, bearing);
    for (let y = 0.5; y < 24.5; y += 2.95)
      b.plane(
        "ivory",
        [north.length - 1.05, 0.09],
        at(north, north.length / 2, y, 0.12),
        bearing,
      );
    for (const d of [
      0.55,
      north.length / 3,
      (north.length * 2) / 3,
      north.length - 0.55,
    ])
      b.plane("ivory", [0.08, 24.15], at(north, d, 12.35, 0.13), bearing);
    for (const e of [north, west]) {
      const size = Math.min(e.length - 0.45, 5.6),
        center = at(e, e.length / 2, design.clockCenterMeters, 0.15),
        a = angle(e);
      if (e === north) b.plane("ivory", [size + 0.25, size + 0.25], center, a);
      const transform = (x, y, z = 0.04) => [
        center[0] + x * Math.cos(a) + z * Math.sin(a),
        center[1] + y,
        center[2] - x * Math.sin(a) + z * Math.cos(a),
      ];
      for (let i = 0; i < 12; i++) {
        const t = (i * Math.PI) / 6,
          g = new PlaneGeometry(0.15, size * 0.11);
        g.rotateZ(-t);
        g.translate(
          Math.sin(t) * size * 0.35,
          Math.cos(t) * size * 0.35,
          0.045,
        );
        g.rotateY(a);
        g.translate(...center);
        b.geometry("clockInk", g);
      }
      // Fixed display hands (10:10), not a live time display or photograph texture.
      for (const [t, r] of [
        [-Math.PI / 3, size * 0.24],
        [Math.PI / 3, size * 0.32],
      ])
        beam(
          b,
          "clockInk",
          transform(0, 0),
          transform(Math.sin(t) * r, Math.cos(t) * r),
          0.1,
          0.1,
        );
    }
  }
  for (const y of [25.0, 30.55]) {
    const xs = clockRing.map((p) => p[0]),
      zs = clockRing.map((p) => p[1]);
    b.box(
      detail ? "ivory" : "cap",
      [
        Math.max(...xs) - Math.min(...xs) + 0.45,
        0.16,
        Math.max(...zs) - Math.min(...zs) + 0.4,
      ],
      [
        (Math.max(...xs) + Math.min(...xs)) / 2,
        y,
        (Math.max(...zs) + Math.min(...zs)) / 2,
      ],
    );
  }
  b.shape(detail ? "roofDark" : "cap", clockRing, design.clockTopMeters, 0.09);
  const fin = clockRing[1];
  b.box(
    mat,
    [0.22, 1.0, 6.2],
    [fin[0] + 0.15, design.clockTopMeters + 0.35, fin[1] + 3.1],
  );
}
function teachingC(b, mode) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume",
    portal = design.cPortalRectMeters;
  const ring = cBody.map((p) => [...p]);
  const cNorthIndex = ring.findIndex(
    (p) => p[0] === buildings.C.rings[0][5][0],
  );
  const e = edges(ring)[cNorthIndex],
    recess = design.galleryDepthMeters;
  ring[cNorthIndex] = [
    ring[cNorthIndex][0] - e.normal[0] * recess,
    ring[cNorthIndex][1] - e.normal[1] * recess,
  ];
  ring[cNorthIndex + 1] = [
    ring[cNorthIndex + 1][0] - e.normal[0] * recess,
    ring[cNorthIndex + 1][1] - e.normal[1] * recess,
  ];
  for (const r of removeRect(ring, portal)) b.shape(mat, r, 0.1, 3.6);
  b.shape(mat, ring, 3.7, 14.35);
  b.shape(detail ? "roof" : "cap", cBody, 18.05, 0.18);
  gallery(b, e, mode, recess);
  for (const x of [-47.4, -36.4])
    b.box(detail ? "terracotta" : "volume", [0.6, 3.6, 0.6], [x, 1.9, 2.3]);
  if (detail)
    for (const [i, edge] of edges(cBody).entries()) {
      if (i === cNorthIndex) continue;
      const midX = edge.a[0] + edge.dx / 2;
      if (midX < -28 && edge.normal[1] < -0.9) {
        const a = angle(edge),
          width = Math.min(3.6, edge.length * 0.28),
          d = edge.length * 0.32;
        b.plane(
          "terracotta",
          [edge.length, 17.95],
          at(edge, edge.length / 2, 9.08, 0.04),
          a,
        );
        b.plane("glazing", [width, 14.2], at(edge, d, 9.9, 0.11), a);
        for (const y of [2.85, 6.4, 9.95, 13.5, 17.0])
          b.plane("ivory", [width + 0.1, 0.14], at(edge, d, y, 0.16), a);
        b.box(
          "ivory",
          [edge.length, 0.45, 0.22],
          at(edge, edge.length / 2, 18.3, -0.02),
          a,
        );
      } else
        windows(b, edge, {
          orange:
            midX < -10.3 || edge.normal[1] > 0.5 || edge.normal[0] < -0.65,
          skipGround: portal,
        });
    }
  for (const r of design.pergolas.C) pergola(b, r, mode);
  clock(b, mode);
}
function connectors(b, mode) {
  const mat = mode === "3d" ? "ivory" : "volume";
  for (const r of design.displayConnectors) {
    const [x, z, w, d] = r.rectMeters;
    for (const y of r.floorDatumsMeters) {
      b.box(mat, [w, 0.2, d], [x, y, z]);
      if (mode === "3d")
        for (const dx of [-w / 2, w / 2])
          b.box("metal", [0.06, 0.95, d], [x + dx, y + 0.6, z]);
    }
    b.box(
      mode === "3d" ? "roofDark" : "cap",
      [w + 0.15, 0.16, d],
      [x, 18.2, z],
    );
  }
}
function make(mode, selection) {
  const b = builder(mode),
    keys = selection === "complex" ? ["A", "B", "C", "D"] : [selection];
  for (const key of keys) {
    const r = buildings[key].rings;
    b.shape(mode === "3d" ? "ivory" : "volume", r[0], 0.015, 0.075, r.slice(1));
    if (key === "A") teachingA(b, mode);
    else if (key === "C") teachingC(b, mode);
    else courtyardBlock(b, key, mode);
  }
  if (selection === "complex") connectors(b, mode);
  const scene = b.finish();
  scene.name = `CampusOS-Teaching-A-D-${selection}-${mode}`;
  scene.userData.placeIds = keys.map((k) => places[k].id);
  scene.userData.clockTowerHeightScaleLevels = keys.includes("C") ? 8 : null;
  return scene;
}
await mkdir(folder, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  allAssets = {};
for (const selection of ["complex", "A", "B", "C", "D"]) {
  allAssets[selection] = {};
  for (const mode of ["2.5d", "3d"]) {
    const scene = make(mode, selection),
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
          "OSM footprints © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified teaching A-D geometry. Owner describes five-storey main blocks and eight-storey C clock tower. Metric heights, facade subdivisions and connectors are visual approximations. Original B/D courtyard holes retained. No photo textures, surveyed interiors or new GIS/navigation facts.",
      }),
    );
    if (
      triangles > design.performance.triangleBudget ||
      drawCalls > design.performance.modelDrawCallBudget ||
      binary.length > design.performance.glbByteBudget
    )
      throw new Error(
        `${selection}/${mode} budget exceeded: ${triangles}/${drawCalls}/${binary.length}`,
      );
    const name =
        selection === "complex" ? "teaching-a-d" : `teaching-${selection}`,
      file = `${name}-${mode}.glb`;
    await writeFile(`${folder}/${file}`, binary);
    allAssets[selection][mode] = {
      url: `./${file}`,
      sha256: sha(binary),
      bytes: binary.length,
      triangles,
      drawCalls,
      materialCount: mats.size,
      textureCount: 0,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      origin: places.C.coordinate,
      placeIds: scene.userData.placeIds,
    };
  }
}
const wgs84 = ([x, z]) => {
  const p = new MercatorCoordinate(
    origin.x + x * units,
    origin.y + z * units,
  ).toLngLat();
  return [p.lng, p.lat];
};
const close = (r) => [...r.map(wgs84), wgs84(r[0])];
const features = Object.entries(buildings).map(([key, building]) => ({
  type: "Feature",
  id: `teaching-source-${key}`,
  properties: {
    placeId: building.place.id,
    part: key,
    base: 0.015,
    height: 0.09,
    sourceFootprint: true,
    heightAccuracy: design.heightAccuracy,
    approvedForMap: false,
  },
  geometry: {
    type: "Polygon",
    coordinates: building.place.geometryRings || [building.place.geometry],
  },
}));
for (const [key, building] of Object.entries(buildings)) {
  features.push({
    type: "Feature",
    id: `teaching-volume-${key}`,
    properties: {
      placeId: building.place.id,
      part: `${key}-main-volume`,
      base: 0.1,
      height: 18.55,
      heightScaleLevels: 5,
      heightAccuracy: design.heightAccuracy,
      geometryAccuracy:
        "source_envelope; open_entrance_and_gallery_geometry_in_GLB",
      approvedForMap: false,
    },
    geometry: {
      type: "Polygon",
      coordinates:
        key === "C"
          ? [close(cBody)]
          : building.place.geometryRings || [building.place.geometry],
    },
  });
}
features.push({
  type: "Feature",
  id: "teaching-C-clock",
  properties: {
    placeId: places.C.id,
    part: "C-clock-tower",
    base: 0.1,
    height: design.clockFinTopMeters,
    heightScaleLevels: 8,
    heightAccuracy: design.heightAccuracy,
    geometryAccuracy:
      "original_C_protrusion_photo_matched_to_clock; not_independent_OSM_clock_ID",
    approvedForMap: false,
  },
  geometry: { type: "Polygon", coordinates: [close(clockRing)] },
});
await writeFile(
  `${folder}/teaching-a-d-2.5d.geojson`,
  JSON.stringify(
    {
      type: "FeatureCollection",
      stage: "visual_review_only_not_navigation_GIS",
      note: "Volume envelopes only. Open portal/galleries/clock cornices/roof pergolas and approximate connectors are in GLBs; not indoor plans or navigation entrances.",
      features,
    },
    null,
    2,
  ) + "\n",
);
const sources = Object.fromEntries(
  Object.entries(buildings).map(([key, b]) => [
    key,
    {
      placeId: b.place.id,
      name: b.place.name,
      coordinate: b.place.coordinate,
      geometryRingsWgs84: b.place.geometryRings || [b.place.geometry],
      footprintSha256: sha(
        JSON.stringify(b.place.geometryRings || [b.place.geometry]),
      ),
      ringsLocalMeters: b.rings,
    },
  ]),
);
const points = Object.values(buildings).flatMap((b) => b.rings[0]);
const partEnvelopes = {
  complex: points,
  ...Object.fromEntries(
    Object.entries(buildings).map(([key, b]) => [key, b.rings[0]]),
  ),
};
const sourceArea = Math.abs(area(buildings.C.rings[0])),
  cPartsArea = Math.abs(area(cBody)) + Math.abs(area(clockRing));
if (Math.abs(sourceArea - cPartsArea) > 0.0001)
  throw new Error("Clock tower partition changed C source area.");
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  sourceMapVersion: campus.mapVersion,
  origin: places.C.coordinate,
  coordinateConvention: "east_up_south; every_component_uses_C_origin",
  sources,
  heightScaleLevels: 5,
  clockHeightScaleLevels: 8,
  levelsSource: design.levelsSource,
  heightAccuracy: design.heightAccuracy,
  interiorLevelsVerified: false,
  clockTowerPart: {
    placeId: places.C.id,
    ringLocalMeters: clockRing,
    heightScaleLevels: 8,
    maximumMeters: design.clockFinTopMeters,
    positionAccuracy:
      "photo_matched_original_C_north_protrusion_not_surveyed_clock_location",
    renderedExactlyOnce: true,
    partitionAreaMeters2: { source: sourceArea, sum: cPartsArea },
  },
  sourceCourtyards: 2,
  displayConnectors: design.displayConnectors,
  partEnvelopes,
  alignedToLocal: { anchor, rotationYRadians: frameAngle },
  assets: allAssets.complex,
  componentAssets: Object.fromEntries(
    ["A", "B", "C", "D"].map((key) => [key, allAssets[key]]),
  ),
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(allAssets).map(([key, assets]) => [
        key,
        Object.fromEntries(
          Object.entries(assets).map(([mode, a]) => [
            mode,
            { bytes: a.bytes, triangles: a.triangles, drawCalls: a.drawCalls },
          ]),
        ),
      ]),
    ),
    null,
    2,
  ),
);
