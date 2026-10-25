// Independent B8 display draft. Original GIS, routes and existing models are read-only.
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
const folder = "docs/model-previews/b8-lecture-hall-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (campus.mapVersion !== design.sourceMapVersion || !place?.geometry)
  throw new Error("Review B8 source footprint before regeneration.");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const sourceLocal = place.geometry.slice(0, -1).map((p) => {
  const q = MercatorCoordinate.fromLngLat(p);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
});
const anchor = sourceLocal[0],
  phi = Math.atan2(
    sourceLocal[1][1] - anchor[1],
    sourceLocal[1][0] - anchor[0],
  );
const cos = Math.cos(phi),
  sin = Math.sin(phi),
  frameAngle = -phi;
const points = sourceLocal.map(([x, z]) => [
  (x - anchor[0]) * cos + (z - anchor[1]) * sin,
  -(x - anchor[0]) * sin + (z - anchor[1]) * cos,
]);
const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const body = rect(2.6, -12.2, 23.0, -47.5),
  foyer = rect(2.7, -0.2, 21.8, -12.2),
  rear = rect(6.0, -47.5, 21.0, -58.7),
  sideTower = rect(21.8, -0.2, 25.0, -10.0);
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
function ribbon(path, width) {
  const normals = path.slice(1).map((p, i) => {
    const dx = p[0] - path[i][0],
      dz = p[1] - path[i][1],
      n = Math.hypot(dx, dz);
    return [-dz / n, dx / n];
  });
  const sides = [1, -1].map((sign) =>
    path.map((p, i) => {
      const a = normals[Math.max(0, i - 1)],
        b = normals[Math.min(normals.length - 1, i)],
        nx = a[0] + b[0],
        nz = a[1] + b[1],
        n = Math.hypot(nx, nz),
        den = (nx / n) * b[0] + (nz / n) * b[1];
      return [
        p[0] + (((sign * nx) / n) * width) / 2 / den,
        p[1] + (((sign * nz) / n) * width) / 2 / den,
      ];
    }),
  );
  return [...sides[0], ...sides[1].reverse()];
}
const screen = ribbon(
  design.screenPathAlignedMeters,
  design.screenThicknessMeters,
);
const palettes = {
  "2.5d": { volume: "#dedbd3", cap: "#efede6" },
  "3d": {
    terracotta: "#b87957",
    ivory: "#e4e3d9",
    roof: "#b7b09c",
    roofDark: "#737b76",
    metal: "#a3afac",
    mullion: "#4c5c61",
    glazing: "#63818e",
    accent: "#246da6",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-B8-Lecture-Hall-${mode}-owner-height-scale`;
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
function shallowRoof(b, mat, seams = false) {
  const x0 = 2.45,
    x1 = 23.15,
    xc = (x0 + x1) / 2,
    z0 = -47.5,
    z1 = -12.2,
    y = design.mainEavesMeters,
    peak = design.mainRidgeMeters,
    vertices = [];
  const tri = (a, c, d) => vertices.push(...a, ...c, ...d),
    quad = (a, c, d, e) => {
      tri(a, c, d);
      tri(a, d, e);
    };
  quad([x0, y, z0], [x0, y, z1], [xc, peak, z1], [xc, peak, z0]);
  quad([xc, peak, z0], [xc, peak, z1], [x1, y, z1], [x1, y, z0]);
  tri([x0, y, z0], [xc, peak, z0], [x1, y, z0]);
  tri([x1, y, z1], [xc, peak, z1], [x0, y, z1]);
  b.geometry(mat, fromTriangles(vertices));
  if (seams) {
    const lines = [];
    for (let i = 1; i < 25; i++) {
      const z = z0 + ((z1 - z0) * i) / 25,
        w = 0.035;
      lines.push(
        x0,
        y + 0.025,
        z - w,
        x0,
        y + 0.025,
        z + w,
        xc,
        peak + 0.025,
        z + w,
        x0,
        y + 0.025,
        z - w,
        xc,
        peak + 0.025,
        z + w,
        xc,
        peak + 0.025,
        z - w,
        xc,
        peak + 0.025,
        z - w,
        xc,
        peak + 0.025,
        z + w,
        x1,
        y + 0.025,
        z + w,
        xc,
        peak + 0.025,
        z - w,
        x1,
        y + 0.025,
        z + w,
        x1,
        y + 0.025,
        z - w,
      );
    }
    b.geometry("metal", fromTriangles(lines));
    b.box("metal", [0.1, 0.08, z1 - z0], [xc, peak + 0.03, (z0 + z1) / 2]);
  }
}
function volume() {
  const b = builder("2.5d");
  b.shape("volume", points, 0, 0.18);
  b.shape("volume", body, 0.15, design.mainEavesMeters - 0.15);
  shallowRoof(b, "cap");
  b.shape("volume", foyer, 0.15, design.foyerRoofMeters - 0.15);
  b.shape("cap", foyer, design.foyerRoofMeters, 0.14);
  b.shape("volume", rear, 0.15, design.rearBlockTopMeters - 0.15);
  b.shape("cap", rear, design.rearBlockTopMeters, 0.18);
  b.shape("volume", sideTower, 0.15, design.sideTowerTopMeters - 0.15);
  b.shape("cap", sideTower, design.sideTowerTopMeters, 0.14);
  b.shape("volume", screen, 0.15, design.screenTopMeters - 0.15);
  return b.finish();
}
function detailed() {
  const b = builder("3d");
  b.shape("ivory", points, 0.02, 0.13);
  b.shape("ivory", body, 0.15, design.mainEavesMeters - 0.15);
  shallowRoof(b, "roof", true);
  b.shape("ivory", rear, 0.15, design.rearBlockTopMeters - 0.15);
  b.shape("roofDark", rear, design.rearBlockTopMeters, 0.04);
  b.shape("terracotta", screen, 0.15, design.screenTopMeters - 0.15);
  // A low coping and finite panel grid retain the tall pale rear stage volume.
  for (const e of edges(rear)) {
    const h = design.rearParapetTopMeters - design.rearBlockTopMeters;
    b.box(
      "ivory",
      [e.length, h, 0.2],
      at(e, e.length / 2, design.rearBlockTopMeters + h / 2, -0.07),
      angle(e),
    );
    for (let y = 1.1; y < design.rearBlockTopMeters; y += 1.15)
      b.plane(
        "metal",
        [e.length, 0.025],
        at(e, e.length / 2, y, 0.035),
        angle(e),
      );
    for (let d = 1.8; d < e.length; d += 1.8)
      b.plane(
        "metal",
        [0.023, design.rearBlockTopMeters - 0.3],
        at(e, d, (design.rearBlockTopMeters + 0.3) / 2, 0.035),
        angle(e),
      );
  }
  for (const e of edges(body))
    b.box(
      "ivory",
      [e.length, 0.35, 0.22],
      at(e, e.length / 2, design.mainEavesMeters + 0.1, 0.05),
      angle(e),
    );
  // Glazed foyer: generous panes, a simple door surround and a shallow silver canopy.
  b.shape("ivory", foyer, 0.15, design.foyerRoofMeters - 0.15);
  b.shape("roofDark", foyer, design.foyerRoofMeters, 0.07);
  const front = 0.0,
    x0 = 2.95,
    x1 = 21.55,
    mid = (x0 + x1) / 2;
  b.plane("glazing", [x1 - x0, 4.55], [mid, 3.25, front]);
  for (let i = 0; i <= 10; i++)
    b.box(
      "mullion",
      [0.07, 4.62, 0.08],
      [x0 + ((x1 - x0) * i) / 10, 3.25, front + 0.06],
    );
  for (const y of [1.0, 2.3, 3.9, 5.05, 5.48])
    b.box("mullion", [x1 - x0, 0.07, 0.08], [mid, y, front + 0.06]);
  b.plane("accent", [x1 - x0, 0.065], [mid, 1.99, front + 0.12]);
  // Freestanding geometry reads as an entrance frame, without embedding a photograph/sign texture.
  for (const x of [mid - 2.85, mid + 2.85])
    b.box("ivory", [0.42, 3.1, 0.3], [x, 2.5, front + 0.16]);
  b.box("ivory", [6.15, 0.48, 0.32], [mid, 4.0, front + 0.18]);
  b.plane("glazing", [5.25, 2.75], [mid, 2.38, front + 0.18]);
  for (const x of [mid - 1.3, mid, mid + 1.3])
    b.box("metal", [0.055, 2.8, 0.1], [x, 2.38, front + 0.25]);
  b.plane("accent", [5.25, 0.07], [mid, 2.02, front + 0.26]);
  b.box("metal", [19.5, 0.2, 3.35], [12.2, 5.67, -0.2]);
  for (let i = 0; i <= 8; i++)
    b.box(
      "mullion",
      [0.035, 0.025, 3.35],
      [2.45 + (i * 19.5) / 8, 5.785, -0.2],
    );
  // Shallow flat roof bands behind the overhang, not weathering/photo textures.
  for (const z of [-3.3, -6.2, -9.1])
    b.box("metal", [19.0, 0.1, 0.1], [12.25, design.foyerRoofMeters + 0.1, z]);

  // Narrow light/glass corner and the short connecting canopy to its side.
  b.shape("ivory", sideTower, 0.15, design.sideTowerTopMeters - 0.15);
  b.plane("glazing", [2.45, 5.6], [23.4, 3.65, 0.02]);
  for (const x of [22.15, 24.65])
    b.box("ivory", [0.28, 5.75, 0.22], [x, 3.65, 0.14]);
  for (const y of [1.0, 3.4, 6.35])
    b.box("metal", [2.55, 0.08, 0.1], [23.4, y, 0.16]);
  b.box(
    "ivory",
    [5.2, 0.2, 4.4],
    [24.15, design.sideTowerTopMeters + 0.1, -7.7],
  );
  for (let i = 0; i < 3; i++) {
    const z = -5.9 - i * 1.7;
    b.box(
      "metal",
      [0.75, 0.35, 0.9],
      [23.5, design.sideTowerTopMeters + 0.27, z],
    );
  }
  // Broad exterior steps are schematic and are not added to routing data.
  for (let i = 0; i < 10; i++)
    b.box(
      "ivory",
      [20.6, (i + 1) * 0.095, 0.52],
      [12.45, (i + 1) * 0.0475, 4.6 - i * 0.48],
    );
  // One screen-side grille and a few compact service boxes keep the distinctive long wall quiet.
  b.plane("mullion", [6.0, 1.9], [0.075, 3.5, -29.5], -Math.PI / 2);
  for (let i = 0; i < 9; i++)
    b.plane(
      "ivory",
      [5.9, 0.07],
      [0.035, 2.65 + i * 0.21, -29.5],
      -Math.PI / 2,
    );
  for (const z of [-16, -22, -28, -34, -40])
    b.box("metal", [0.7, 0.5, 1.35], [1.45, 7.1, z]);
  // Long opposite facade receives a restrained shallow window/vent band.
  b.plane("glazing", [28.0, 1.05], [23.035, 5.3, -29.8], Math.PI / 2);
  for (let i = 0; i <= 14; i++)
    b.plane("ivory", [0.07, 1.08], [23.1, 5.3, -43.8 + i * 2.0], Math.PI / 2);
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
        "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original B8 simplified geometry. Owner described two-storey height; component dimensions are visual estimates. Supplied images used as internal references only. No photograph textures, verified interior plan or navigation entrance.",
    }),
  );
  if (
    triangles > design.performance.triangleBudget ||
    drawCalls > design.performance.modelDrawCallBudget ||
    binary.length > design.performance.glbByteBudget
  )
    throw new Error(
      `B8 ${mode} budget exceeded: ${triangles} / ${drawCalls} / ${binary.length}`,
    );
  const file = `b8-lecture-hall-${mode}.glb`;
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
const volumes = {
  type: "FeatureCollection",
  stage: "visual_review_only_not_navigation_GIS",
  features: [
    ["source_plinth", points, 0, 0.18, "original_source_ring"],
    ["main", body, 0.15, design.mainRidgeMeters, "maximum_visual_envelope"],
    [
      "foyer",
      foyer,
      0.15,
      design.foyerRoofMeters,
      "photo_informed_display_part",
    ],
    [
      "rear_high_volume",
      rear,
      0.15,
      design.rearBlockTopMeters,
      "photo_informed_display_part",
    ],
    [
      "side_glass_volume",
      sideTower,
      0.15,
      design.sideTowerTopMeters,
      "photo_informed_display_part",
    ],
    [
      "curved_screen",
      screen,
      0.15,
      design.screenTopMeters,
      "photo_informed_display_part",
    ],
  ].map(([part, ring, base, height, accuracy]) => ({
    type: "Feature",
    id: `b8-preview-${part}`,
    properties: {
      placeId: place.id,
      part,
      base,
      height,
      heightAccuracy: design.heightAccuracy,
      geometryAccuracy: accuracy,
      heightScaleLevels: 2,
      interiorLevelsVerified: false,
      roofProfile:
        part === "main" ? "shallow_gable_in_GLB_and_generator" : null,
      approvedForMap: false,
    },
    geometry: { type: "Polygon", coordinates: [closed(ring)] },
  })),
};
await writeFile(
  `${folder}/b8-lecture-hall-2.5d.geojson`,
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
  previewEnvelopeAlignedMeters: [
    ...points,
    [26.9, -10],
    [26.9, 0],
    [23.0, 5.0],
    [1.0, 5.0],
  ],
  heightScaleLevels: 2,
  levelsSource: design.levelsSource,
  levelsAccuracy: design.levelsAccuracy,
  interiorLevelsVerified: false,
  heightAccuracy: design.heightAccuracy,
  appearanceAccuracy: design.appearanceAccuracy,
  geometryAccuracy: design.geometryAccuracy,
  alignedToLocal: { anchor, rotationYRadians: frameAngle },
  assets,
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { version: manifest.modelVersion, heightScaleLevels: 2, assets },
    null,
    2,
  ),
);
