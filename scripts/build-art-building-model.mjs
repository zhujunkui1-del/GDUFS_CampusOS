// Standalone five-storey Art Building draft. Never writes src/ or public/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
  Group,
  Shape,
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
const folder = "docs/model-previews/art-building-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (campus.mapVersion !== design.sourceMapVersion || !place?.geometry)
  throw new Error("Review Art Building footprint before regeneration.");
const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const units = origin.meterInMercatorCoordinateUnits();
const points = place.geometry.slice(0, -1).map((p) => {
  const m = MercatorCoordinate.fromLngLat(p);
  return [(m.x - origin.x) / units, (m.y - origin.y) / units];
});
// The open court is a recess in the existing source outer ring, not a new GIS hole.
const main = points.slice(0, 21);
const annex = [points[20], points[21], points[22], points[0]];
const floors = design.floorElevationsMeters;
const bodyTop = floors.at(-1),
  roof = design.roofTopMeters;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const area = (ring) =>
  ring.reduce((s, p, i) => s + cross(p, ring[(i + 1) % ring.length]), 0) / 2;
function edges(ring) {
  const sign = Math.sign(area(ring));
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
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
const mainEdges = edges(main),
  annexEdges = edges(annex);
const at = (e, distance, y, offset = 0) => [
  e.a[0] + (e.dx * distance) / e.length + e.normal[0] * offset,
  y,
  e.a[1] + (e.dz * distance) / e.length + e.normal[1] * offset,
];
const angle = (e) => Math.atan2(e.normal[0], e.normal[1]);
function contains(ring, [x, z]) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
function extrusion(ring, base, height) {
  const shape = new Shape(ring.map(([x, z]) => new Vector2(x, -z)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: height,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  return geometry;
}
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    terracotta: "#bd806a",
    ivory: "#e5e1d6",
    silver: "#c3cdcd",
    glazing: "#57737f",
    grey: "#9fa9b2",
    panels: "#435965",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-Art-Building-${mode}-five-levels`;
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
  const shape = (mat, ring, base, height) =>
    geometry(mat, extrusion(ring, base, height));
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
      levels: 5,
      heightAccuracy: design.heightAccuracy,
      mapIntegrated: false,
    };
    scene.updateMatrixWorld(true);
    return scene;
  }
  return { geometry, shape, piece, box, plane, finish };
}
function volume() {
  const b = builder("2.5d");
  b.shape("volume", main, 0, roof - 0.25);
  b.shape("cap", main, roof - 0.25, 0.25);
  b.shape("volume", annex, 0, design.annexTopMeters - 0.25);
  b.shape("cap", annex, design.annexTopMeters - 0.25, 0.25);
  return b.finish();
}
function detailed() {
  const b = builder("3d");
  b.shape("terracotta", main, 0.7, bodyTop - 0.7);
  b.shape("ivory", main, 0.35, 0.35);
  b.shape("ivory", main, bodyTop, roof - bodyTop);
  // Flat parapets follow every source straight/curved segment without covering the court.
  for (const e of mainEdges)
    b.box(
      "ivory",
      [e.length, design.parapetTopMeters - roof, 0.25],
      at(e, e.length / 2, (roof + design.parapetTopMeters) / 2, -0.08),
      angle(e),
    );

  function windowGrid(e, start, end, { white = false, bay = 5.2 } = {}) {
    const width = end - start,
      count = Math.max(1, Math.round(width / bay));
    if (white)
      b.box(
        "ivory",
        [width, bodyTop - 1.0, 0.16],
        at(e, (start + end) / 2, (bodyTop + 0.7) / 2, 0.1),
        angle(e),
      );
    for (let i = 0; i < count; i++) {
      const d = start + (width * (i + 0.5)) / count;
      for (let level = 0; level < 5; level++) {
        const y = (floors[level] + floors[level + 1]) / 2;
        b.plane(
          "glazing",
          [Math.min(4.5, width / count - 0.5), 2.65],
          at(e, d, y, white ? 0.24 : 0.08),
          angle(e),
        );
        b.plane(
          "silver",
          [Math.min(4.5, width / count - 0.5), 0.075],
          at(e, d, y + 0.5, white ? 0.3 : 0.14),
          angle(e),
        );
        for (const delta of [-0.85, 0.85])
          b.plane(
            "silver",
            [0.07, 2.65],
            at(e, d + delta, y, white ? 0.3 : 0.14),
            angle(e),
          );
      }
    }
    if (white)
      for (let i = 0; i <= count; i++)
        b.box(
          "ivory",
          [0.24, bodyTop - 0.7, 0.45],
          at(e, start + (width * i) / count, (bodyTop + 0.7) / 2, 0.18),
          angle(e),
        );
  }
  // Lake wing: ivory framing, five window rows, two broad recessed gallery openings.
  const lake = mainEdges[8];
  windowGrid(lake, 11.8, lake.length - 0.9, { white: true, bay: 5.4 });
  b.box(
    "ivory",
    [11.7, bodyTop - 0.7, 0.16],
    at(lake, 5.85, (bodyTop + 0.7) / 2, 0.1),
    angle(lake),
  );
  for (const level of [2, 3]) {
    const y = (floors[level] + floors[level + 1]) / 2;
    b.plane("glazing", [10.9, 2.8], at(lake, 5.7, y, 0.24), angle(lake));
    b.box(
      "terracotta",
      [10.9, 1.0, 0.3],
      at(lake, 5.7, floors[level] + 0.6, 0.28),
      angle(lake),
    );
    b.box(
      "silver",
      [10.9, 0.08, 0.12],
      at(lake, 5.7, floors[level] + 1.3, 0.48),
      angle(lake),
    );
  }
  windowGrid(lake, 0.6, 11.0, { bay: 5.0 });
  windowGrid(mainEdges[10], 7, mainEdges[10].length - 6.5, {
    white: true,
    bay: 5.3,
  });
  windowGrid(mainEdges[9], 3.5, mainEdges[9].length - 3.5, { bay: 4.5 });

  // Both sides of the curved wing: lower four floors have pale vertical ribs;
  // the fifth is a continuous brick band with smaller separated windows.
  for (const e of [...mainEdges.slice(1, 8), ...mainEdges.slice(12, 18)]) {
    const d = e.length / 2,
      a = angle(e);
    b.box("ivory", [e.length - 0.15, 16.0, 0.12], at(e, d, 8.8, 0.08), a);
    for (let level = 0; level < 4; level++) {
      const y = (floors[level] + floors[level + 1]) / 2;
      b.plane(
        "glazing",
        [Math.max(1.1, e.length - 1.15), 2.85],
        at(e, d, y, 0.23),
        a,
      );
      b.box(
        "silver",
        [Math.max(1.1, e.length - 1.15), 0.08, 0.1],
        at(e, d, y + 0.52, 0.29),
        a,
      );
      b.box("silver", [0.075, 2.85, 0.11], at(e, d, y, 0.29), a);
    }
    for (const t of [0.1, 0.9]) {
      b.piece(
        "silver",
        "cylinder",
        [0.2, 16.5, 0.2],
        at(e, e.length * t, 9, 0.36),
      );
      b.box("ivory", [0.35, 16.4, 0.3], at(e, e.length * t, 9, 0.13), a);
    }
    b.plane(
      "glazing",
      [1.15, 2.2],
      at(e, d, (floors[4] + floors[5]) / 2, 0.08),
      a,
    );
  }
  // Street elevation: a single red frame around pale vertical screens and glazing.
  const street = mainEdges[18],
    a = angle(street),
    span = street.length * 0.68;
  b.box(
    "ivory",
    [span, 17.6, 0.16],
    at(street, street.length / 2, 10.1, 0.1),
    a,
  );
  b.plane(
    "glazing",
    [span - 1, 16.5],
    at(street, street.length / 2, 10.0, 0.25),
    a,
  );
  const fins = Math.round(span / 1.65);
  for (let i = 0; i <= fins; i++)
    b.box(
      "ivory",
      [0.24, 17.0, 0.72],
      at(street, (street.length - span) / 2 + (i * span) / fins, 10.1, 0.36),
      a,
    );
  for (const y of floors.slice(1, 5))
    b.box(
      "silver",
      [span, 0.18, 0.16],
      at(street, street.length / 2, y, 0.35),
      a,
    );
  for (let y = 18.6; y <= 20.1; y += 0.25)
    b.box(
      "silver",
      [span, 0.075, 0.8],
      at(street, street.length / 2, y, 0.28),
      a,
    );
  for (const d of [6.0, street.length - 6.0])
    for (let level = 0; level < 5; level++)
      b.plane(
        "glazing",
        [4.4, 2.5],
        at(street, d, (floors[level] + floors[level + 1]) / 2, 0.08),
        a,
      );
  // Small end-wall perforations are flat repeated faces, not individual carved holes.
  for (const d of [1.8, 2.7, 3.6])
    for (let row = 0; row < 12; row++)
      b.plane(
        "glazing",
        [0.22, 0.28],
        at(street, d, 2.2 + row * 1.45, 0.08),
        a,
      );
  windowGrid(mainEdges[19], 2, mainEdges[19].length - 2, { bay: 3.5 });
  // The remaining interior straight wing has simple five-storey window rows.
  windowGrid(mainEdges[0], 1.4, mainEdges[0].length - 1.0, { bay: 5.0 });

  // Low grey hall: retain its open ground floor instead of filling it with a solid block.
  const open = design.annexOpenGroundMeters,
    low = design.annexTopMeters;
  b.shape("grey", annex, open, low - open - 0.25);
  b.shape("ivory", annex, low - 0.25, 0.25);
  for (const e of annexEdges.slice(0, 3)) {
    const n = Math.ceil(e.length / 6.4);
    for (let i = 0; i < n; i++)
      b.box(
        "ivory",
        [0.48, open, 0.48],
        at(e, (e.length * i) / n, open / 2, -0.22),
        angle(e),
      );
    b.box(
      "ivory",
      [e.length, 0.45, 0.25],
      at(e, e.length / 2, low + 0.225, -0.12),
      angle(e),
    );
  }
  const greyFace = annexEdges[0];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 7; col++) {
      const d = 2.0 + (col * (greyFace.length - 4)) / 6;
      b.box(
        "silver",
        [0.34, 0.34, 0.16],
        at(greyFace, d, 5.2 + row * 2.45, 0.08),
        angle(greyFace),
      );
    }
  for (const e of [annexEdges[0], annexEdges[1]])
    for (const y of [5.75, 9.2]) {
      const d = e === greyFace ? e.length - 2 : e.length / 2;
      b.plane("glazing", [1.7, 2.3], at(e, d, y, 0.08), angle(e));
      b.box("silver", [1.85, 0.12, 0.4], at(e, d, y - 1.05, 0.19), angle(e));
    }
  // Roof equipment and sparse panel banks. No texture pixels or per-room AC units.
  for (const [x, z, w, d] of [
    [-29, -37, 5.5, 4],
    [15, -36, 4.5, 4],
    [-10, 34, 4.5, 3.5],
  ]) {
    if (
      ![-w / 2, w / 2].every((dx) =>
        [-d / 2, d / 2].every((dz) => contains(main, [x + dx, z + dz])),
      )
    )
      continue;
    b.box("ivory", [w, 1.5, d], [x, roof + 0.75, z]);
    b.box("silver", [w + 0.2, 0.13, d + 0.2], [x, roof + 1.55, z]);
  }
  for (let i = 0; i < 4; i++)
    b.box("ivory", [0.55, 2.1, 0.55], [20 + i * 1.2, roof + 1.05, -41]);
  for (const x of [-22, -14, -6])
    for (const z of [-40, -34.5])
      b.box("panels", [6.7, 0.14, 3.0], [x, roof + 0.2, z]);
  for (const d of [15, 24, 33, 42, 51, 59])
    b.box("panels", [6.5, 0.14, 3.5], at(street, d, roof + 0.2, -6.2), a);

  // Bowed glass roof follows the source arc in plan, with only four cross-slope bands.
  const inner = points.slice(1, 9).reverse(),
    outer = points.slice(12, 19);
  function sample(line, t) {
    const lengths = line
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
    let d = lengths.reduce((s, n) => s + n, 0) * t;
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i] || i === lengths.length - 1) {
        const f = d / lengths[i];
        return [
          line[i][0] + (line[i + 1][0] - line[i][0]) * f,
          line[i][1] + (line[i + 1][1] - line[i][1]) * f,
        ];
      }
      d -= lengths[i];
    }
  }
  function canopy(t, s) {
    const p = sample(inner, t),
      q = sample(outer, t);
    const dx = q[0] - p[0],
      dz = q[1] - p[1],
      len = Math.hypot(dx, dz);
    return [
      (p[0] + q[0]) / 2 + (dx / len) * s * 4.7,
      roof + 0.25 + Math.cos((s * Math.PI) / 2) * 1.15,
      (p[1] + q[1]) / 2 + (dz / len) * s * 4.7,
    ];
  }
  const vertices = [];
  function rod(p, q, width) {
    const g = new BoxGeometry(
      width,
      width,
      new Vector3(...p).distanceTo(new Vector3(...q)),
    );
    const matrix = new Matrix4().lookAt(
      new Vector3(...q),
      new Vector3(...p),
      new Vector3(0, 1, 0),
    );
    matrix.setPosition(
      new Vector3(...p).add(new Vector3(...q)).multiplyScalar(0.5),
    );
    g.applyMatrix4(matrix);
    b.geometry("silver", g);
  }
  for (let i = 0; i < 10; i++) {
    const t0 = 0.08 + 0.084 * i,
      t1 = t0 + 0.084;
    for (let j = 0; j < 4; j++) {
      const s0 = -1 + j * 0.5,
        s1 = s0 + 0.5;
      const p = canopy(t0, s0),
        q = canopy(t1, s0),
        r = canopy(t1, s1),
        s = canopy(t0, s1);
      vertices.push(...p, ...r, ...q, ...p, ...s, ...r);
      if (i % 2 === 0) rod(p, s, 0.1);
      if (j === 0 || j === 3) rod(j === 0 ? p : s, j === 0 ? q : r, 0.14);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  g.setAttribute(
    "uv",
    new Float32BufferAttribute(new Array((vertices.length / 3) * 2).fill(0), 2),
  );
  g.computeVertexNormals();
  b.geometry("glazing", g);
  return b.finish();
}
await mkdir(folder, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const assets = {};
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
        "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original simplified Art Building geometry. Five storeys owner confirmed; height and facade details visual estimates. Supplied photographs internal references only, no image textures.",
    }),
  );
  if (
    triangles > design.performance.triangleBudget ||
    drawCalls > design.performance.modelDrawCallBudget ||
    binary.length > design.performance.glbByteBudget
  )
    throw new Error(
      `Art Building ${mode} budget exceeded: ${triangles} / ${drawCalls} / ${binary.length}`,
    );
  const file = `art-building-${mode}.glb`;
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
function wgs84([x, z]) {
  const p = new MercatorCoordinate(
    origin.x + x * units,
    origin.y + z * units,
  ).toLngLat();
  return [p.lng, p.lat];
}
const volumes = {
  type: "FeatureCollection",
  stage: "visual_review_only_not_navigation_GIS",
  features: [
    ["main", main, roof],
    ["annex", annex, design.annexTopMeters],
  ].map(([part, ring, height]) => ({
    type: "Feature",
    id: `art-building-preview-${part}`,
    properties: {
      placeId: place.id,
      part,
      levels: part === "main" ? 5 : null,
      height,
      heightAccuracy: design.heightAccuracy,
      approvedForMap: false,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[...ring.map(wgs84), wgs84(ring[0])]],
    },
  })),
};
await writeFile(
  `${folder}/art-building-2.5d.geojson`,
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
  levels: 5,
  levelsSource: design.levelsSource,
  roofTopMeters: roof,
  heightAccuracy: design.heightAccuracy,
  appearanceAccuracy: design.appearanceAccuracy,
  courtyard: {
    accuracy: design.courtyardAccuracy,
    openToExterior: true,
    inventedInteriorRings: 0,
  },
  alignedToLocal: { anchor: [0, 0], rotationYRadians: 0 },
  assets,
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { version: manifest.modelVersion, levels: manifest.levels, assets },
    null,
    2,
  ),
);
