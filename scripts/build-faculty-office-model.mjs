// Independent faculty-office review. No formal campus geometry or previous model is modified.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
  Group,
  Shape,
  Path,
  ShapeUtils,
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
const folder = "docs/model-previews/faculty-office-v1",
  design = JSON.parse(await readFile(`${folder}/design.json`, "utf8")),
  campus = JSON.parse(
    await readFile("src/features/campus-map/data/campus.json", "utf8"),
  );
const place = campus.places.find((p) => p.id === design.placeId);
if (campus.mapVersion !== design.sourceMapVersion || !place?.geometry)
  throw new Error(
    "Review faculty-office source footprint before regeneration.",
  );
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const points = place.geometry.slice(0, -1).map((p) => {
  const q = MercatorCoordinate.fromLngLat(p);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
});
const anchor = [0, 0],
  frameAngle = 0,
  cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const signedArea = (r) =>
  r.reduce((s, p, i) => s + cross(p, r[(i + 1) % r.length]), 0) / 2;
function edges(ring) {
  const sign = Math.sign(signedArea(ring));
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
  ],
  angle = (e) => Math.atan2(e.normal[0], e.normal[1]);
function inset(ring, amount) {
  const all = edges(ring);
  return ring.map((p, i) => {
    const a = all[(i + all.length - 1) % all.length],
      b = all[i],
      p1 = [p[0] - a.normal[0] * amount, p[1] - a.normal[1] * amount],
      p2 = [p[0] - b.normal[0] * amount, p[1] - b.normal[1] * amount],
      den = cross([a.dx, a.dz], [b.dx, b.dz]);
    if (Math.abs(den) < 0.0001)
      return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const t = cross([p2[0] - p1[0], p2[1] - p1[1]], [b.dx, b.dz]) / den;
    return [p1[0] + a.dx * t, p1[1] + a.dz * t];
  });
}
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
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    ivory: "#e5e4db",
    red: "#b97762",
    stone: "#bcc6c0",
    glazing: "#68818b",
    roof: "#606c75",
    metal: "#a9b3b1",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Faculty-Office-${mode}-owner-height-scale`;
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

function fromTriangles(vertices) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  g.setAttribute(
    "uv",
    new Float32BufferAttribute(new Array((vertices.length / 3) * 2).fill(0), 2),
  );
  g.computeVertexNormals();
  return g;
}
function clip(poly, [a, b, c]) {
  if (poly.length < 3) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      v = a * p[0] + b * p[1] + c,
      w = a * q[0] + b * q[1] + c,
      pi = v >= -1e-9,
      qi = w >= -1e-9;
    if (pi) out.push(p);
    if (pi !== qi) {
      const t = v / (v - w);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out.filter((p, i) => {
    const q = out[(i + out.length - 1) % out.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7;
  });
}
function linesFor(r) {
  const sign = Math.sign(signedArea(r));
  return r.map((p, i) => {
    const q = r[(i + 1) % r.length],
      dx = q[0] - p[0],
      dz = q[1] - p[1];
    return [-dz * sign, dx * sign, (dz * p[0] - dx * p[1]) * sign];
  });
}
function subtractConvex(poly, lines) {
  let remainder = poly;
  const pieces = [];
  for (const line of lines) {
    if (remainder.length < 3) break;
    const outside = clip(
      remainder,
      line.map((n) => -n),
    );
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > 1e-6)
      pieces.push(outside);
    remainder = clip(remainder, line);
  }
  return pieces;
}
const bounds2 = (r) => ({
  x0: Math.min(...r.map((p) => p[0])),
  x1: Math.max(...r.map((p) => p[0])),
  z0: Math.min(...r.map((p) => p[1])),
  z1: Math.max(...r.map((p) => p[1])),
});
const overlaps = (a, b) =>
  a.x0 < b.x1 - 1e-8 &&
  a.x1 > b.x0 + 1e-8 &&
  a.z0 < b.z1 - 1e-8 &&
  a.z1 > b.z0 + 1e-8;
function planeFor(v) {
  const a = v[0],
    b = v[1],
    c = v[2],
    dx1 = b[0] - a[0],
    dz1 = b[2] - a[2],
    dy1 = b[1] - a[1],
    dx2 = c[0] - a[0],
    dz2 = c[2] - a[2],
    dy2 = c[1] - a[1],
    den = dx1 * dz2 - dx2 * dz1;
  const x = (dy1 * dz2 - dy2 * dz1) / den,
    z = (dx1 * dy2 - dx2 * dy1) / den;
  return [x, z, a[1] - x * a[0] - z * a[2]];
}
function hipFaces(spec, id) {
  const { x0, x1, z0, z1 } = spec,
    e = design.roofEavesMeters,
    p = design.roofPeakMeters,
    dx = x1 - x0,
    dz = z1 - z0;
  let faces;
  if (dx >= dz) {
    const z = (z0 + z1) / 2,
      r0 = [x0 + dz / 2, p, z],
      r1 = [x1 - dz / 2, p, z];
    faces = [
      [[x0, e, z1], [x1, e, z1], r1, r0],
      [[x1, e, z0], [x0, e, z0], r0, r1],
      [[x0, e, z0], [x0, e, z1], r0],
      [[x1, e, z1], [x1, e, z0], r1],
    ];
  } else {
    const x = (x0 + x1) / 2,
      r0 = [x, p, z0 + dx / 2],
      r1 = [x, p, z1 - dx / 2];
    faces = [
      [[x0, e, z0], [x0, e, z1], r1, r0],
      [[x1, e, z1], [x1, e, z0], r0, r1],
      [[x1, e, z0], [x0, e, z0], r0],
      [[x0, e, z1], [x1, e, z1], r1],
    ];
  }
  return faces.map((v) => {
    const ring = v.map((p) => [p[0], p[2]]);
    return {
      id,
      ring,
      plane: planeFor(v),
      lines: linesFor(ring),
      bounds: bounds2(ring),
    };
  });
}
function joinedHipRoof(b, mat) {
  // Offline clipping keeps only the upper surface where hip modules intersect.
  // Clip the result to the buffered original E outline, retaining both open courts.
  const facets = design.roofModules.flatMap(hipFaces),
    outline = inset(points, -design.roofOverhangMeters),
    tris = ShapeUtils.triangulateShape(
      outline.map((p) => new Vector2(...p)),
      [],
    ).map((t) => t.map((i) => outline[i]));
  const triangleClips = tris.map((r) => ({
      lines: linesFor(r),
      bounds: bounds2(r),
    })),
    vertices = [];
  for (const f of facets) {
    let pieces = [f.ring];
    for (const other of facets) {
      if (other.id === f.id || !overlaps(f.bounds, other.bounds)) continue;
      const delta = other.plane.map((n, i) => n - f.plane[i]);
      const same = delta.every((n) => Math.abs(n) < 1e-9);
      if (same && other.id < f.id) continue;
      const cuts = same ? other.lines : [...other.lines, delta];
      pieces = pieces.flatMap((poly) => subtractConvex(poly, cuts));
      if (!pieces.length) break;
    }
    for (const poly of pieces) {
      const bound = bounds2(poly);
      for (const t of triangleClips) {
        if (!overlaps(bound, t.bounds)) continue;
        let visible = poly;
        for (const line of t.lines) visible = clip(visible, line);
        if (visible.length < 3 || Math.abs(signedArea(visible)) < 1e-6)
          continue;
        for (let i = 1; i < visible.length - 1; i++) {
          const ring =
            signedArea(visible) > 0
              ? [visible[0], visible[i + 1], visible[i]]
              : [visible[0], visible[i], visible[i + 1]];
          for (const [x, z] of ring)
            vertices.push(x, f.plane[0] * x + f.plane[1] * z + f.plane[2], z);
        }
      }
    }
  }
  b.geometry(mat, fromTriangles(vertices));
  return vertices.length / 9;
}
function rod(b, mat, p, q, width) {
  const a = new Vector3(...p),
    c = new Vector3(...q),
    g = new BoxGeometry(width, width, a.distanceTo(c)),
    m = new Matrix4().lookAt(c, a, new Vector3(0, 1, 0));
  m.setPosition(a.add(c).multiplyScalar(0.5));
  g.applyMatrix4(m);
  b.geometry(mat, g);
}
function porticoRoof(b, mat) {
  const { x0, x1, z0, z1, eavesMeters: e, ridgeMeters: p } = design.portico,
    v = [];
  const tri = (a, c, d) => v.push(...a, ...c, ...d),
    quad = (a, c, d, f) => {
      tri(a, c, d);
      tri(a, d, f);
    };
  quad([x0, e, z0], [x0, p, 0], [x1, p, 0], [x1, e, z0]);
  quad([x0, p, 0], [x0, e, z1], [x1, e, z1], [x1, p, 0]);
  b.geometry(mat, fromTriangles(v));
}
function cornerTower(b, mode) {
  const mono = mode === "2.5d",
    wall = mono ? "volume" : "ivory",
    roof = mono ? "cap" : "roof",
    cx = -44.4,
    cz = -30.5,
    r = 2.7,
    ring = Array.from({ length: 8 }, (_, i) => [
      cx + r * Math.cos((i * Math.PI) / 4),
      cz + r * Math.sin((i * Math.PI) / 4),
    ]);
  b.shape(wall, ring, 0.15, 14.45);
  const exterior = inset(ring, -0.45),
    v = [];
  for (let i = 0; i < 8; i++) {
    const a = exterior[i],
      c = exterior[(i + 1) % 8];
    v.push(a[0], 14.8, a[1], cx, 18.1, cz, c[0], 14.8, c[1]);
  }
  b.geometry(roof, fromTriangles(v));
  if (!mono)
    for (const e of edges(ring)) {
      b.plane(
        "glazing",
        [e.length - 0.3, 13.5],
        at(e, e.length / 2, 7.55, 0.08),
        angle(e),
      );
      b.box("ivory", [0.28, 14.0, 0.28], [e.a[0], 7.55, e.a[1]]);
      for (const y of design.floorElevationsMeters.slice(1))
        b.box(
          "ivory",
          [e.length, 0.2, 0.25],
          at(e, e.length / 2, y, 0.13),
          angle(e),
        );
    }
}
function makeModel(mode) {
  const b = builder(mode),
    mono = mode === "2.5d",
    wall = mono ? "volume" : "ivory",
    roof = mono ? "cap" : "roof",
    floors = design.floorElevationsMeters,
    top = floors.at(-1);
  b.shape(wall, points, 0.02, 0.13);
  b.shape(wall, points, 0.15, top - 0.15);
  const roofTriangles = joinedHipRoof(b, roof);
  cornerTower(b, mode);
  porticoRoof(b, roof);
  if (!mono) {
    const all = edges(points),
      front = all[5],
      frontD = front.length * 0.46;
    b.box(
      "red",
      [19.0, 10.4, 0.18],
      at(front, frontD, 6.0, 0.07),
      angle(front),
    );
    for (const e of all) {
      const bays = Math.max(1, Math.round(e.length / 4.8));
      for (let i = 0; i <= bays; i++) {
        const d = (e.length * i) / bays;
        b.box(
          "ivory",
          [0.35, top - 0.55, 0.42],
          at(e, d, (top + 0.55) / 2, 0.08),
          angle(e),
        );
        b.plane("stone", [0.32, 9.0], at(e, d, 5.05, 0.34), angle(e));
      }
      for (let level = 0; level < 4; level++) {
        const base = floors[level],
          y = (base + floors[level + 1]) / 2 + 0.15;
        b.box(
          "ivory",
          [e.length, 0.2, 0.25],
          at(e, e.length / 2, base + 3.18, 0.1),
          angle(e),
        );
        if (level > 0)
          b.box(
            "red",
            [e.length, 0.58, 0.16],
            at(e, e.length / 2, base + 0.45, 0.05),
            angle(e),
          );
        for (let i = 0; i < bays; i++) {
          const d = (e.length * (i + 0.5)) / bays,
            offset = e === front && Math.abs(d - frontD) < 9.5 ? 0.25 : 0.11;
          b.plane(
            "glazing",
            [Math.max(0.7, Math.min(3.25, e.length / bays - 0.6)), 2.1],
            at(e, d, y, offset),
            angle(e),
          );
          b.plane("metal", [0.07, 2.1], at(e, d, y, offset + 0.065), angle(e));
          b.plane(
            "metal",
            [Math.max(0.7, Math.min(3.25, e.length / bays - 0.6)), 0.06],
            at(e, d, y + 0.5, offset + 0.065),
            angle(e),
          );
        }
      }
      b.box(
        "ivory",
        [e.length, 0.22, 0.34],
        at(e, e.length / 2, top + 0.1, 0.1),
        angle(e),
      );
    }
    // Light links visible between the three wings; no walls or route edges are created.
    for (const [z0, z1] of [
      [-23.0, -7.9],
      [7.8, 26.5],
    ]) {
      for (const x of [4.5, 6.5]) {
        b.box("ivory", [0.18, 0.22, z1 - z0], [x, 4.1, (z0 + z1) / 2]);
        for (const z of [z0 + 0.6, z1 - 0.6])
          b.box("ivory", [0.22, 3.8, 0.22], [x, 2.1, z]);
      }
      for (let z = z0 + 1; z < z1; z += 2.5)
        b.box("ivory", [2.3, 0.16, 0.15], [5.5, 4.15, z]);
    }
    // The west-facing entrance uses a shallow gable, stone piers, arch and curved treads.
    for (const z of [-6.2, 6.2]) {
      b.box("stone", [1.4, 10.0, 1.4], [-56.5, 5.55, z]);
      b.box("ivory", [1.85, 0.38, 1.85], [-56.5, 10.65, z]);
      for (let y = 1; y < 10.4; y += 0.65)
        b.plane("metal", [1.3, 0.025], [-57.21, y, z], -Math.PI / 2);
    }
    const upper = [],
      lower = [];
    for (let i = 0; i <= 20; i++) {
      const u = -6.15 + (12.3 * i) / 20,
        y = 10.35 - 1.25 * (u / 6.15) ** 2;
      upper.push(new Vector2(u, y));
      lower.push(new Vector2(u, y - 0.3));
    }
    const shape = new Shape([...upper, ...lower.reverse()]),
      arch = new ExtrudeGeometry(shape, {
        depth: 0.5,
        steps: 1,
        bevelEnabled: false,
      });
    arch.rotateY(-Math.PI / 2);
    arch.translate(-56.05, 0, 0);
    b.geometry("ivory", arch);
    b.box("ivory", [0.45, 1.35, 12.8], [-56.4, 7.5, 0]);
    const pp = design.portico;
    b.geometry(
      "ivory",
      fromTriangles(
        [
          [pp.x0, pp.eavesMeters, pp.z1],
          [pp.x0, pp.ridgeMeters, 0],
          [pp.x0, pp.eavesMeters, pp.z0],
        ].flat(),
      ),
    );
    rod(
      b,
      "ivory",
      [pp.x0 - 0.03, pp.eavesMeters, pp.z0],
      [pp.x0 - 0.03, pp.ridgeMeters, 0],
      0.2,
    );
    rod(
      b,
      "ivory",
      [pp.x0 - 0.03, pp.ridgeMeters, 0],
      [pp.x0 - 0.03, pp.eavesMeters, pp.z1],
      0.2,
    );
    b.plane("glazing", [7.5, 3.6], [-48.32, 2.45, 0], -Math.PI / 2);
    for (const z of [-3.7, 0, 3.7])
      b.box("metal", [0.12, 3.7, 0.08], [-48.42, 2.45, z]);
    for (let step = 0; step < 6; step++) {
      const ring = [];
      for (let i = 0; i <= 16; i++) {
        const t = -Math.PI / 2 + (Math.PI * i) / 16;
        ring.push([
          -56.6 - (3.5 - step * 0.34) * Math.cos(t),
          (8.4 - step * 0.27) * Math.sin(t),
        ]);
      }
      b.shape("stone", ring, 0, (step + 1) * 0.1);
    }
  } else
    b.shape(
      wall,
      [
        [design.portico.x0, -7.5],
        [design.portico.x1, -7.5],
        [design.portico.x1, 7.5],
        [design.portico.x0, 7.5],
      ],
      0.15,
      design.portico.eavesMeters - 0.15,
    );
  const scene = b.finish();
  scene.userData.roofTriangles = roofTriangles;
  return scene;
}
await mkdir(folder, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  assets = {};
for (const mode of ["2.5d", "3d"]) {
  const scene = makeModel(mode),
    bounds = new Box3(),
    mats = new Set(),
    matrix = new Matrix4(),
    instance = new Matrix4(),
    vertex = new Vector3();
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
        "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified Faculty Office geometry. Owner height description four storeys; metric heights, roofs, portico and facade details visual estimates. No photo textures, surveyed interior layout or new navigation entrances.",
    }),
  );
  if (
    triangles > design.performance.triangleBudget ||
    drawCalls > design.performance.modelDrawCallBudget ||
    binary.length > design.performance.glbByteBudget
  )
    throw new Error(
      `Faculty ${mode} budget exceeded: ${triangles} / ${drawCalls} / ${binary.length}`,
    );
  const file = `faculty-office-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  assets[mode] = {
    url: `./${file}`,
    sha256: sha(binary),
    bytes: binary.length,
    triangles,
    drawCalls,
    materialCount: mats.size,
    textureCount: 0,
    roofTriangles: scene.userData.roofTriangles,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
}
const wgs84 = ([x, z]) => {
    const p = new MercatorCoordinate(
      origin.x + x * units,
      origin.y + z * units,
    ).toLngLat();
    return [p.lng, p.lat];
  },
  closed = (r) => [...r.map(wgs84), wgs84(r[0])];
