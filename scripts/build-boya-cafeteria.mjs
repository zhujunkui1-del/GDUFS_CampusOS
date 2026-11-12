// Boya Garden / Second Cafeteria: self-authored, image-free map geometry.
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
const folder = "docs/model-previews/boya-cafeteria-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === "osm-way-313039061");
if (!place || place.name !== "博雅园（二饭）")
  throw new Error("Boya cafeteria source missing");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const sourceLocal = place.geometry.slice(0, -1).map((c) => {
  const p = MercatorCoordinate.fromLngLat(c);
  return [(p.x - origin.x) / units, (p.y - origin.y) / units];
});
// Near east-west southern edge. Local +Z is south; apex stays north of the base.
const anchor = sourceLocal[1],
  axisAngle = Math.atan2(
    sourceLocal[7][1] - anchor[1],
    sourceLocal[7][0] - anchor[0],
  );
const co = Math.cos(axisAngle),
  si = Math.sin(axisAngle);
const outer = sourceLocal.map(([x, z]) => [
  (x - anchor[0]) * co + (z - anchor[1]) * si,
  -(x - anchor[0]) * si + (z - anchor[1]) * co,
]);
const triangle = [outer[0], outer[1], outer[7]];
const annex = outer.slice(2, 7);
// Four levels confirmed by the owner; heights and the roof tiers remain visual estimates.
const levels = 4,
  datums = [0.3, 3.9, 7.5, 11.1],
  roofTop = 14.7,
  frameTop = 16.1;
