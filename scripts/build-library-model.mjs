// Display drafts only. Never writes campus GIS, approved South7 assets or public/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
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
  Group,
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
const folder = "docs/model-previews/library-v1";
const design = JSON.parse(await readFile(`${folder}/design.json`, "utf8"));
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === design.placeId);
if (campus.mapVersion !== design.sourceMapVersion || !place?.geometry)
  throw new Error("Review library footprint/map version before regeneration.");
const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const units = origin.meterInMercatorCoordinateUnits();
const local = place.geometry.slice(0, -1).map((p) => {
  const q = MercatorCoordinate.fromLngLat(p);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
});
const anchor = local[0];
const axisAngle = Math.atan2(local[1][1] - anchor[1], local[1][0] - anchor[0]);
const cos = Math.cos(axisAngle),
  sin = Math.sin(axisAngle);
const aligned = local.map(([x, z]) => [
  (x - anchor[0]) * cos + (z - anchor[1]) * sin,
  -(x - anchor[0]) * sin + (z - anchor[1]) * cos,
]);
const toWorld = ([x, z]) => [
  anchor[0] + x * cos - z * sin,
  anchor[1] + x * sin + z * cos,
];
const toWgs84 = (p) => {
  const [x, z] = toWorld(p);
  const ll = new MercatorCoordinate(
    origin.x + x * units,
    origin.y + z * units,
  ).toLngLat();
  return [ll.lng, ll.lat];
};
const main = [[25, 0], ...aligned.slice(1, 9)];
const annex = [aligned[0], [25, 0], aligned[8], aligned[9]];
const court = design.courtyardAlignedMeters;
const floors = design.floorElevationsMeters;
const roof = design.roofTopMeters;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const area = (ring) =>
  ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0) /
  2;
