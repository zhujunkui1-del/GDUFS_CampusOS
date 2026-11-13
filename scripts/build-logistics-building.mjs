// Logistics complex: source-exact partition into owner-confirmed 6/2/3-storey volumes.
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
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  InstancedMesh,
  BoxGeometry,
  PlaneGeometry,
  Box3,
  DoubleSide,
} from "three";
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
const folder = "docs/model-previews/logistics-building-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === "osm-way-313039029");
if (!place || place.name !== "后勤楼")
  throw new Error("Logistics building source missing");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const outer = place.geometry.slice(0, -1).map((c) => {
  const q = MercatorCoordinate.fromLngLat(c);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
});
const area = (r) =>
  r.reduce((s, a, i) => {
    const b = r[(i + 1) % r.length];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const parts = [
  {
    key: "south-six",
    role: "southern tallest bar",
    levels: 6,
    height: 20.4,
    indexes: [10, 11, 12, 13],
    wall: "ivory",
  },
  {
    key: "west-two",
    role: "western corner/connecting wing",
    levels: 2,
    height: 6.8,
    indexes: [0, 1, 2, 3, 4, 5, 6, 9, 10, 13, 14, 15],
    wall: "red",
  },
  {
    key: "north-three",
    role: "opposite northern bar",
    levels: 3,
    height: 10.2,
    indexes: [6, 7, 8, 9],
    wall: "ivory",
  },
].map((p) => ({ ...p, ring: p.indexes.map((i) => outer[i]) }));
const sourceArea = Math.abs(area(outer)),
  partitionArea = parts.reduce((s, p) => s + Math.abs(area(p.ring)), 0);
if (Math.abs(sourceArea - partitionArea) > 1e-6)
  throw new Error("Logistics source partition area mismatch");
const palette = {
  ivory: "#e5e4dd",
  red: "#b8756a",
  glass: "#70878d",
  blueGlass: "#789cae",
  metal: "#adb6b2",
  roof: "#d8d6ca",
  darkRoof: "#90938a",
};
function edges(r) {
  const sign = Math.sign(area(r));
  return r.map((a, i) => {
    const b = r[(i + 1) % r.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    return {
      a,
      b,
      dx,
      dz,
      length,
      nx: (sign * dz) / length,
      nz: (-sign * dx) / length,
    };
  });
}
function inset(r, amount) {
  const all = edges(r),
    cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  return r.map((p, i) => {
    const a = all[(i + all.length - 1) % all.length],
      b = all[i],
      p1 = [p[0] - a.nx * amount, p[1] - a.nz * amount],
      p2 = [p[0] - b.nx * amount, p[1] - b.nz * amount],
      den = cross([a.dx, a.dz], [b.dx, b.dz]);
    if (Math.abs(den) < 1e-7) return p1;
    const t = cross([p2[0] - p1[0], p2[1] - p1[1]], [b.dx, b.dz]) / den;
    return [p1[0] + a.dx * t, p1[1] + a.dz * t];
  });
}
function extrude(r, base, height) {
  const g = new ExtrudeGeometry(
    new Shape(r.map(([x, z]) => new Vector2(x, -z))),
    { depth: height, steps: 1, bevelEnabled: false, curveSegments: 1 },
  );
  g.rotateX(-Math.PI / 2);
  g.translate(0, base, 0);
  return g;
}
function makeModel(mode) {
  const mono = mode === "2.5d",
    scene = new Scene(),
    root = new Group();
  scene.add(root);
  scene.name = `后勤楼-${mode}`;
  const colors = mono ? { ivory: "#e8e5dc", roof: "#d5d2c8" } : palette;
  const mats = Object.fromEntries(
    Object.entries(colors).map(([name, color]) => {
      const m = new MeshStandardMaterial({
        color,
        roughness: name.toLowerCase().includes("glass") ? 0.58 : 0.92,
        metalness: name === "metal" ? 0.13 : 0,
        side: DoubleSide,
      });
      m.name = name;
      return [name, m];
    }),
  );
  const buckets = new Map();
  function add(mat, type, size, pos, angle = 0) {
    const key = `${mat}:${type}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets
      .get(key)
      .push(
        new Matrix4().compose(
          new Vector3(...pos),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
          new Vector3(...size),
        ),
      );
  }
  function shape(name, mat, r, base, height) {
    const mesh = new Mesh(extrude(r, base, height), mats[mat]);
    mesh.name = name;
    root.add(mesh);
  }
  function at(e, d, y, offset = 0) {
    return [
      e.a[0] + (e.dx * d) / e.length + e.nx * offset,
      y,
      e.a[1] + (e.dz * d) / e.length + e.nz * offset,
    ];
  }
  function band(e, y, height, mat, depth = 0.14, offset = 0) {
    add(
      mat,
      "box",
      [e.length, height, depth],
      at(e, e.length / 2, y, offset),
      Math.atan2(e.nx, e.nz),
    );
  }
  if (!mono) shape("exact-source-foundation", "ivory", outer, 0.1, 0.18);
  for (const part of parts) {
    if (mono) {
      shape(`plain-white-${part.key}`, "ivory", part.ring, 0, part.height);
      shape(`roof-cap-${part.key}`, "roof", part.ring, part.height, 0.22);
      continue;
    }
    shape(
      `${part.key}-main-volume`,
      part.wall,
      inset(part.ring, 0.38),
      0.28,
      part.height - 0.28,
    );
    shape(`${part.key}-flat-roof`, "roof", part.ring, part.height, 0.2);
    const all = edges(part.ring);
    for (const [edgeIndex, e] of all.entries()) {
      const angle = Math.atan2(e.nx, e.nz),
        long = e.length > 25;
      // Hidden interfaces with the corner wing do not need a second facade grid.
      const shared =
        (part.key === "south-six" || part.key === "north-three") &&
        edgeIndex === 3;
      {
        const bays = shared
          ? 1
          : Math.max(
              1,
              Math.round(e.length / (part.key === "west-two" ? 4.3 : 2.85)),
            );
        for (let floor = 0; floor < part.levels; floor++) {
          if (shared && floor < 2) continue;
          const y = 0.3 + floor * 3.4;
          const upperNarrow = part.levels === 6 && floor >= 2;
          const h = upperNarrow ? 1.15 : 1.7;
          for (let k = 0; k < bays; k++) {
            const d = (e.length * (k + 0.5)) / bays,
              width = shared ? 1.3 : Math.max(0.5, e.length / bays - 0.4);
            add(
              part.levels === 3 ? "blueGlass" : "glass",
              "plane",
              [width, h, 1],
              at(e, d, y + 1.85, -0.27),
              angle,
            );
            add(
              "metal",
              "plane",
              [0.045, h, 1],
              at(e, d, y + 1.85, -0.25),
              angle,
            );
          }
          band(e, y + 0.12, 0.17, part.wall, 0.24, 0.02);
          if (long && part.levels === 6 && e.nz < -0.5 && floor > 0) {
            band(e, y + 0.62, 0.045, "metal", 0.045, 0.08);
          }
        }
      }
      band(e, part.height + 0.48, 0.55, "ivory", 0.15, -0.06);
    }
    // Roof seams stay inside each source-derived volume.
    const xs = part.ring.map((p) => p[0]),
      zs = part.ring.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minZ = Math.min(...zs),
      maxZ = Math.max(...zs);
    if (part.key !== "west-two") {
      add(
        "darkRoof",
        "box",
        [maxX - minX - 4, 0.012, 0.035],
        [(maxX + minX) / 2, part.height + 0.207, (minZ + maxZ) / 2],
      );
    }
  }
  if (!mono) {
    const high = parts[0];
    // Light open roof structures at the two ends of the six-storey bar.
    for (const [x, length] of [
      [-6.5, 9],
      [33.5, 7.2],
    ]) {
      for (const dx of [-length / 2, length / 2])
        for (const z of [10.7, 17.8])
          add("ivory", "box", [0.18, 1.55, 0.18], [x + dx, 21.375, z]);
      for (const z of [10.7, 17.8])
        add("ivory", "box", [length, 0.17, 0.18], [x, 22.15, z]);
      for (let k = 0; k <= 5; k++)
        add(
          "ivory",
          "box",
          [0.15, 0.17, 7.3],
          [x - length / 2 + (k * length) / 5, 22.15, 14.25],
        );
    }
    // Tall stair/core strips on the highest block preserve the pale facade rhythm.
    for (const x of [-10.8, 36.0]) {
      add("ivory", "box", [0.55, 19.8, 0.24], [x, 10.3, 19.16]);
      for (let y = 2.3; y < high.height; y += 3.4)
        add("glass", "plane", [0.75, 1.65, 1], [x - 1.1, y, 19.14]);
    }
    // Courtyard-facing circulation ledges and fine rail lines, on the high block only.
    for (let floor = 1; floor < 6; floor++) {
      const y = 0.3 + floor * 3.4;
      add("ivory", "box", [50, 0.16, 0.75], [12.7, y, 9.65]);
      add("metal", "box", [50, 0.045, 0.045], [12.7, y + 0.9, 9.31]);
    }
    // Low corner wing has a few small flat-roof service boxes; no additional storey.
    for (const [x, z] of [
      [-28, -12],
      [-23, 3],
    ]) {
      add("metal", "box", [1.8, 0.65, 1.25], [x, 7.35, z]);
      add("ivory", "box", [1.9, 0.12, 1.35], [x, 7.74, z]);
    }
    // Simple threshold on the open east side, display-only and outside the route graph.
    add("ivory", "box", [3, 0.2, 4.5], [28.2, 1.1, -16.2]);
    for (let i = 0; i < 4; i++)
      add(
        "ivory",
        "box",
        [0.45, 0.18, 4.5],
        [30.2 + i * 0.45, 0.85 - i * 0.18, -16.2],
      );
  }
  for (const [key, matrices] of buckets) {
    const [mat, type] = key.split(":"),
      geometry =
        type === "plane" ? new PlaneGeometry(1, 1) : new BoxGeometry(1, 1, 1);
    const mesh = new InstancedMesh(geometry, mats[mat], matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = key;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  scene.userData = {
    modelVersion: "logistics-building-v1-2026-11-13",
    placeId: place.id,
    levels: { south: 6, corner: 2, north: 3 },
    levelsSource: "owner_confirmed",
    heightAccuracy: "photo_visual_estimate_not_surveyed",
    imageCount: 0,
    textureCount: 0,
    courtyardIsOpenEast: true,
    stepsAreNavigationPaths: false,
  };
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene, true);
  let triangles = 0,
    drawCalls = 0;
  scene.traverse((n) => {
    if (n.isMesh) {
      triangles +=
        ((n.geometry.index?.count ?? n.geometry.attributes.position.count) /
          3) *
        (n.isInstancedMesh ? n.count : 1);
      drawCalls++;
    }
  });
  return {
    scene,
    stats: {
      triangles,
      drawCalls,
      materialCount: Object.keys(mats).length,
      textureCount: 0,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    },
  };
}
await mkdir(folder, { recursive: true });
const assets = {};
for (const mode of ["2.5d", "3d"]) {
  const { scene, stats } = makeModel(mode),
    binary = Buffer.from(
      await new GLTFExporter().parseAsync(scene, {
        binary: true,
        trs: false,
        copyright:
          "CampusOS procedural logistics building complex; source OSM footprint preserved. Reference images not published; metric dimensions and internal part boundaries are display estimates.",
      }),
    );
  const file = `logistics-building-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  assets[mode] = { file, sha256: hash(binary), bytes: binary.length, ...stats };
}
const paths = [
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/后勤楼89.png",
  "C:/Users/zhuju/Downloads/后勤楼卫星图.png",
];
const references = await Promise.all(
  paths.map(async (path) => ({
    path,
    sha256: hash(await readFile(path)),
    usage: "internal_visual_reference_only_no_pixels_published",
  })),
);
const manifest = {
  modelVersion: "logistics-building-v1-2026-11-13",
  sourceMapVersion: campus.mapVersion,
  mapIntegrated: true,
  placeId: place.id,
  name: place.name,
  origin: place.coordinate,
  sourceGeometryWgs84: place.geometry,
  sourceFootprintSha256: hash(JSON.stringify(place.geometry)),
  sourceVertexCount: outer.length,
  levels: { south: 6, corner: 2, north: 3 },
  levelsSource:
    "Owner confirmed highest block six levels, corner two levels, opposite block three levels. Placement follows the supplied imagery.",
  heightAccuracy: "photo_visual_estimate_not_surveyed",
  sourceAreaMetersSquared: sourceArea,
  partitionAreaMetersSquared: partitionArea,
  parts: parts.map((p) => ({
    key: p.key,
    role: p.role,
    levels: p.levels,
    heightMeters: p.height,
    sourceVertexIndexes: p.indexes,
    localRingMeters: p.ring,
  })),
  orientation:
    "South bar six storeys; west corner/connector two storeys; opposite north bar three storeys. U-shaped footprint remains open to the east.",
  assets,
  references,
  limitations: [
    "Floor counts are owner-confirmed; metric heights, facade bays and roof frames remain visual estimates.",
    "Part cuts join existing source vertices and preserve the footprint area, but are display partitions, not new GIS building boundaries or IDs.",
    "Open courtyard is preserved through the source concave outline; no surveyed inner ring or navigation path is added.",
    "2.5D uses only stepped plain white volumes and roof caps; all facade detail is 3D-only.",
  ],
};
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  `${folder}/design.json`,
  JSON.stringify(
    {
      version: manifest.modelVersion,
      placeId: place.id,
      parts: manifest.parts,
      palette,
      assets,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      name: place.name,
      levels: manifest.levels,
      partitionAreaError: Math.abs(sourceArea - partitionArea),
      assets,
    },
    null,
    2,
  ),
);