const porchRing = [
  [design.portico.x0, design.portico.z0],
  [design.portico.x1, design.portico.z0],
  [design.portico.x1, design.portico.z1],
  [design.portico.x0, design.portico.z1],
];
const volumes = {
  type: "FeatureCollection",
  stage: "visual_review_only_not_navigation_GIS",
  features: [
    ["source_main", points, 18.1],
    ["portico_display_overlay", porchRing, design.portico.ridgeMeters],
  ].map(([part, ring, height]) => ({
    type: "Feature",
    id: `faculty-office-preview-${part}`,
    properties: {
      placeId: place.id,
      part,
      height,
      heightAccuracy: design.heightAccuracy,
      heightScaleLevels: 4,
      heightKind: "maximum_visual_envelope_roofs_in_GLB",
      geometryAccuracy:
        part === "source_main"
          ? "original_source_ring"
          : "photo_informed_display_overlay_not_source_GIS",
      interiorLevelsVerified: false,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: [closed(ring)] },
  })),
};
await writeFile(
  `${folder}/faculty-office-2.5d.geojson`,
  JSON.stringify(volumes, null, 2) + "\n",
);
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  placeId: place.id,
  sourceMapVersion: campus.mapVersion,
  origin: place.coordinate,
  sourceGeometryWgs84: place.geometry,
  footprintSha256: sha(JSON.stringify(place.geometry)),
  heightScaleLevels: 4,
  levelsSource: design.levelsSource,
  interiorLevelsVerified: false,
  heightAccuracy: design.heightAccuracy,
  appearanceAccuracy: design.appearanceAccuracy,
  roofMethod:
    "offline_upper_envelope_of_hip_planes_clipped_to_buffered_E_outline",
  footprintAlignedMeters: points,
  previewEnvelopeAlignedMeters: [...points, [-61.5, -9], [-61.5, 9]],
  alignedToLocal: { anchor: [0, 0], rotationYRadians: 0 },
  assets,
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({ modelVersion: manifest.modelVersion, assets }, null, 2),
);