function contains(ring, [x, z]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      c = ring[j];
    if (
      a[1] > z !== c[1] > z &&
      x < ((c[0] - a[0]) * (z - a[1])) / (c[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function edges(ring, inner = false) {
  const sign = Math.sign(area(ring)) * (inner ? -1 : 1);
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
function inset(ring, amount, inner = false) {
  const all = edges(ring, inner);
  return ring.map((p, i) => {
    const a = all[(i + all.length - 1) % all.length],
      b = all[i];
    const p1 = [p[0] - a.normal[0] * amount, p[1] - a.normal[1] * amount];
    const p2 = [p[0] - b.normal[0] * amount, p[1] - b.normal[1] * amount];
    const den = cross([a.dx, a.dz], [b.dx, b.dz]);
    if (Math.abs(den) < 0.001) return p1;
    const t = cross([p2[0] - p1[0], p2[1] - p1[1]], [b.dx, b.dz]) / den;
    return [p1[0] + a.dx * t, p1[1] + a.dz * t];
  });
}
function extrusion(outer, holes, base, height) {
  const shape = new Shape(outer.map(([x, z]) => new Vector2(x, -z)));
  for (const hole of holes)
    shape.holes.push(new Path(hole.map(([x, z]) => new Vector2(x, -z))));
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
    terracotta: "#c58c77",
    silver: "#c9cece",
    limestone: "#e6e2d7",
    glazing: "#5e7c89",
    mullion: "#6b777b",
    roof: "#8e908b",
    panels: "#485f6c",
  },
};
function builder(mode) {
  const scene = new Scene();
  scene.name = `CampusOS-library-${mode}-six-levels`;
  const materials = Object.fromEntries(
    Object.entries(palettes[mode]).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: name === "glazing" ? 0.45 : 0.9,
        metalness: name === "silver" ? 0.18 : 0,
      });
      material.name = name;
      if (name === "glazing") material.side = DoubleSide;
      return [name, material];
    }),
  );
  const shapes = new Map(),
    repeats = new Map();
  function shape(mat, outer, holes, base, height) {
    if (!shapes.has(mat)) shapes.set(mat, []);
    shapes.get(mat).push(extrusion(outer, holes, base, height));
  }
  function piece(mat, type, size, position, angle = 0) {
    const key = `${mat}:${type}`;
    if (!repeats.has(key)) repeats.set(key, []);
    repeats
      .get(key)
      .push(
        new Matrix4().compose(
          new Vector3(...position),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
          new Vector3(...size),
        ),
      );
  }
  const box = (mat, size, position, angle = 0) =>
    piece(mat, "box", size, position, angle);
  const plane = (mat, size, position, angle = 0) =>
    piece(mat, "plane", [size[0], size[1], 1], position, angle);
  function finish() {
    // A handful of material buckets, with instancing for repeated facade pieces.
    for (const [mat, all] of shapes) {
      const mesh = new Mesh(mergeGeometries(all), materials[mat]);
      mesh.name = `${mat}-volumes`;
      scene.add(mesh);
    }
    for (const [key, matrices] of repeats) {
      const [mat, type] = key.split(":");
      const geometry =
        type === "box"
          ? new BoxGeometry(1, 1, 1)
          : type === "plane"
            ? new PlaneGeometry(1, 1)
            : new CylinderGeometry(1, 1, 1, 12, 1, true);
      const mesh = new InstancedMesh(geometry, materials[mat], matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.name = key;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
    // Same local coordinate convention as the approved map model: east/up/south.
    // glTF scenes have no transform of their own; retain the frame as an explicit node.
    const frame = new Group();
    frame.name = "local-east-up-south-frame";
    frame.add(...scene.children);
    frame.rotation.y = -axisAngle;
    frame.position.set(anchor[0], 0, anchor[1]);
    scene.add(frame);
    scene.userData = {
      modelVersion: design.version,
      mode,
      levels: design.levels,
      heightAccuracy: design.heightAccuracy,
      courtyardAccuracy: design.courtyardAccuracy,
      mapIntegrated: false,
    };
    scene.updateMatrixWorld(true);
    return scene;
  }
  return { shape, piece, box, plane, finish };
}
function makeVolume() {
  const b = builder("2.5d");
  b.shape("volume", main, [court], 0, roof - 0.3);
  b.shape("cap", main, [court], roof - 0.3, 0.3);
  b.shape("volume", annex, [], 0, design.annexTopMeters - 0.3);
  b.shape("cap", annex, [], design.annexTopMeters - 0.3, 0.3);
  return b.finish();
}
function makeDetailed() {
  const b = builder("3d");
  // Front plate is recessed; the full-height entrance opening and portico remain empty.
  const core = [[25, 5.5], [123.84, 5.5], ...aligned.slice(2, 9)];
  b.shape("terracotta", core, [court], 1, floors[5] - 1);
  b.shape("glazing", core, [court], floors[5], floors[6] - floors[5]);
  b.shape("limestone", main, [court], 0.65, 0.35);
  // Wide projecting eave and dark roof bed. Every roof surface retains the court opening.
  b.shape("roof", main, [court], floors[6], 0.18);
  b.shape("silver", inset(main, -1.1), [inset(main, 3.1)], roof - 0.28, 0.28);
  b.shape(
    "limestone",
    inset(main, 4.6),
    [inset(court, 0.8, true)],
    floors[6] + 0.19,
    0.12,
  );
  b.shape(
    "limestone",
    inset(court, 0.45, true),
    [court],
    floors[6] + 0.18,
    0.8,
  );

  // Main front: entrance on the rounded-corner end; low finned annex at the opposite end.
  for (const [left, right] of [
    [25, 30.5],
    [75, 81],
    [116.5, 123.96],
  ])
    b.box(
      "terracotta",
      [right - left, 21.6, 5.6],
      [(left + right) / 2, 11.8, 2.75],
    );
  b.box("terracotta", [48.96, 1.35, 5.7], [99.48, 22.6, 2.75]);
  // Long glazed recess and four round columns; no simulated room interiors.
  b.plane("glazing", [35.3, 20.8], [98.75, 11.4, 5.46], Math.PI);
  for (const x of [83, 93.5, 104, 114.5])
    b.piece("silver", "cylinder", [0.45, 21.4, 0.45], [x, 11.7, 0.65]);
  for (const y of floors.slice(1, 5)) {
    b.box("silver", [35.3, 0.24, 0.1], [98.75, y, 5.31]);
    b.box("limestone", [35.3, 0.8, 0.12], [98.75, y - 0.58, 5.28]);
  }
  for (let x = 82; x < 117; x += 2.1)
    b.box("mullion", [0.075, 20.5, 0.08], [x, 11.3, 5.28]);
  for (let y = 2; y < 22; y += 1.8)
    b.box("mullion", [35.3, 0.055, 0.08], [98.75, y, 5.24]);
  for (const x of [89, 106])
    b.box("silver", [14.4, 0.19, 4.6], [x, 5.35, 2.25]);
  b.box("silver", [5.2, 2.8, 0.14], [99, 2.4, 5.2]);
  b.plane("glazing", [4.6, 2.4], [99, 2.35, 5.1], Math.PI);

  // Reading-room glazing behind a small number of genuine three-dimensional fins.
  b.plane("glazing", [44.5, 14.8], [52.75, 15.0, 1.75], Math.PI);
  for (let i = 0; i < 23; i++) {
    const x = 31 + i * 1.96;
    b.box("silver", [0.42, 15.05, 1.55], [x, 15.02, 0.72]);
  }
  for (const y of [10, 14.2, 18.4, 22.4])
    b.box("mullion", [44.5, 0.12, 0.12], [52.75, y, 1.62]);
  b.box("terracotta", [45, 1.35, 5.5], [52.75, 7.05, 2.75]);
  for (const x of [30.6, 41.7, 52.8, 63.9, 75])
    b.box("terracotta", [1.8, 5.6, 5.5], [x, 3.7, 2.7]);
  b.plane("glazing", [43.5, 5.3], [52.7, 3.7, 5.42], Math.PI);
  // Two broad stair flights are a visible exterior motif, not a navigable interior.
  for (let step = 0; step < 8; step++) {
    b.box(
      "limestone",
      [1.0, 0.15, 1.6],
      [34.2 + step * 0.72, 1.35 + step * 0.32, 3.45],
    );
    b.box(
      "limestone",
      [1.0, 0.15, 1.6],
      [48.4 - step * 0.72, 3.6 + step * 0.32, 3.5],
    );
  }
  for (let i = 0; i < 7; i++)
    b.box(
      "limestone",
      [94, 0.13, 0.65],
      [76, 0.12 + i * 0.13, -4.2 + i * 0.65],
    );
  // Set-back top floor is the sixth storey, below the thin continuous silver roof.
  b.plane("glazing", [98.2, 4.0], [74.0, 24.65, 5.42], Math.PI);
  for (let x = 26; x < 123; x += 3.0)
    b.box("silver", [0.16, 4.1, 0.22], [x, 24.7, 4.9]);

  // Long side with five tall recessed window bays and compact entry canopies.
  const side = edges(main)[3];
  function at(edge, distance, y, offset = 0) {
    return [
      edge.a[0] + (edge.dx * distance) / edge.length + edge.normal[0] * offset,
      y,
      edge.a[1] + (edge.dz * distance) / edge.length + edge.normal[1] * offset,
    ];
  }
  function angle(edge) {
    return Math.atan2(edge.normal[0], edge.normal[1]);
  }
  for (let i = 0; i < 5; i++) {
    const d = (side.length * (i + 0.65)) / 5.6;
    b.plane("glazing", [5.5, 17.2], at(side, d, 13.0, 0.035), angle(side));
    for (const y of [6, 10, 14.2, 18.4, 21.6])
      b.box("silver", [5.6, 0.14, 0.18], at(side, d, y, 0.12), angle(side));
    for (const dx of [-2.0, 0, 2.0])
      b.box(
        "silver",
        [0.09, 17.2, 0.12],
        at(side, d + dx, 13, 0.12),
        angle(side),
      );
    b.box("silver", [6.0, 0.16, 2.6], at(side, d, 4.35, 1.15), angle(side));
  }
  // Two planar segments follow the source's cut/rounded corner, with cheap louver bands.
  for (const edge of edges(main).slice(1, 3)) {
    b.plane(
      "glazing",
      [edge.length, 24.9],
      at(edge, edge.length / 2, 13.5, 0.03),
      angle(edge),
    );
    for (let y = 3; y < 26; y += 0.88)
      b.box(
        "silver",
        [edge.length, 0.12, 0.24],
        at(edge, edge.length / 2, y, 0.19),
        angle(edge),
      );
  }
  // Remaining exterior bays: repeated simple windows; ground/first-floor rhythm is retained.
  for (const edge of edges(main).slice(4)) {
    if (edge.length < 7) continue;
    const count = Math.max(1, Math.floor(edge.length / 4.2));
    for (let i = 0; i < count; i++)
      for (let level = 0; level < 6; level++) {
        const d = (edge.length * (i + 0.5)) / count;
        const y = (floors[level] + floors[level + 1]) / 2;
        b.plane("glazing", [2.4, 1.95], at(edge, d, y, 0.035), angle(edge));
      }
    b.box(
      "silver",
      [edge.length, 0.15, 0.3],
      at(edge, edge.length / 2, 22.6, 0.06),
      angle(edge),
    );
  }
  // Open lightwell. The display hole is never written into navigation/GIS data.
  for (const edge of edges(court, true)) {
    b.box(
      "limestone",
      [edge.length, 25.8, 0.15],
      at(edge, edge.length / 2, 13.9, 0.06),
      angle(edge),
    );
    for (const y of floors.slice(1, 6))
      b.box(
        "silver",
        [edge.length, 0.2, 0.35],
        at(edge, edge.length / 2, y, 0.18),
        angle(edge),
      );
    const bays = Math.max(1, Math.floor(edge.length / 4.8));
    for (let i = 0; i < bays; i++)
      for (let level = 0; level < 6; level++)
        b.plane(
          "glazing",
          [Math.min(3.2, edge.length / bays - 0.5), 2.5],
          at(
            edge,
            (edge.length * (i + 0.5)) / bays,
            (floors[level] + floors[level + 1]) / 2,
            0.28,
          ),
          angle(edge),
        );
  }
  // Roof: a small square light, service boxes and a few panel banks, not every rooftop item.
  for (const [x, z, w, d] of [
    [95, 27, 8, 6],
    [77, 65, 8, 5],
    [30, 34, 5, 6],
  ]) {
    b.box("terracotta", [w, 2.1, d], [x, roof + 1.05, z]);
    b.box("silver", [w + 0.3, 0.18, d + 0.3], [x, roof + 2.13, z]);
  }
  b.box("glazing", [7, 0.65, 6], [91, roof + 0.32, 42]);
  b.box("silver", [7.3, 0.12, 0.12], [91, roof + 0.7, 39]);
  // Panel banks stay inside the roof and away from the open court.
  for (const z of [40, 45, 50, 55])
    for (let col = 0; col < 4; col++) {
      const x = 84 + col * 6.8;
      if (
        [-3.2, 3.2].every((dx) =>
          [-1.6, 1.6].every(
            (dz) =>
              contains(inset(main, 5), [x + dx, z + dz]) &&
              !contains(court, [x + dx, z + dz]),
          ),
        )
      )
        b.box("panels", [6.0, 0.12, 2.8], [x, roof + 0.25, z]);
    }
  // Circular glass roof crown, open at the top and faceted to limit geometry.
  const cx = 116.0,
    cz = 14.0,
    radius = 4.4,
    segments = 16;
  b.piece(
    "silver",
    "cylinder",
    [radius + 0.4, 0.38, radius + 0.4],
    [cx, roof + 0.19, cz],
  );
  for (let i = 0; i < segments; i++) {
    const theta = (i * Math.PI * 2) / segments;
    const x = cx + Math.sin(theta) * radius,
      z = cz + Math.cos(theta) * radius;
    b.box("silver", [0.12, 3.0, 0.12], [x, roof + 1.9, z]);
    b.plane(
      "glazing",
      [2 * radius * Math.sin(Math.PI / segments), 2.5],
      [
        cx +
          Math.sin(theta + Math.PI / segments) *
            radius *
            Math.cos(Math.PI / segments),
        roof + 1.65,
        cz +
          Math.cos(theta + Math.PI / segments) *
            radius *
            Math.cos(Math.PI / segments),
      ],
      theta + Math.PI / segments,
    );
    for (const y of [roof + 0.4, roof + 1.6, roof + 3.15])
      b.box(
        "silver",
        [2 * radius * Math.tan(Math.PI / segments), 0.1, 0.1],
        [x, y, z],
        theta,
      );
  }
  // Low annex carries its own roof height, without pretending it is a separate six-storey block.
  b.shape("limestone", annex, [], 0.65, design.annexTopMeters - 0.65);
  b.shape("silver", inset(annex, -0.65), [], design.annexTopMeters, 0.25);
  b.plane("glazing", [23.5, 12.6], [12.5, 7.5, -0.035], Math.PI);
  for (let x = 1.5; x < 25; x += 1.8)
    b.box("silver", [0.45, 13.2, 1.0], [x, 7.5, -0.5]);
  return b.finish();
}
await mkdir(folder, { recursive: true });
const assets = {};
for (const [mode, scene] of [
  ["2.5d", makeVolume()],
  ["3d", makeDetailed()],
]) {
  let triangles = 0,
    drawCalls = 0;
  const materials = new Set();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    triangles +=
      ((node.geometry.index?.count ?? node.geometry.attributes.position.count) /
        3) *
      (node.isInstancedMesh ? node.count : 1);
    materials.add(node.material.name);
    drawCalls++;
  });
  const binary = Buffer.from(
    await new GLTFExporter().parseAsync(scene, {
      binary: true,
      copyright:
        "OSM footprint © OpenStreetMap contributors (ODbL-1.0). CampusOS original schematic geometry. Owner supplied photographs used only as internal references; no photo textures. Height is a visual estimate, six levels owner confirmed.",
    }),
  );
  if (
    triangles > design.performance.triangleBudget ||
    drawCalls > design.performance.modelDrawCallBudget ||
    binary.length > design.performance.glbByteBudget
  )
    throw new Error(
      `Library ${mode} budget exceeded: ${triangles} triangles / ${drawCalls} draws / ${binary.length} bytes`,
    );
  const file = `library-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  // Compute transformed vertex bounds, avoiding the broad box of a rotated wedge.
  const bounds = new Box3();
  const matrix = new Matrix4(),
    instance = new Matrix4(),
    vertex = new Vector3();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position;
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
  assets[mode] = {
    url: `./${file}`,
    sha256: hash(binary),
    bytes: binary.length,
    triangles,
    drawCalls,
    materialCount: materials.size,
    textureCount: 0,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
}
const closed = (ring) => [...ring.map(toWgs84), toWgs84(ring[0])];
const volumes = {
  type: "FeatureCollection",
  stage: "visual_review_only_not_navigation_GIS",
  features: [
    ["main", main, [court], roof],
    ["annex", annex, [], design.annexTopMeters],
  ].map(([part, outer, holes, height]) => ({
    type: "Feature",
    id: `library-preview-${part}`,
    properties: {
      placeId: place.id,
      part,
      levels: part === "main" ? 6 : null,
      height,
      heightAccuracy: design.heightAccuracy,
      courtyardAccuracy: design.courtyardAccuracy,
      approvedForMap: false,
    },
    geometry: {
      type: "Polygon",
      coordinates: [closed(outer), ...holes.map(closed)],
    },
  })),
};
await writeFile(
  `${folder}/library-2.5d.geojson`,
  JSON.stringify(volumes, null, 2) + "\n",
);
const manifest = {
  modelVersion: design.version,
  stage: design.stage,
  mapIntegrated: false,
  placeId: place.id,
  sourceMapVersion: campus.mapVersion,
  origin: place.coordinate,
  footprintSha256: hash(JSON.stringify(place.geometry)),
  sourceGeometryWgs84: place.geometry,
  footprintAlignedMeters: aligned,
  levels: 6,
  levelsSource: design.levelsSource,
  heightAccuracy: design.heightAccuracy,
  roofTopMeters: roof,
  appearanceAccuracy: design.appearanceAccuracy,
  courtyard: {
    alignedMeters: court,
    localMeters: court.map(toWorld),
    accuracy: design.courtyardAccuracy,
  },
  alignedToLocal: { anchor, rotationYRadians: -axisAngle },
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
