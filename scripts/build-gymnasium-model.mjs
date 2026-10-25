// Independent gymnasium visual draft. Original ellipse and campus GIS remain read-only.
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
  CatmullRomCurve3,
  TubeGeometry,
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
const folder = "docs/model-previews/gymnasium-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (
  campus.mapVersion !== design.sourceMapVersion ||
  place?.geometry?.length !== 81
)
  throw new Error("Review gymnasium source ellipse.");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits(),
  anchor = [0, 0],
  frameAngle = 0;
const points = place.geometry.slice(0, -1).map((p) => {
  const q = MercatorCoordinate.fromLngLat(p);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
});
const area = (r) =>
  Math.abs(
    r.reduce((s, a, i) => {
      const b = r[(i + 1) % r.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2,
  );
const roofHalfLength = design.roofHalfLengthMeters,
  roofHalfWidth = design.roofHalfWidthMeters;
const widthAt = (x) =>
  roofHalfWidth * Math.max(0, 1 - (x / roofHalfLength) ** 2);
const archAt = (x) =>
  design.roofTipMeters +
  (design.roofCrownMeters - design.roofTipMeters) *
    Math.max(0, 1 - (x / roofHalfLength) ** 2) ** design.archPower;
const eaveAt = (x) =>
  design.roofTipMeters +
  (design.eaveMiddleMeters - design.roofTipMeters) *
    Math.max(0, 1 - (x / roofHalfLength) ** 2) ** 0.7;
function roofHeight(x, z) {
  const width = widthAt(x);
  if (width < 1e-7) return design.roofTipMeters;
  const t = Math.min(1, Math.abs(z) / width);
  return archAt(x) - (archAt(x) - eaveAt(x)) * t ** design.roofCrossPower;
}
const wallTop = ([x, z]) => roofHeight(x, z) - design.wallRoofClearanceMeters;
if (points.some(([x, z]) => Math.abs(z) > widthAt(x)))
  throw new Error("Roof display envelope no longer covers the source body.");
function extrusion(r, y, height, holes = []) {
  const s = new Shape(r.map(([x, z]) => new Vector2(x, -z)));
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
function meshData(vertices, indices) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  g.setAttribute(
    "uv",
    new Float32BufferAttribute(new Array((vertices.length / 3) * 2).fill(0), 2),
  );
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
function quadGeometry(a, b, c, d) {
  return meshData([...a, ...b, ...c, ...d], [0, 1, 2, 0, 2, 3]);
}
function surface(nx, nz) {
  const vertices = [],
    rows = [],
    indices = [];
  for (let i = 0; i <= nx; i++) {
    const x = -roofHalfLength + (2 * roofHalfLength * i) / nx,
      row = [];
    if (i === 0 || i === nx) {
      row.push(vertices.length / 3);
      vertices.push(x, design.roofTipMeters, 0);
    } else
      for (let j = 0; j <= nz; j++) {
        const z = widthAt(x) * (-1 + (2 * j) / nz);
        row.push(vertices.length / 3);
        vertices.push(x, roofHeight(x, z), z);
      }
    rows.push(row);
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (i === 0) indices.push(rows[0][0], rows[1][j + 1], rows[1][j]);
      else if (i === nx - 1)
        indices.push(rows[i][j], rows[i][j + 1], rows[i + 1][0]);
      else {
        const a = rows[i][j],
          b = rows[i][j + 1],
          c = rows[i + 1][j + 1],
          d = rows[i + 1][j];
        indices.push(a, b, d, b, c, d);
      }
    }
  return meshData(vertices, indices);
}
function roofPatch(x0, x1, z0, z1, raise, segments = 8) {
  const vertices = [],
    indices = [];
  for (let i = 0; i <= segments; i++)
    for (const x of [x0, x1]) {
      const z = z0 + ((z1 - z0) * i) / segments;
      vertices.push(x, roofHeight(x, z) + raise, z);
    }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return meshData(vertices, indices);
}
function boundary(n = 64) {
  const r = [];
  for (let i = 0; i <= n; i++) {
    const x = -roofHalfLength + (2 * roofHalfLength * i) / n;
    r.push([x, -widthAt(x)]);
  }
  for (let i = n - 1; i > 0; i--) {
    const x = -roofHalfLength + (2 * roofHalfLength * i) / n;
    r.push([x, widthAt(x)]);
  }
  return r;
}
const roofRing = boundary(48);
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    roof: "#b0aaa0",
    arch: "#cbc8bc",
    ivory: "#dce0da",
    glazing: "#6b838d",
    metal: "#b1bab9",
    roofSeam: "#8a8981",
    skylight: "#e4e8e0",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Gymnasium-${mode}-owner-height-scale`;
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

function curvedWall(b, mode) {
  const detail = mode === "3d";
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      c = points[(i + 1) % points.length],
      dx = c[0] - a[0],
      dz = c[1] - a[1],
      length = Math.hypot(dx, dz),
      sign = Math.sign(
        points.reduce((s, p, i) => {
          const q = points[(i + 1) % points.length];
          return s + p[0] * q[1] - q[0] * p[1];
        }, 0),
      ),
      normal = [(sign * dz) / length, (-sign * dx) / length],
      bearing = Math.atan2(normal[0], normal[1]),
      ha = wallTop(a),
      hc = wallTop(c),
      glass = Math.abs((a[1] + c[1]) / 2) > 12.5;
    // Source ring is clockwise in east/south coordinates; normals point outwards.
    const g = quadGeometry(
      [a[0], design.plinthTopMeters, a[1]],
      [a[0], ha, a[1]],
      [c[0], hc, c[1]],
      [c[0], design.plinthTopMeters, c[1]],
    );
    const positions = g.attributes.position,
      indices = g.index.array;
    const p = new Vector3().fromBufferAttribute(positions, indices[0]),
      q = new Vector3().fromBufferAttribute(positions, indices[1]),
      r = new Vector3().fromBufferAttribute(positions, indices[2]);
    const face = new Vector3().crossVectors(q.sub(p), r.sub(p));
    if (face.x * normal[0] + face.z * normal[1] < 0) {
      g.setIndex([0, 2, 1, 0, 3, 2]);
      g.computeVertexNormals();
    }
    b.geometry(detail ? (glass ? "glazing" : "ivory") : "volume", g);
    if (!detail) continue;
    const center = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2],
      height = Math.min(ha, hc);
    const at = (y, offset) => [
      center[0] + normal[0] * offset,
      y,
      center[1] + normal[1] * offset,
    ];
    if (glass) {
      for (const y of design.louverLevelsMeters)
        if (y < height - 0.75)
          b.box("ivory", [length + 0.035, 0.14, 0.72], at(y, 0.22), bearing);
      if (i % 2 === 0)
        b.box(
          "metal",
          [0.065, height - design.plinthTopMeters - 0.18, 0.08],
          at((height + design.plinthTopMeters) / 2, 0.07),
          bearing,
        );
      for (let y = 2; y < height - 0.45; y += 1.15)
        b.plane("metal", [length, 0.04], at(y, 0.085), bearing);
    } else if (i % 2 === 0) {
      for (const y of [5.8, 8.0, 10.2])
        if (y < height - 1)
          b.plane("glazing", [1.35, 1.4], at(y, 0.06), bearing);
    }
  }
}
function roofDetails(b, mode) {
  const detail = mode === "3d",
    mat = detail ? "arch" : "cap",
    n = detail ? 64 : 28,
    vertices = [],
    indices = [],
    half = design.archBandWidthMeters / 2;
  for (let i = 0; i <= n; i++) {
    const x = -roofHalfLength + (2 * roofHalfLength * i) / n,
      y = archAt(x) + design.archBandLiftMeters;
    vertices.push(x, y, -half, x, y, half);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  b.geometry(mat, meshData(vertices, indices));
  for (const side of [-1, 1]) {
    const v = [],
      ind = [];
    for (let i = 0; i <= n; i++) {
      const x = -roofHalfLength + (2 * roofHalfLength * i) / n,
        y = archAt(x) + design.archBandLiftMeters;
      v.push(x, y, side * half, x, y - design.archBandDepthMeters, side * half);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      if (side === 1) ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    b.geometry(mat, meshData(v, ind));
  }
  // Five independent skylight bars on each roof half, observed in the overhead reference.
  for (const sign of [-1, 1])
    for (const x of design.skylightCentersXMeters) {
      const z0 = sign * 6.3,
        z1 = sign * (27.0 - (Math.abs(x) / 18) * 3.0),
        lo = Math.min(z0, z1),
        hi = Math.max(z0, z1);
      b.geometry(
        detail ? "arch" : "volume",
        roofPatch(x - 1.6, x + 1.6, lo - 0.3, hi + 0.3, 0.16, detail ? 10 : 4),
      );
      b.geometry(
        detail ? "skylight" : "cap",
        roofPatch(x - 1.2, x + 1.2, lo, hi, 0.25, detail ? 10 : 4),
      );
    }
  if (!detail) return;
  // Indexed surface strips keep the ribbing finite; there are no texture maps.
  for (let i = 1; i < 49; i++) {
    const x = -roofHalfLength * 0.96 + (2 * roofHalfLength * 0.96 * i) / 49,
      v = [],
      ind = [];
    for (let j = 0; j <= 16; j++)
      for (const dx of [-0.035, 0.035]) {
        const xx = x + dx,
          z = widthAt(xx) * (-1 + (2 * j) / 16);
        v.push(xx, roofHeight(xx, z) + 0.035, z);
      }
    for (let j = 0; j < 16; j++) {
      const a = j * 2;
      ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    b.geometry("roofSeam", meshData(v, ind));
  }
  const outer = boundary(64).map(
    ([x, z]) => new Vector3(x, roofHeight(x, z) - 0.035, z),
  );
  b.geometry(
    "metal",
    new TubeGeometry(
      new CatmullRomCurve3(outer, true, "centripetal"),
      128,
      0.17,
      6,
      true,
    ),
  );
  const inner = boundary(56).map(([x, z]) => {
    const xx = x * 0.94,
      zz = z * 0.85;
    return new Vector3(xx, roofHeight(xx, zz) + 0.08, zz);
  });
  b.geometry(
    "roofSeam",
    new TubeGeometry(
      new CatmullRomCurve3(inner, true, "centripetal"),
      112,
      0.07,
      5,
      true,
    ),
  );
}
function entrance(b, mode) {
  const detail = mode === "3d",
    mat = detail ? "ivory" : "volume";
  for (let i = 0; i < 8; i++) {
    const h = (i + 1) * 0.15;
    b.box(mat, [14, h, 0.42], [0, h / 2, 46.17 - i * 0.42]);
  }
  b.box(mat, [16, 0.16, 1.6], [0, 1.15, 42.8]);
  if (!detail) return;
  b.plane("glazing", [12, 2.8], [0, 2.65, 42.55]);
  for (const x of [-6, -3, 0, 3, 6])
    b.box("metal", [0.075, 2.85, 0.13], [x, 2.65, 42.63]);
  b.box("ivory", [12.5, 0.32, 0.25], [0, 4.22, 42.65]);
  b.box("metal", [16, 0.18, 3], [0, 4.5, 43]);
  for (const x of [-7.1, 7.1])
    for (const i of [0, 1])
      b.box("metal", [0.065, 1.0, 0.065], [x, 1.0 + i * 0.45, 45.8 - i * 1.8]);
}
function make(mode) {
  const b = builder(mode);
  b.shape(
    mode === "3d" ? "ivory" : "volume",
    points,
    0.015,
    design.plinthTopMeters - 0.015,
  );
  curvedWall(b, mode);
  b.geometry(
    mode === "3d" ? "roof" : "cap",
    surface(mode === "3d" ? 48 : 24, mode === "3d" ? 24 : 12),
  );
  roofDetails(b, mode);
  entrance(b, mode);
  const scene = b.finish();
  scene.userData.placeId = place.id;
  scene.userData.skylightCount = 10;
  scene.userData.roofOrientation =
    "east_west_arch_with_north_south_shell_halves";
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
        "OSM ellipse footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified gymnasium shell and arch geometry. Owner describes five-storey external height scale; metric heights, overhang, facade and entrance are visual estimates. No photograph textures, surveyed interior floors or navigation entrances.",
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
  const file = `gymnasium-${mode}.glb`;
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
  },
  close = (r) => [...r.map(wgs84), wgs84(r[0])];
const features = [
  {
    type: "Feature",
    id: "gymnasium-source-base",
    properties: {
      placeId: place.id,
      part: "source_ellipse_base",
      base: 0.015,
      height: design.plinthTopMeters,
      sourceFootprint: true,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: [place.geometry] },
  },
  {
    type: "Feature",
    id: "gymnasium-curved-roof-envelope",
    properties: {
      placeId: place.id,
      part: "lens_roof_overhang",
      base: design.roofTipMeters,
      height: design.roofCrownMeters + design.archBandLiftMeters,
      heightKind: "maximum_visual_envelope_curved_profile_in_GLB",
      heightScaleLevels: 5,
      heightAccuracy: design.heightAccuracy,
      interiorLevelsVerified: false,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: [close(roofRing)] },
  },
];
await writeFile(
  `${folder}/gymnasium-2.5d.geojson`,
  JSON.stringify(
    {
      type: "FeatureCollection",
      stage: "visual_review_only_not_navigation_GIS",
      note: "Roof polygon is an approximate maximum display envelope; GLBs contain curved surfaces, variable wall heights and skylights.",
      features,
    },
    null,
    2,
  ) + "\n",
);
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  placeId: place.id,
  sourceMapVersion: campus.mapVersion,
  origin: place.coordinate,
  sourceGeometryWgs84: place.geometry,
  sourceFootprintSha256: sha(JSON.stringify(place.geometry)),
  footprintLocalMeters: points,
  sourceAreaMeters2: area(points),
  previewEnvelopeAlignedMeters: [
    ...points,
    ...roofRing,
    [-61.5, -3],
    [-61.5, 3],
    [61.5, -3],
    [61.5, 3],
    [-8, 46.5],
    [8, 46.5],
  ],
  roofBoundaryLocalMeters: roofRing,
  heightScaleLevels: 5,
  levelsSource: design.levelsSource,
  levelsAccuracy: design.levelsAccuracy,
  interiorLevelsVerified: false,
  heightAccuracy: design.heightAccuracy,
  roofOrientation: design.roofOrientation,
  skylightCount: 10,
  skylightsPerRoofHalf: 5,
  wallHeightRangeMeters: [
    Math.min(...points.map(wallTop)),
    Math.max(...points.map(wallTop)),
  ],
  roofCoverageMinimumMarginMeters: Math.min(
    ...points.map(([x, z]) => widthAt(x) - Math.abs(z)),
  ),
  alignedToLocal: { anchor, rotationYRadians: frameAngle },
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
      wallHeightRangeMeters: manifest.wallHeightRangeMeters,
      assets,
    },
    null,
    2,
  ),
);
