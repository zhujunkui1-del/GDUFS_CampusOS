// Independent administration / octagonal pavilion review. Never writes formal map assets.
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
const folder = "docs/model-previews/administration-complex-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const parent = campus.places.find((p) => p.id === design.parentPlaceId),
  pavilion = campus.places.find((p) => p.id === design.pavilionPlaceId);
if (
  campus.mapVersion !== design.sourceMapVersion ||
  !parent?.geometry ||
  pavilion?.parentId !== parent.id
)
  throw new Error("Review parent/pavilion source binding before regeneration.");
const origin = MercatorCoordinate.fromLngLat(parent.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const local = (p) => {
  const q = MercatorCoordinate.fromLngLat(p);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
};
const points = parent.geometry.slice(0, -1).map(local),
  octagon = pavilion.geometry.slice(0, -1).map(local),
  anchor = [0, 0],
  frameAngle = 0;
if (
  JSON.stringify(parent.geometry.slice(9, 17)) !==
  JSON.stringify(pavilion.geometry.slice(0, -1))
)
  throw new Error("Pavilion is no longer the same eight parent vertices.");
const q = design.partitionCornerLocalMeters;
// Five non-overlapping source pieces: the four-storey body excludes the octagon completely.
const office = [
  points[1],
  points[2],
  points[5],
  points[6],
  points[7],
  points[18],
  points[19],
  points[20],
  points[21],
  points[22],
  points[23],
  points[24],
  points[25],
  points[26],
  points[27],
  q,
];
const neck = [
  points[7],
  points[8],
  points[9],
  points[16],
  points[17],
  points[18],
];
const roundAnnex = [q, ...points.slice(27), points[0], points[1]],
  portico = points.slice(2, 6);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const signedArea = (r) =>
  r.reduce((s, p, i) => s + cross(p, r[(i + 1) % r.length]), 0) / 2;
const sourceArea = Math.abs(signedArea(points)),
  partsArea = [office, neck, roundAnnex, portico, octagon].reduce(
    (s, r) => s + Math.abs(signedArea(r)),
    0,
  );
if (Math.abs(sourceArea - partsArea) > 0.0001)
  throw new Error("Source partition areas no longer match.");
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
];
const angle = (e) => Math.atan2(e.normal[0], e.normal[1]);
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
    ivory: "#e5e5dc",
    red: "#b76e59",
    glazing: "#677f88",
    roof: "#606b74",
    metal: "#a7b0ae",
    stone: "#bdc5bf",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Administration-Complex-${mode}-owner-height-scale`;
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
      heightScales: design.heightScales,
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
function hip(b, mat, { x0, x1, z0, z1, eave, peak }) {
  const v = [],
    tri = (a, c, d) => v.push(...a, ...c, ...d),
    quad = (a, c, d, e) => {
      tri(a, c, d);
      tri(a, d, e);
    };
  const dx = x1 - x0,
    dz = z1 - z0;
  if (dx >= dz) {
    const mid = (z0 + z1) / 2,
      run = dz / 2,
      r0 = [x0 + run, peak, mid],
      r1 = [x1 - run, peak, mid];
    quad([x0, eave, z1], [x1, eave, z1], r1, r0);
    quad([x1, eave, z0], [x0, eave, z0], r0, r1);
    tri([x0, eave, z0], [x0, eave, z1], r0);
    tri([x1, eave, z1], [x1, eave, z0], r1);
  } else {
    const mid = (x0 + x1) / 2,
      run = dx / 2,
      r0 = [mid, peak, z0 + run],
      r1 = [mid, peak, z1 - run];
    quad([x0, eave, z0], [x0, eave, z1], r1, r0);
    quad([x1, eave, z1], [x1, eave, z0], r0, r1);
    tri([x1, eave, z0], [x0, eave, z0], r0);
    tri([x0, eave, z1], [x1, eave, z1], r1);
  }
  b.geometry(mat, geometryFromTriangles(v));
}
function polygonRoof(b, mat, ring, eave, peak) {
  const exterior = inset(ring, -0.65),
    center = exterior.reduce(
      (s, p) => [s[0] + p[0] / exterior.length, s[1] + p[1] / exterior.length],
      [0, 0],
    ),
    v = [];
  for (let i = 0; i < exterior.length; i++) {
    const a = exterior[i],
      c = exterior[(i + 1) % exterior.length];
    v.push(a[0], eave, a[1], c[0], eave, c[1], center[0], peak, center[1]);
  }
  const g = geometryFromTriangles(v);
  if (signedArea(exterior) > 0) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(p, i + 1),
        c = new Vector3().fromBufferAttribute(p, i + 2);
      p.setXYZ(i + 1, c.x, c.y, c.z);
      p.setXYZ(i + 2, a.x, a.y, a.z);
    }
    g.computeVertexNormals();
  }
  b.geometry(mat, g);
}
function officePart(b, mode) {
  const mono = mode === "2.5d",
    wall = mono ? "volume" : "ivory",
    roofMat = mono ? "cap" : "roof",
    floors = design.floorElevationsMeters,
    top = floors.at(-1);
  for (const ring of [office, neck, roundAnnex, portico])
    b.shape(wall, ring, 0.02, 0.13);
  if (mono) b.shape(wall, office, 0.15, top - 0.15);
  else {
    b.shape(
      "ivory",
      inset(office, design.galleryDepthMeters),
      0.15,
      top - 0.15,
    );
    for (const y of floors)
      b.shape("ivory", office, Math.max(0.15, y - 0.16), 0.16);
    for (const e of edges(office)) {
      const bays = Math.max(1, Math.round(e.length / 5.1));
      for (let j = 0; j <= bays; j++)
        b.box(
          "ivory",
          [0.34, top - 0.55, 0.38],
          at(e, (e.length * j) / bays, (top + 0.55) / 2, -0.08),
          angle(e),
        );
      for (let level = 0; level < 4; level++) {
        const base = floors[level],
          y = (base + floors[level + 1]) / 2;
        b.box(
          "ivory",
          [e.length, 0.22, 0.28],
          at(e, e.length / 2, base + 3.15, 0.05),
          angle(e),
        );
        if (level > 0)
          b.box(
            "red",
            [e.length, 0.55, 0.16],
            at(e, e.length / 2, base + 0.8, 0.03),
            angle(e),
          );
        for (let j = 0; j < bays; j++) {
          const d = (e.length * (j + 0.5)) / bays;
          b.plane(
            "glazing",
            [Math.max(0.65, Math.min(3.4, e.length / bays - 0.65)), 1.95],
            at(e, d, y + 0.2, -design.galleryDepthMeters + 0.07),
            angle(e),
          );
          b.plane(
            "metal",
            [0.065, 1.95],
            at(e, d, y + 0.2, -design.galleryDepthMeters + 0.13),
            angle(e),
          );
        }
      }
    }
  }
  for (const roofPart of design.roofModules)
    hip(b, roofMat, {
      ...roofPart,
      eave: design.officeRoofEavesMeters,
      peak: design.officeRoofPeakMeters,
    });
  // A covered link visible in the overhead photo crosses the source ground-level recess.
  // It adds a roof and slender supports, never a new navigation obstacle or a closed GIS courtyard.
  hip(b, roofMat, {
    x0: -38.2,
    x1: -19.6,
    z0: 1.1,
    z1: 10.2,
    eave: 11.6,
    peak: 13.6,
  });
  if (!mono)
    for (const x of [-36.9, -20.9])
      for (const z of [2.0, 9.6]) b.box("ivory", [0.3, 11.4, 0.3], [x, 5.9, z]);

  b.shape(wall, neck, 0.15, design.neckTopMeters - 0.15);
  b.shape(roofMat, neck, design.neckTopMeters, 0.18);
  if (!mono)
    for (const e of edges(neck)) {
      if (e.length < 4) continue;
      b.plane(
        "glazing",
        [e.length - 0.9, 2.5],
        at(e, e.length / 2, 2.2, 0.08),
        angle(e),
      );
      for (let d = 1.8; d < e.length; d += 2.6)
        b.box("ivory", [0.18, 2.7, 0.24], at(e, d, 2.2, 0.16), angle(e));
    }
  b.shape(wall, roundAnnex, 0.15, design.roundAnnexTopMeters - 0.15);
  b.shape(roofMat, roundAnnex, design.roundAnnexTopMeters, 0.18);
  if (!mono)
    for (const e of edges(roundAnnex)) {
      b.box(
        "ivory",
        [e.length, 0.23, 0.32],
        at(e, e.length / 2, design.roundAnnexTopMeters + 0.1, 0.05),
        angle(e),
      );
      if (e.length < 3) continue;
      b.plane(
        "glazing",
        [Math.min(e.length - 0.7, 4.7), 2.45],
        at(e, e.length / 2, 2.4, 0.08),
        angle(e),
      );
    }

  // Entrance portico: source projection remains open in 3D, with an arch and two roof tiers.
  if (mono) b.shape(wall, portico, 0.15, design.porticoEavesMeters - 0.15);
  else {
    for (const z of [1.0, 15.6]) {
      b.box("stone", [1.6, 12.0, 1.5], [48.2, 6.6, z]);
      b.box("ivory", [2.1, 0.4, 2.0], [48.2, 12.5, z]);
      for (let y = 1.2; y < 12.0; y += 0.65)
        b.plane("metal", [1.45, 0.025], [49.02, y, z], Math.PI / 2);
    }
    b.box("ivory", [0.45, 1.5, 13.1], [48.35, 8.8, 8.3]);
    const upper = [],
      lower = [];
    for (let i = 0; i <= 20; i++) {
      const u = -7.5 + (15 * i) / 20,
        y = 12.1 - 1.5 * (u / 7.5) ** 2;
      upper.push(new Vector2(u, y));
      lower.push(new Vector2(u, y - 0.35));
    }
    const shape = new Shape([...upper, ...lower.reverse()]);
    const g = new ExtrudeGeometry(shape, {
      depth: 0.55,
      steps: 1,
      bevelEnabled: false,
    });
    g.rotateY(Math.PI / 2);
    g.translate(48.0, 0, 8.3);
    b.geometry("ivory", g);
    for (let i = 0; i < 6; i++)
      b.box(
        "stone",
        [12.5, 0.12 * (i + 1), 0.55],
        [42.1, 0.06 * (i + 1), 18.9 - i * 0.5],
      );
  }
  hip(b, roofMat, {
    x0: 34.8,
    x1: 50.1,
    z0: -1.5,
    z1: 18.5,
    eave: design.porticoEavesMeters,
    peak: design.porticoRoofPeakMeters,
  });
  hip(b, roofMat, {
    x0: 36.4,
    x1: 48.5,
    z0: 0.1,
    z1: 16.9,
    eave: design.porticoUpperEavesMeters,
    peak: design.porticoUpperPeakMeters,
  });

  // Small glazed corner stair turrets are photo-informed display details, not new places.
  for (const [cx, cz] of [
    [33, -21.0],
    [-33.2, 39.5],
  ]) {
    const ring = Array.from({ length: 8 }, (_, i) => [
      cx + 3.4 * Math.cos((i * Math.PI) / 4),
      cz + 3.4 * Math.sin((i * Math.PI) / 4),
    ]);
    if (!mono)
      for (const e of edges(ring)) {
        b.plane(
          "glazing",
          [e.length - 0.35, top - 0.6],
          at(e, e.length / 2, (top + 0.6) / 2, 0.02),
          angle(e),
        );
        b.box(
          "ivory",
          [0.3, top - 0.55, 0.3],
          [e.a[0], (top + 0.55) / 2, e.a[1]],
        );
        for (const y of floors.slice(1))
          b.box(
            "ivory",
            [e.length, 0.2, 0.25],
            at(e, e.length / 2, y, 0.1),
            angle(e),
          );
      }
    polygonRoof(
      b,
      roofMat,
      ring,
      design.officeRoofEavesMeters + 0.2,
      design.officeRoofPeakMeters + 0.4,
    );
  }
}
function pavilionPart(b, mode) {
  const mono = mode === "2.5d",
    wall = mono ? "volume" : "ivory",
    roofMat = mono ? "cap" : "roof",
    eave = design.pavilionEavesMeters;
  b.shape(wall, octagon, 0.02, 0.13);
  b.shape(wall, octagon, 0.15, eave - 0.15);
  polygonRoof(b, roofMat, octagon, eave, design.pavilionRoofPeakMeters);
  if (!mono)
    for (const e of edges(octagon)) {
      b.plane(
        "glazing",
        [e.length - 0.65, 2.75],
        at(e, e.length / 2, 2.35, 0.08),
        angle(e),
      );
      b.box(
        "ivory",
        [0.32, eave - 0.2, 0.32],
        [e.a[0], (eave + 0.2) / 2, e.a[1]],
      );
      b.box(
        "ivory",
        [e.length, 0.22, 0.3],
        at(e, e.length / 2, eave - 0.1, 0.12),
        angle(e),
      );
      b.box(
        "ivory",
        [e.length, 0.3, 0.22],
        at(e, e.length / 2, 0.85, 0.12),
        angle(e),
      );
      const bays = Math.max(1, Math.round(e.length / 2.2));
      for (let i = 1; i < bays; i++)
        b.plane(
          "metal",
          [0.07, 2.75],
          at(e, (e.length * i) / bays, 2.35, 0.16),
          angle(e),
        );
    }
}
function makeModel(mode, selection) {
  const b = builder(mode);
  if (selection !== "pavilion") officePart(b, mode);
  if (selection !== "administration") pavilionPart(b, mode);
  const scene = b.finish();
  scene.userData.selection = selection;
  scene.userData.pavilionRenderedCount = selection === "administration" ? 0 : 1;
  return scene;
}
await mkdir(folder, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  allAssets = {};
for (const selection of ["complex", "administration", "pavilion"]) {
  allAssets[selection] = {};
  for (const mode of ["2.5d", "3d"]) {
    const scene = makeModel(mode, selection),
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
          "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified administration and octagonal pavilion geometry. Owner height descriptions four storeys/one storey; metric dimensions and roof/facade partitions are visual estimates. No photo textures or surveyed interiors.",
      }),
    );
    if (
      triangles > design.performance.triangleBudget ||
      drawCalls > design.performance.modelDrawCallBudget ||
      binary.length > design.performance.glbByteBudget
    )
      throw new Error(
        `Complex ${selection}/${mode} budget exceeded: ${triangles} / ${drawCalls} / ${binary.length}`,
      );
    const prefix =
        selection === "complex"
          ? "administration-complex"
          : selection === "pavilion"
            ? "bajiaolou"
            : "administration",
      file = `${prefix}-${mode}.glb`;
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
      origin: parent.coordinate,
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
const partRings = { office, neck, roundAnnex, portico, pavilion: octagon };
const volumes = {
  type: "FeatureCollection",
  stage: "visual_review_only_not_navigation_GIS",
  features: Object.entries(partRings).map(([part, ring]) => ({
    type: "Feature",
    id: `administration-preview-${part}`,
    properties: {
      placeId: part === "pavilion" ? pavilion.id : parent.id,
      parentId: part === "pavilion" ? parent.id : null,
      part,
      heightScaleLevels: part === "pavilion" ? 1 : part === "office" ? 4 : null,
      height:
        part === "office"
          ? design.officeRoofPeakMeters + 0.4
          : part === "pavilion"
            ? design.pavilionRoofPeakMeters
            : part === "neck"
              ? design.neckTopMeters + 0.18
              : part === "roundAnnex"
                ? design.roundAnnexTopMeters + 0.22
                : design.porticoUpperPeakMeters,
      heightAccuracy: design.heightAccuracy,
      heightKind: "maximum_visual_envelope_roof_in_GLB",
      partitionAccuracy: design.partitionAccuracy,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: [close(ring)] },
  })),
};
await writeFile(
  `${folder}/administration-complex-2.5d.geojson`,
  JSON.stringify(volumes, null, 2) + "\n",
);
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  parentPlaceId: parent.id,
  pavilionPlaceId: pavilion.id,
  sourceMapVersion: campus.mapVersion,
  origin: parent.coordinate,
  sourceParentGeometryWgs84: parent.geometry,
  sourcePavilionGeometryWgs84: pavilion.geometry,
  parentFootprintSha256: sha(JSON.stringify(parent.geometry)),
  pavilionFootprintSha256: sha(JSON.stringify(pavilion.geometry)),
  heightScales: design.heightScales,
  heightSource: design.heightSource,
  heightAccuracy: design.heightAccuracy,
  interiorLevelsVerified: false,
  pavilionRenderedExactlyOnce: true,
  sourcePartitionAreaMeters2: { parent: sourceArea, sum: partsArea },
  partEnvelopes: {
    complex: points,
    administration: [...office, ...neck, ...roundAnnex, ...portico],
    pavilion: octagon,
  },
  alignedToLocal: { anchor: [0, 0], rotationYRadians: 0 },
  assets: allAssets.complex,
  componentAssets: {
    administration: allAssets.administration,
    pavilion: allAssets.pavilion,
  },
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(allAssets).map(([part, assets]) => [
        part,
        Object.fromEntries(
          Object.entries(assets).map(([mode, a]) => [
            mode,
            {
              bytes: a.bytes,
              triangles: a.triangles,
              drawCalls: a.drawCalls,
              materials: a.materialCount,
            },
          ]),
        ),
      ]),
    ),
    null,
    2,
  ),
);
