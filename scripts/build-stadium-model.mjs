// Stadium grandstand visual draft. Field, running track and original map stay read-only.
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
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  folder = "docs/model-previews/stadium-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8")),
  campus = JSON.parse(
    await readFile("src/features/campus-map/data/campus.json", "utf8"),
  ),
  map = JSON.parse(
    await readFile(
      "src/features/campus-map/data/local-map-manifest.json",
      "utf8",
    ),
  );
const mapBytes = await readFile(`public${map.url}`);
if (
  sha(mapBytes) !== map.sha256 ||
  campus.mapVersion !== design.sourceMapVersion
)
  throw new Error("Review stadium map source.");
const mapData = JSON.parse(mapBytes),
  place = campus.places.find((p) => p.id === design.placeId),
  stand = mapData.features.find((f) => f.id === design.footprintSourceId),
  track = mapData.features.find((f) => f.id === design.trackSourceId);
if (!place?.geometry || stand?.geometry?.coordinates[0].length !== 23)
  throw new Error("Review field and grandstand mapping.");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const local = (p) => {
  const q = MercatorCoordinate.fromLngLat(p);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
};
const source = stand.geometry.coordinates[0].slice(0, -1).map(local),
  anchor = source[0],
  phi = Math.atan2(source[6][1] - anchor[1], source[6][0] - anchor[0]),
  cos = Math.cos(phi),
  sin = Math.sin(phi),
  frameAngle = -phi;
const align = ([x, z]) => [
  (x - anchor[0]) * cos + (z - anchor[1]) * sin,
  -(x - anchor[0]) * sin + (z - anchor[1]) * cos,
];
const points = source.map(align),
  length = points[6][0],
  front = points.slice(0, 7),
  rear = [points[0], ...points.slice(6).reverse()].sort((a, b) => a[0] - b[0]);
function profile(r, x) {
  for (let i = 1; i < r.length; i++)
    if (x <= r[i][0] + 1e-6) {
      const a = r[i - 1],
        b = r[i],
        t = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t));
    }
  return r.at(-1)[1];
}
const frontZ = (x) => profile(front, x),
  rearZ = (x) => profile(rear, x),
  archFactor = (x) => Math.max(0, 1 - ((x - length / 2) / (length / 2)) ** 2);
const frontHeight = (x) =>
  design.roofTipMeters +
  (design.roofFrontCrownMeters - design.roofTipMeters) * archFactor(x) ** 0.72;
const rearHeight = (x) =>
  design.roofTipMeters +
  (design.roofRearCrownMeters - design.roofTipMeters) * archFactor(x) ** 0.65;