const core = [
  [12, -4],
  [12, -7],
  [48.8, -31.5],
  [67.6, -5],
  [58, -3],
  [52, -5],
  [47, -1],
  [39, -3],
  [30, 0],
  [25, -3],
];
const palette = {
  ivory: "#e6e3da",
  orange: "#cf846a",
  glass: "#647d87",
  metal: "#aab4b1",
  roof: "#d5d2c7",
  frame: "#827b72",
  vent: "#818a88",
};
const area = (r) =>
  r.reduce((s, a, i) => {
    const b = r[(i + 1) % r.length];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
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
function extrude(ring, base, height) {
  const g = new ExtrudeGeometry(
    new Shape(ring.map(([x, z]) => new Vector2(x, -z))),
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
  scene.name = `博雅园（二饭）-${mode}`;
  root.position.set(anchor[0], 0, anchor[1]);
  root.rotation.y = -axisAngle;
  scene.add(root);
  const colors = mono ? { ivory: "#e8e5dc", roof: "#d5d2c8" } : palette;
  const mats = Object.fromEntries(
    Object.entries(colors).map(([name, color]) => {
      const m = new MeshStandardMaterial({
        color,
        roughness: name === "glass" ? 0.58 : 0.92,
        metalness: name === "metal" ? 0.15 : 0,
        side: DoubleSide,
      });
      m.name = name;
      return [name, m];
    }),
  );
  const buckets = new Map();
  function matrix(mat, type, transform) {
    const key = `${mat}:${type}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(transform);
  }
  function add(mat, type, size, pos, angle = 0) {
    matrix(
      mat,
      type,
      new Matrix4().compose(
        new Vector3(...pos),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
        new Vector3(...size),
      ),
    );
  }
  function rod(mat, a, b, width = 0.075) {
    const start = new Vector3(...a),
      end = new Vector3(...b),
      direction = end.clone().sub(start);
    matrix(
      mat,
      "box",
      new Matrix4().compose(
        start.add(end).multiplyScalar(0.5),
        new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          direction.clone().normalize(),
        ),
        new Vector3(width, direction.length(), width),
      ),
    );
  }
  function shape(name, mat, ring, base, height) {
    const m = new Mesh(extrude(ring, base, height), mats[mat]);
    m.name = name;
    root.add(m);
  }
  function wallBand(e, y, height, mat, thickness = 0.18, offset = 0) {
    add(
      mat,
      "box",
      [e.length, height, thickness],
      [e.a[0] + e.dx / 2 + e.nx * offset, y, e.a[1] + e.dz / 2 + e.nz * offset],
      Math.atan2(e.nx, e.nz),
    );
  }
  function railing(e, y, offset = 0) {
    for (const h of [0.55, 0.95])
      wallBand(e, y + h, 0.05, "metal", 0.05, offset);
    for (let d = 0.6; d < e.length; d += 3.5)
      add(
        "metal",
        "box",
        [0.05, 0.95, 0.05],
        [
          e.a[0] + (e.dx * d) / e.length + e.nx * offset,
          y + 0.5,
          e.a[1] + (e.dz * d) / e.length + e.nz * offset,
        ],
      );
  }
  if (mono) {
    shape("plain-white-source-volume", "ivory", outer, 0, roofTop);
    shape("light-roof-cap", "roof", outer, roofTop, 0.25);
  } else {
    shape("exact-source-ground-slab", "ivory", outer, 0.15, 0.22);
    shape(
      "four-storey-stepped-dining-core",
      "ivory",
      core,
      0.37,
      roofTop - 0.37,
    );
    // The southern stepped projection is a lower tier, not an independent GIS building.
    shape("lower-south-annex", "ivory", annex, 0.37, 10.65);
    shape("south-annex-roof", "roof", annex, 11.02, 0.2);
    shape("main-flat-roof", "roof", core, roofTop, 0.2);
    for (const e of edges(core)) {
      const angle = Math.atan2(e.nx, e.nz),
        bays = Math.max(1, Math.round(e.length / 4.2));
      for (const y of datums) {
        wallBand(e, y + 0.16, 0.16, "ivory", 0.24, 0.02);
        for (let i = 0; i < bays; i++) {
          const d = (e.length * (i + 0.5)) / bays,
            pos = [
              e.a[0] + (e.dx * d) / e.length + e.nx * 0.06,
              y + 1.8,
              e.a[1] + (e.dz * d) / e.length + e.nz * 0.06,
            ];
          add(
            "glass",
            "plane",
            [Math.max(0.5, e.length / bays - 0.35), 1.55, 1],
            pos,
            angle,
          );
          add(
            "ivory",
            "plane",
            [0.07, 1.55, 1],
            [pos[0] + e.nx * 0.012, pos[1], pos[2] + e.nz * 0.012],
            angle,
          );
        }
      }
      wallBand(e, 15.1, 0.35, "ivory", 0.14);
    }
    for (const [index, e] of edges(annex).entries()) {
      if (index === annex.length - 1) continue;
      const bays = Math.max(1, Math.round(e.length / 3.7)),
        angle = Math.atan2(e.nx, e.nz);
      for (const y of datums.slice(0, 3)) {
        for (let i = 0; i < bays; i++) {
          const d = (e.length * (i + 0.5)) / bays;
          add(
            "glass",
            "plane",
            [Math.max(0.6, e.length / bays - 0.4), 1.65, 1],
            [
              e.a[0] + (e.dx * d) / e.length + e.nx * 0.04,
              y + 1.8,
              e.a[1] + (e.dz * d) / e.length + e.nz * 0.04,
            ],
            angle,
          );
        }
        wallBand(e, y + 0.2, 0.22, "ivory", 0.25, 0.04);
      }
      railing(e, 11.22, -0.1);
    }
    const triEdges = edges(triangle);
    // The long orange screen parallels the east-west Shiyuan block in the foreground.
    const screen = triEdges[1];
    wallBand(screen, 8.3, 16.1, "orange", 0.65, -0.05);
    // Small openings remain a sparse motif in the mostly solid screen.
    for (const d of [24, 42, 55])
      for (const y of [7.4, 11.4]) {
        add(
          "glass",
          "plane",
          [0.9, 0.65, 1],
          [
            screen.a[0] + (screen.dx * d) / screen.length + screen.nx * 0.31,
            y,
            screen.a[1] + (screen.dz * d) / screen.length + screen.nz * 0.31,
          ],
          Math.atan2(screen.nx, screen.nz),
        );
      }
    // The surrounding roof is a narrow perimeter band and open frame, not a filled triangular lid.
    for (const [index, e] of triEdges.entries()) {
      const angle = Math.atan2(e.nx, e.nz),
        offset = -2.1;
      wallBand(e, roofTop + 0.25, 0.19, "frame", 3.4, offset);
      wallBand(e, frameTop, 0.21, "frame", 0.18, -0.35);
      wallBand(e, frameTop, 0.21, "frame", 0.18, -3.85);
      const count = Math.max(2, Math.round(e.length / 6.5));
      for (let i = 0; i <= count; i++) {
        const d = (e.length * i) / count,
          x = e.a[0] + (e.dx * d) / e.length,
          z = e.a[1] + (e.dz * d) / e.length;
        add(
          "ivory",
          "box",
          [0.25, frameTop, 0.25],
          [x - e.nx * 3.8, frameTop / 2, z - e.nz * 3.8],
        );
        add(
          "frame",
          "box",
          [0.15, 0.18, 3.6],
          [x - e.nx * 2.1, frameTop, z - e.nz * 2.1],
          angle,
        );
      }
      if (index === 1)
        for (const y of datums.slice(1)) {
          wallBand(e, y, 0.2, "ivory", 2.0, -1.1);
          railing(e, y, -0.18);
        }
    }
    // Exposed white stair frame near the west end of the orange screen.
    const b = triangle[1],
      a = triangle[2],
      length = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ux = (a[0] - b[0]) / length,
      uz = (a[1] - b[1]) / length,
      nx = -uz,
      nz = ux;
    const point = (t, n, y) => [
      b[0] + ux * t + nx * n,
      y,
      b[1] + uz * t + nz * n,
    ];
    const stairAngle = Math.atan2(-uz, ux);
    for (const t of [5.5, 14.5])
      for (const n of [1.2, 4.6])
        add("ivory", "box", [0.32, 15.5, 0.32], point(t, n, 7.9));
    for (const y of [...datums, roofTop]) {
      for (const t of [6.2, 13.8])
        add("ivory", "box", [2.1, 0.18, 3.4], point(t, 2.9, y), stairAngle);
      for (const t of [5.5, 14.5])
        rod("ivory", point(t, 1.1, y), point(t, 4.7, y), 0.18);
    }
    for (let f = 0; f < 4; f++) {
      const base = datums[f],
        target = f === 3 ? roofTop : datums[f + 1],
        reverse = f % 2 === 1,
        n = reverse ? 3.75 : 2.05;
      for (let i = 0; i < 20; i++) {
        const t = reverse ? 13.6 - i * 0.36 : 6.4 + i * 0.36,
          y = base + ((target - base) * (i + 0.5)) / 20;
        add("ivory", "box", [0.38, 0.16, 1.5], point(t, n, y), stairAngle);
      }
      for (const dn of [-0.72, 0.72]) {
        const t0 = reverse ? 13.7 : 6.3,
          t1 = reverse ? 6.3 : 13.7;
        rod(
          "ivory",
          point(t0, n + dn, base - 0.05),
          point(t1, n + dn, target - 0.05),
          0.14,
        );
        rod(
          "metal",
          point(t0, n + dn, base + 1.0),
          point(t1, n + dn, target + 1.0),
          0.06,
        );
      }
    }
    // Lower southern roof has the angular/V-shaped white framing seen from above.
    for (const [x, z] of [
      [18, 5],
      [27, 14],
      [42, 3],
    ])
      add("ivory", "box", [0.3, 2.8, 0.3], [x, 12.6, z]);
    rod("ivory", [18, 14, 5], [27, 14, 14], 0.28);
    rod("ivory", [27, 14, 14], [42, 14, 3], 0.28);
    rod("ivory", [18, 14, 5], [42, 14, 3], 0.24);
    const canopy = [
      [20, 2],
      [26, 10],
      [43, 4],
      [37, 0],
    ];
    for (const [i, p] of canopy.entries()) {
      const q = canopy[(i + 1) % canopy.length];
      rod("frame", [p[0], 14.2, p[1]], [q[0], 14.2, q[1]], 0.22);
      add("ivory", "box", [0.22, 2.8, 0.22], [p[0], 12.8, p[1]]);
    }
    for (let i = 1; i < 6; i++) {
      const t = i / 6,
        p = canopy[0].map((v, j) => v + (canopy[3][j] - v) * t),
        q = canopy[1].map((v, j) => v + (canopy[2][j] - v) * t);
      rod("frame", [p[0], 14.2, p[1]], [q[0], 14.2, q[1]], 0.14);
    }
    // Small square rooftop plants/ducts; the supplied satellite view has no solar arrays.
    for (const [x, z] of [
      [29, -9],
      [42, -16],
      [52, -17],
    ]) {
      add("vent", "box", [2.2, 0.8, 1.4], [x, 15.25, z]);
      add("ivory", "box", [2.35, 0.16, 1.55], [x, 15.72, z]);
    }
    for (const [x, z] of [
      [37, -10],
      [47, -10],
    ])
      add("ivory", "box", [0.5, 1.35, 0.5], [x, 15.55, z]);
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
    modelVersion: "boya-cafeteria-v1-2026-11-13",
    placeId: place.id,
    levels,
    levelsSource: "owner_confirmed",
    heightAccuracy: "photo_visual_estimate_not_surveyed",
    imageCount: 0,
    textureCount: 0,
    stairsAreNavigationPaths: false,
  };
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
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
          "CampusOS procedural Boya cafeteria model; OSM footprint retained. Photos used internally only. Metric dimensions are display estimates.",
      }),
    );
  const file = `boya-cafeteria-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  assets[mode] = { file, sha256: hash(binary), bytes: binary.length, ...stats };
}
const referencePaths = [
  "C:/Users/zhuju/Downloads/二饭_被师苑遮挡.png",
  "C:/Users/zhuju/Downloads/二饭卫星图.png",
];
const references = await Promise.all(
  referencePaths.map(async (path) => ({
    path,
    sha256: hash(await readFile(path)),
    usage: "internal_visual_reference_only_no_pixels_published",
  })),
);
const manifest = {
  modelVersion: "boya-cafeteria-v1-2026-11-13",
  sourceMapVersion: campus.mapVersion,
  mapIntegrated: true,
  placeId: place.id,
  name: place.name,
  origin: place.coordinate,
  sourceGeometryWgs84: place.geometry,
  sourceFootprintSha256: hash(JSON.stringify(place.geometry)),
  sourceVertexCount: outer.length,
  levels,
  levelsSource: "Owner explicitly confirmed four storeys in this conversation.",
  heightAccuracy: "photo_visual_estimate_not_surveyed",
  mainRoofMeters: roofTop,
  roofFrameMeters: frameTop,
  alignedToLocal: { anchor, rotationYRadians: -axisAngle },
  alignedOuterMeters: outer,
  orientation:
    "North-pointing triangular main mass; orange screen across the southern near-east-west edge, parallel to the Shiyuan block in the reference; stepped projection and exposed stair frame to the south. View and metric details inferred from the supplied images.",
  assets,
  references,
  limitations: [
    "Four floors are owner-confirmed; floor heights, facade bays, roof frames and annex tiers are visual estimates.",
    "The foreground Shiyuan dormitory is contextual occlusion and is not part of this model.",
    "Open spaces between upper roof bands and stepped volumes are display geometry, not surveyed GIS courtyard holes.",
    "Exterior stairs are display-only, not verified navigation entrances or paths.",
    "2.5D is a plain white source volume. Existing GIS, roads and completed 3D models are preserved.",
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
      levels,
      datums,
      roofTop,
      frameTop,
      palette,
      core,
      triangle,
      annex,
      alignedToLocal: manifest.alignedToLocal,
      assets,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ name: place.name, levels, assets }, null, 2));