const roofPoint = (x, t, lift = 0) => [
  x,
  (1 - t) * frontHeight(x) +
    t * rearHeight(x) +
    1.1 * Math.sin(Math.PI * t) * archFactor(x) +
    lift,
  frontZ(x) * (1 - t) + rearZ(x) * t,
];
const area = (r) =>
  Math.abs(
    r.reduce((s, a, i) => {
      const b = r[(i + 1) % r.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2,
  );
function extrusion(r, y, h, holes = []) {
  const s = new Shape(r.map(([x, z]) => new Vector2(x, -z)));
  for (const hole of holes)
    s.holes.push(new Path(hole.map(([x, z]) => new Vector2(x, -z))));
  const g = new ExtrudeGeometry(s, {
    depth: h,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
function meshData(v, indices) {
  // Open skylight slots leave unused grid vertices; compact them before normals/export.
  const used = [...new Set(indices)],
    remap = new Map(used.map((value, i) => [value, i]));
  if (used.length < v.length / 3) {
    v = used.flatMap((i) => v.slice(i * 3, i * 3 + 3));
    indices = indices.map((i) => remap.get(i));
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(v, 3));
  g.setAttribute(
    "uv",
    new Float32BufferAttribute(new Array((v.length / 3) * 2).fill(0), 2),
  );
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
function ribbon(pairs) {
  const v = pairs.flat(2),
    ind = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    const a = i * 2;
    ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return meshData(v, ind);
}
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    ivory: "#dddeda",
    structure: "#e2e7e0",
    roof: "#9e9e92",
    skylight: "#b8cccd",
    glazing: "#6b8089",
    orange: "#cd7653",
    blue: "#4f92b4",
    red: "#b95664",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Stadium-${mode}-owner-height-scale`;
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
      if (
        [
          "glazing",
          "orange",
          "red",
          "blue",
          "roof",
          "cap",
          "skylight",
        ].includes(name)
      )
        material.side = DoubleSide;
      return [name, material];
    }),
  );
  const geometryBuckets = new Map(),
    instances = new Map();
  function geometry(material, g) {
    if (!geometryBuckets.has(material)) geometryBuckets.set(material, []);
    if (!g.index)
      g.setIndex(
        Array.from({ length: g.attributes.position.count }, (_, i) => i),
      );
    geometryBuckets.get(material).push(g);
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
  function segment(mat, a, c, radius) {
    const from = new Vector3(...a),
      to = new Vector3(...c),
      delta = to.clone().sub(from);
    const key = `${mat}:tube`;
    if (!instances.has(key)) instances.set(key, []);
    const matrix = new Matrix4().compose(
      from.add(to).multiplyScalar(0.5),
      new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        delta.clone().normalize(),
      ),
      new Vector3(radius, delta.length(), radius),
    );
    instances.get(key).push(matrix);
  }
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
            : type === "seat"
              ? meshData(
                  [
                    -0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5,
                    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5,
                  ],
                  [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
                )
              : new CylinderGeometry(1, 1, 1, 6, 1, true);
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
  return { geometry, shape, piece, box, plane, segment, finish };
}

function seats(b, mode) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume",
    rowCount = detail ? design.seatRows : 12,
    tread = detail
      ? design.seatTreadMeters
      : (design.seatRows * design.seatTreadMeters) / 12,
    rise = detail
      ? design.seatRiserMeters
      : (design.seatRows * design.seatRiserMeters) / 12;
  let count = 0;
  for (let row = 0; row < rowCount; row++) {
    const depth = 2 + (row + 1) * tread,
      feasible = [];
    for (let x = 7; x < length - 7; x += 0.15)
      if (frontZ(x) - rearZ(x) > depth + 2.6) feasible.push(x);
    if (!feasible.length) continue;
    const lo = feasible[0],
      hi = feasible.at(-1),
      n = 40,
      y = design.seatFrontMeters + row * rise,
      pairs = [];
    for (let i = 0; i <= n; i++) {
      const x = lo + ((hi - lo) * i) / n;
      pairs.push([
        [x, y, frontZ(x) - 2 - row * tread],
        [x, y, frontZ(x) - 2 - (row + 1) * tread],
      ]);
    }
    b.geometry(mat, ribbon(pairs));
    const riser = pairs.map(([a]) => [[a[0], y - rise, a[2]], a]);
    b.geometry(mat, ribbon(riser));
    if (!detail || row === design.middleAisleRow) continue;
    for (let section = 0; section < 7; section++) {
      const span = (length - 20) / 7,
        a = 10 + section * span + 0.7,
        c = 10 + (section + 1) * span - 0.7,
        color = design.seatSectionColors[section];
      for (let i = 0; i < design.seatsPerSection; i++) {
        const x = a + ((c - a) * (i + 0.5)) / design.seatsPerSection;
        if (x < lo + 0.3 || x > hi - 0.3) continue;
        const portals = [2, 3, 4, 5].map((k) => 10 + k * span);
        if (row >= 8 && row <= 13 && portals.some((p) => Math.abs(x - p) < 1.7))
          continue;
        b.piece(
          color,
          "seat",
          [0.46, 0.48, 0.42],
          [x, y + 0.12, frontZ(x) - 2 - (row + 0.55) * tread],
        );
        count++;
      }
    }
  }
  if (detail) {
    const span = (length - 20) / 7;
    for (const k of [2, 3, 4, 5]) {
      const x = 10 + k * span,
        y = design.seatFrontMeters + 11 * design.seatRiserMeters,
        z = frontZ(x) - 2 - 11 * design.seatTreadMeters;
      b.box("ivory", [2.7, 1.9, 2.8], [x, y + 0.7, z - 0.7]);
      b.plane("glazing", [1.8, 1.5], [x, y + 0.65, z + 0.73]);
    }
  }
  return count;
}
function archP(x, kind) {
  return kind === 0
    ? [x, frontHeight(x) + 2.0, frontZ(x) + 0.3]
    : kind === 1
      ? [x, frontHeight(x) - 0.65, frontZ(x) + 0.3]
      : [x, frontHeight(x) - 0.45, frontZ(x) - 1.6];
}
function canopy(b, mode) {
  const detail = mode === "3d",
    stations = [
      ...new Set([
        ...points.map((p) => p[0]),
        ...design.skylightStations.flatMap((t) => [
          length * t - 0.65,
          length * t + 0.65,
        ]),
        ...Array.from(
          { length: detail ? 49 : 25 },
          (_, i) => (length * i) / (detail ? 48 : 24),
        ),
      ]),
    ]
      .sort((a, b) => a - b)
      .filter((x, i, all) => i === 0 || x - all[i - 1] > 1e-6),
    ts = [
      ...new Set([
        0,
        0.12,
        0.85,
        1,
        ...Array.from(
          { length: detail ? 15 : 9 },
          (_, i) => i / (detail ? 14 : 8),
        ),
      ]),
    ].sort((a, b) => a - b),
    nz = ts.length - 1,
    v = [],
    rows = [],
    ind = [];
  for (let i = 0; i < stations.length; i++) {
    const x = stations[i],
      r = [];
    if (i === 0 || i === stations.length - 1) {
      r.push(v.length / 3);
      v.push(...roofPoint(x, 0));
    } else
      for (let j = 0; j <= nz; j++) {
        r.push(v.length / 3);
        v.push(...roofPoint(x, ts[j]));
      }
    rows.push(r);
  }
  // t increases towards the rear (-z), giving upward winding in this aligned frame.
  for (let i = 0; i < rows.length - 1; i++)
    for (let j = 0; j < nz; j++) {
      const middleX = (stations[i] + stations[i + 1]) / 2,
        middleT = (ts[j] + ts[j + 1]) / 2;
      if (
        middleT > 0.12 &&
        middleT < 0.85 &&
        design.skylightStations.some(
          (t) => Math.abs(middleX - length * t) < 0.6499,
        )
      )
        continue;
      if (i === 0) ind.push(rows[0][0], rows[1][j], rows[1][j + 1]);
      else if (i === rows.length - 2)
        ind.push(rows[i][j], rows[i + 1][0], rows[i][j + 1]);
      else {
        const a = rows[i][j],
          c = rows[i + 1][j],
          d = rows[i + 1][j + 1],
          e = rows[i][j + 1];
        ind.push(a, c, e, c, d, e);
      }
    }
  b.geometry(detail ? "roof" : "cap", meshData(v, ind));
  for (const t of design.skylightStations) {
    const x = length * t,
      w = 0.65,
      pairs = [];
    for (let i = 0; i <= 10; i++) {
      const z = 0.12 + (0.73 * i) / 10;
      pairs.push([roofPoint(x + w, z, 0.12), roofPoint(x - w, z, 0.12)]);
    }
    b.geometry(detail ? "skylight" : "cap", ribbon(pairs));
  }
  if (!detail) {
    const pairs = Array.from({ length: 33 }, (_, i) => [
      archP((length * i) / 32, 1),
      archP((length * i) / 32, 0),
    ]);
    b.geometry("cap", ribbon(pairs));
    return;
  }
  const n = 28;
  for (let i = 0; i < n; i++) {
    const x0 = (length * i) / n,
      x1 = (length * (i + 1)) / n;
    for (let k = 0; k < 3; k++)
      b.segment("structure", archP(x0, k), archP(x1, k), 0.14);
    b.segment("structure", archP(x0, 0), archP(x0, 1), 0.065);
    b.segment("structure", archP(x0, 0), archP(x0, 2), 0.065);
    b.segment("structure", archP(x0, 1), archP(x0, 2), 0.065);
    b.segment("structure", archP(x0, 0), archP(x1, 1), 0.065);
    b.segment("structure", archP(x0, 1), archP(x1, 2), 0.055);
    b.segment("structure", archP(x0, 2), archP(x1, 0), 0.06);
  }
  for (let i = 0; i <= 40; i++) {
    if (i < 40) {
      const x0 = (length * i) / 40,
        x1 = (length * (i + 1)) / 40;
      b.segment(
        "structure",
        roofPoint(x0, 1, -0.1),
        roofPoint(x1, 1, -0.1),
        0.16,
      );
    }
  }
  for (let i = 1; i <= 12; i++) {
    const x = (length * i) / 13;
    for (let j = 0; j < 4; j++) {
      const a = roofPoint(x, j / 4, -0.12),
        c = roofPoint(x, (j + 1) / 4, -0.12),
        d = [a[0], a[1] - 0.9, a[2]],
        e = [c[0], c[1] - 0.9, c[2]];
      b.segment("structure", a, c, 0.075);
      b.segment("structure", d, e, 0.07);
      b.segment("structure", a, e, 0.045);
      b.segment("structure", a, d, 0.04);
    }
  }
}
function mast(b, x, sign, mode) {
  const detail = mode === "3d",
    mat = detail ? "structure" : "volume",
    z = -4,
    top = [x + sign * 2, design.mastTopMeters, z - 1];
  b.box(detail ? "ivory" : "volume", [3.2, 0.7, 3.2], [x, 0.35, z]);
  if (detail) {
    for (const dz of [-0.9, 0.9])
      b.segment(
        mat,
        [x, 0.7, z + dz],
        [top[0], top[1], top[2] + dz * 0.3],
        0.23,
      );
    for (const y of [10, 21, 30]) {
      const t = y / design.mastTopMeters,
        cx = x + (top[0] - x) * t,
        cz = z + (top[2] - z) * t;
      b.segment(mat, [cx - 0.9, y, cz - 1.5], [cx + 0.9, y, cz - 1.5], 0.09);
      b.segment(mat, [cx - 0.9, y, cz - 1.5], [cx, y, cz + 1.4], 0.09);
      b.segment(mat, [cx + 0.9, y, cz - 1.5], [cx, y, cz + 1.4], 0.09);
    }
    for (const fraction of [sign < 0 ? 0.22 : 0.78, 0.5])
      b.segment(mat, top, archP(length * fraction, 0), 0.025);
    for (const zz of [-14, 11]) {
      const ground = [x + sign * 7, 0.25, zz];
      b.segment(mat, top, ground, 0.025);
      b.box("ivory", [1.4, 0.5, 1.4], [ground[0], 0.25, ground[2]]);
    }
  } else b.segment(mat, [x, 0.7, z], top, 0.3);
}
function staircase(b, x, mode) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume",
    z = rearZ(x) - 5.5;
  for (let flight = 0; flight < 2; flight++) {
    const y0 = 0.15 + flight * 3,
      y1 = 0.15 + (flight + 1) * 3,
      a = [x - 6 + flight * 6, y0, z],
      c = [x + flight * 6, y1, z];
    // A solid white stringer and shared treads stay finite at inspection distance.
    const dx = c[0] - a[0],
      dy = c[1] - a[1],
      g = new BoxGeometry(Math.hypot(dx, dy), 0.2, 2.4);
    g.rotateZ(Math.atan2(dy, dx));
    g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, z);
    b.geometry(mat, g);
    if (detail) {
      for (let i = 0; i < 16; i++) {
        const t = (i + 0.5) / 16;
        b.box(
          "ivory",
          [6 / 16 + 0.02, 0.19, 2.4],
          [a[0] + 6 * t, y0 + 3 * t, z],
        );
      }
      for (const zz of [-1.2, 1.2]) {
        b.segment(
          "structure",
          [a[0], y0 + 1, z + zz],
          [c[0], y1 + 1, z + zz],
          0.045,
        );
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          b.segment(
            "structure",
            [a[0] + 6 * t, y0 + 3 * t, z + zz],
            [a[0] + 6 * t, y0 + 3 * t + 1, z + zz],
            0.035,
          );
        }
      }
    }
  }
  b.box(mat, [3, 0.2, 2.7], [x, 3.15, z]);
  b.box(mat, [3, 0.22, 7], [x + 6, 6.16, z + 2.5]);
}
function rearBuilding(b, mode) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume",
    start = 10,
    end = length - 10,
    n = 40,
    wall = [];
  for (let i = 0; i <= n; i++) {
    const x = start + ((end - start) * i) / n,
      z = rearZ(x) + 2.6;
    wall.push([
      [x, 6, z],
      [x, 0.1, z],
    ]);
  }
  b.geometry(mat, ribbon(wall));
  const gallery = [];
  for (let i = 0; i <= n; i++) {
    const x = start + ((end - start) * i) / n,
      z = rearZ(x);
    gallery.push([
      [x, 6.15, z + 3.8],
      [x, 6.15, z + 0.5],
    ]);
  }
  b.geometry(mat, ribbon(gallery));
  for (let i = 0; i <= 14; i++) {
    const x = start + ((end - start) * i) / 14,
      z = rearZ(x) + 0.6,
      top = rearHeight(x) - 0.35;
    b.segment(detail ? "structure" : "volume", [x, 0.2, z], [x, top, z], 0.26);
    if (i < 14) {
      const next = start + ((end - start) * (i + 1)) / 14;
      b.segment(
        detail ? "structure" : "volume",
        [x, 7.25, z],
        [next, 7.25, rearZ(next) + 0.6],
        0.045,
      );
    }
    if (detail && i > 0 && i < 14) {
      for (let r = 0; r < 3; r++)
        for (let col = 0; col < 3; col++)
          b.plane(
            "glazing",
            [0.32, 0.32],
            [x + (col - 1) * 0.7, 3.7 + r * 0.6, rearZ(x) + 2.53],
            Math.PI,
          );
      b.plane("glazing", [2.1, 1.1], [x, 1.15, rearZ(x) + 2.52], Math.PI);
    }
  }
  for (const t of [0.18, 0.36, 0.64, 0.82]) staircase(b, length * t, mode);
}
function make(mode) {
  const b = builder(mode),
    detail = mode === "3d",
    mat = detail ? "ivory" : "volume";
  b.shape(mat, points, 0.015, 0.1);
  b.shape(mat, points, 0.115, 2.15);
  const seatCount = seats(b, mode);
  canopy(b, mode);
  rearBuilding(b, mode);
  mast(b, -1.2, -1, mode);
  mast(b, length + 1.2, 1, mode);
  if (detail) {
    for (let x = 14; x < length - 10; x += 6) {
      b.plane("glazing", [1.8, 1.3], [x, 1.25, frontZ(x) + 0.035]);
      b.box("ivory", [2.1, 0.12, 0.2], [x, 2.0, frontZ(x) + 0.1]);
    }
  }
  const scene = b.finish();
  scene.userData.placeId = place.id;
  scene.userData.footprintSourceId = stand.id;
  scene.userData.visualSeatInstances = seatCount;
  scene.userData.verifiedSeatingCapacity = null;
  return scene;
}
await mkdir(folder, { recursive: true });
const assets = {},
  modelStats = {};
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
        "OSM grandstand building footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified stadium stand geometry. Roof/truss/mast heights and synthetic seat layout are photo proportion estimates, not surveyed facts or real capacity. Stadium field and running-track GIS remain unchanged. No photo textures or verified navigation entrances.",
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
  const file = `stadium-${mode}.glb`;
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
  modelStats[mode] = {
    syntheticSeatInstances: scene.userData.visualSeatInstances,
  };
}
const toLocal = ([x, z]) => [
    anchor[0] + x * cos - z * sin,
    anchor[1] + x * sin + z * cos,
  ],
  wgs84 = (p) => {
    const [x, z] = toLocal(p),
      q = new MercatorCoordinate(
        origin.x + x * units,
        origin.y + z * units,
      ).toLngLat();
    return [q.lng, q.lat];
  };
await writeFile(
  `${folder}/stadium-2.5d.geojson`,
  JSON.stringify(
    {
      type: "FeatureCollection",
      stage: "visual_review_only_not_navigation_GIS",
      features: [
        {
          type: "Feature",
          id: "stadium-source-grandstand",
          properties: {
            placeId: place.id,
            footprintSourceId: stand.id,
            part: "grandstand_maximum_visual_envelope",
            height: 22,
            heightKind: "maximum_canopy_truss_envelope; open_structure_in_GLB",
            heightAccuracy: design.heightAccuracy,
            approvedForMap: false,
          },
          geometry: stand.geometry,
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
const towardField = align([0, 0]);
if (towardField[1] <= 0)
  throw new Error("Stadium seats face away from source field.");
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  placeId: place.id,
  footprintSourceId: stand.id,
  sourceMapVersion: campus.mapVersion,
  sourceMapUrl: map.url,
  sourceMapSha256: map.sha256,
  origin: place.coordinate,
  sourcePlaceGeometryWgs84: place.geometry,
  sourcePlaceSha256: sha(JSON.stringify(place.geometry)),
  sourceGrandstandGeometryWgs84: stand.geometry.coordinates[0],
  sourceGrandstandSha256: sha(JSON.stringify(stand.geometry.coordinates[0])),
  sourceTrackGeometryWgs84: track.geometry,
  sourceTrackSha256: sha(JSON.stringify(track.geometry)),
  sourceAreaMeters2: area(points),
  footprintAlignedMeters: points,
  standLengthMeters: length,
  fieldCenterAlignedMeters: towardField,
  seatsFaceField: true,
  fieldFacingLocalXZ: [0, 1],
  fieldFacingWorldEastSouth: [-sin, cos],
  heightScaleLevels: null,
  heightAccuracy: design.heightAccuracy,
  interiorLevelsVerified: false,
  roofSurfaceCrownMeters: design.roofFrontCrownMeters,
  frontTrussCrownMeters: design.roofFrontCrownMeters + 2,
  mastTopMeters: design.mastTopMeters,
  syntheticSeatLayoutOnly: true,
  verifiedSeatingCapacity: null,
  modelStats,
  skylightStations: design.skylightStations,
  alignedToLocal: { anchor, rotationYRadians: frameAngle },
  previewEnvelopeAlignedMeters: [
    ...points,
    [-11, -36],
    [-11, 13],
    [length + 11, -36],
    [length + 11, 13],
  ],
  referenceFeatureIds: { place: place.id, stand: stand.id, track: track.id },
  alignedWgs84Probe: wgs84([length / 2, 0]),
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
      length,
      sourceAreaMeters2: manifest.sourceAreaMeters2,
      modelStats,
      assets,
    },
    null,
    2,
  ),
);
