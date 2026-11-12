// Fengcai Garden / Third Cafeteria: image-free procedural map model.
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
  CylinderGeometry,
  Box3,
  DoubleSide,
  QuadraticBezierCurve3,
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
const folder = "docs/model-previews/fengcai-cafeteria-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === "osm-way-313039057");
if (!place || place.name !== "风采园（三饭）")
  throw new Error("Fengcai cafeteria source missing");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const sourceLocal = place.geometry.slice(0, -1).map((c) => {
  const p = MercatorCoordinate.fromLngLat(c);
  return [(p.x - origin.x) / units, (p.y - origin.y) / units];
});
// Local X follows the east facade from north to south. +Z points into the building, westward.
const anchor = sourceLocal[1],
  axisAngle = Math.atan2(
    sourceLocal[3][1] - anchor[1],
    sourceLocal[3][0] - anchor[0],
  );
const co = Math.cos(axisAngle),
  si = Math.sin(axisAngle);
const outer = sourceLocal.map(([x, z]) => [
  (x - anchor[0]) * co + (z - anchor[1]) * si,
  -(x - anchor[0]) * si + (z - anchor[1]) * co,
]);
const levels = 3,
  datums = [0.3, 4.4, 8.5],
  roofTop = 13.0;
const palette = {
  ivory: "#e5e2d8",
  orange: "#c89579",
  glass: "#72878d",
  frame: "#656f71",
  metal: "#a9b2af",
  roof: "#d7d3c6",
  darkRoof: "#858279",
  vent: "#929a95",
  sign: "#d0aaa0",
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
  scene.name = `风采园（三饭）-${mode}`;
  root.position.set(anchor[0], 0, anchor[1]);
  root.rotation.y = -axisAngle;
  scene.add(root);
  const colors = mono ? { ivory: "#e8e5dc", roof: "#d5d2c8" } : palette;
  const mats = Object.fromEntries(
    Object.entries(colors).map(([name, color]) => {
      const m = new MeshStandardMaterial({
        color,
        roughness: name === "glass" ? 0.55 : 0.92,
        metalness: name === "metal" ? 0.14 : 0,
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
  function rod(mat, a, b, width = 0.06) {
    const start = new Vector3(...a),
      end = new Vector3(...b),
      d = end.clone().sub(start);
    matrix(
      mat,
      "box",
      new Matrix4().compose(
        start.add(end).multiplyScalar(0.5),
        new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          d.clone().normalize(),
        ),
        new Vector3(width, d.length(), width),
      ),
    );
  }
  function shape(name, mat, ring, base, height) {
    const m = new Mesh(extrude(ring, base, height), mats[mat]);
    m.name = name;
    root.add(m);
  }
  function band(e, y, h, mat, depth = 0.14, offset = 0) {
    add(
      mat,
      "box",
      [e.length, h, depth],
      [e.a[0] + e.dx / 2 + e.nx * offset, y, e.a[1] + e.dz / 2 + e.nz * offset],
      Math.atan2(e.nx, e.nz),
    );
  }
  if (mono) {
    shape("plain-white-source-volume", "ivory", outer, 0, roofTop);
    shape("light-roof-cap", "roof", outer, roofTop, 0.25);
  } else {
    shape("exact-source-ground-slab", "ivory", outer, 0.15, 0.2);
    shape(
      "recessed-ground-dining-volume",
      "ivory",
      inset(outer, 2.8),
      0.35,
      3.95,
    );
    shape(
      "orange-upper-dining-volume",
      "orange",
      inset(outer, 0.35),
      4.62,
      8.38,
    );
    for (const y of datums.slice(1))
      shape(`floor-${y}-slab`, "ivory", outer, y, 0.22);
    shape("main-flat-roof", "roof", outer, roofTop, 0.22);

    // East-facing front: two tall glazing bands over a recessed entrance and round columns.
    for (const y of [6.45, 10.55]) {
      add("glass", "plane", [38.5, 3.55, 1], [25, y, -0.04], Math.PI);
      for (let x = 6.1; x <= 44.4; x += 2.55)
        add("frame", "box", [0.085, 3.55, 0.075], [x, y, -0.09]);
      for (const h of [y - 1.72, y + 0.72, y + 1.72])
        add("frame", "box", [38.6, 0.065, 0.075], [25, h, -0.095]);
    }
    for (const y of [4.47, 8.58, 13.18])
      add("ivory", "box", [40.4, 0.26, 0.7], [25, y, -0.12]);
    add("glass", "plane", [38, 3.2, 1], [25, 2.1, 2.72], Math.PI);
    for (let x = 7; x < 44; x += 3.1)
      add("frame", "box", [0.075, 3.2, 0.075], [x, 2.1, 2.65]);
    add("ivory", "box", [40, 0.25, 3.4], [25, 4.42, 0.9]);
    for (const x of [16, 32])
      add("ivory", "column", [0.85, 4.15, 0.85], [x, 2.25, 0.15]);
    // A balcony with a central warm sign fascia; the normal map label carries the name.
    for (const y of [4.95, 5.3])
      add("metal", "box", [39, 0.055, 0.055], [25, y, -0.48]);
    for (let x = 6; x <= 44; x += 3.8)
      add("metal", "box", [0.05, 0.95, 0.05], [x, 4.95, -0.48]);
    add("sign", "box", [18, 0.95, 0.18], [25, 4.96, -0.63]);
    for (let i = 0; i < 5; i++)
      add(
        "ivory",
        "box",
        [38, 0.16, 0.55],
        [25, 0.1 + i * 0.16, -2.75 + i * 0.55],
      );

    const all = edges(outer);
    for (const [i, e] of all.entries()) {
      if (i === 1 || i === 2) continue;
      const angle = Math.atan2(e.nx, e.nz),
        bays = Math.max(1, Math.round(e.length / 5));
      for (let k = 0; k < bays; k++)
        for (const y of [2.15, 6.35, 10.45]) {
          const d = (e.length * (k + 0.5)) / bays,
            offset = y < 4 ? -2.72 : -0.25;
          add(
            "glass",
            "plane",
            [Math.max(0.5, e.length / bays - 0.55), 1.2, 1],
            [
              e.a[0] + (e.dx * d) / e.length + e.nx * offset,
              y,
              e.a[1] + (e.dz * d) / e.length + e.nz * offset,
            ],
            angle,
          );
        }
      band(e, 13.48, 0.5, "ivory", 0.14, -0.06);
    }
    // Silver-white stair tower at the south end of the eastern entrance facade.
    add("ivory", "box", [4.8, 12.9, 6.6], [47, 6.65, 3.1]);
    add("glass", "plane", [1.35, 9.2, 1], [47, 6.6, -0.245], Math.PI);
    for (const x of [44.9, 49.1])
      for (const z of [-0.1, 6.3])
        add("ivory", "box", [0.58, 3.2, 0.58], [x, 14.65, z]);
    add("ivory", "box", [4.8, 0.5, 7.0], [47, 16.4, 3.1]);
    for (const z of [2.1, 4.4])
      add("ivory", "box", [0.85, 1.55, 1.45], [47, 17.4, z]);
    for (let y = 1.25; y < 12.9; y += 1.4)
      add("darkRoof", "plane", [4.8, 0.025, 1], [47, y, -0.25], Math.PI);

    // Southwest side roof: a long raised service strip and narrow open pergola.
    const south = all[3],
      angle = Math.atan2(south.nx, south.nz);
    band(south, 13.85, 1.05, "ivory", 4.8, -7.0);
    band(south, 14.42, 0.16, "darkRoof", 4.9, -7.0);
    band(south, 13.48, 0.16, "darkRoof", 3.0, -2.2);
    for (const offset of [-0.8, -3.7])
      band(south, 14.5, 0.15, "ivory", 0.14, offset);
    for (let d = 2; d < south.length - 1; d += 2.6) {
      const x = south.a[0] + (south.dx * d) / south.length,
        z = south.a[1] + (south.dz * d) / south.length;
      add(
        "ivory",
        "box",
        [0.18, 0.16, 3.0],
        [x - south.nx * 2.2, 14.5, z - south.nz * 2.2],
        angle,
      );
      if (Math.floor(d / 2.6) % 3 === 0)
        for (const offset of [-0.8, -3.7])
          add(
            "ivory",
            "box",
            [0.16, 1.0, 0.16],
            [x + south.nx * offset, 14, z + south.nz * offset],
          );
    }
    // Curved western roof rim sits within the retained coarse GIS boundary.
    const curve = new QuadraticBezierCurve3(
      new Vector3(38, 0, 51),
      new Vector3(38, 0, 61),
      new Vector3(26, 0, 59),
    );
    const path = curve.getPoints(12);
    path.push(new Vector3(13, 0, 57.2));
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i],
        b = path[i + 1],
        d = b.clone().sub(a).normalize(),
        n = new Vector3(-d.z, 0, d.x);
      for (const offset of [-0.65, 0.65]) {
        const p = a.clone().addScaledVector(n, offset),
          q = b.clone().addScaledVector(n, offset);
        rod("ivory", [p.x, 14.25, p.z], [q.x, 14.25, q.z], 0.12);
        add("ivory", "box", [0.14, 0.82, 0.14], [p.x, 13.85, p.z]);
      }
      rod(
        "ivory",
        [a.x - n.x * 0.85, 14.25, a.z - n.z * 0.85],
        [a.x + n.x * 0.85, 14.25, a.z + n.z * 0.85],
        0.1,
      );
    }
    // Main roof joints and a few ducts, estimated from the satellite reference; no solar panels.
    for (const z of [8, 18, 28, 38]) {
      const intersections = [];
      for (const e of all)
        if (e.a[1] > z !== e.b[1] > z)
          intersections.push(
            e.a[0] + ((e.b[0] - e.a[0]) * (z - e.a[1])) / (e.b[1] - e.a[1]),
          );
      intersections.sort((a, b) => a - b);
      const lo = intersections[0] + 2,
        hi = intersections.at(-1) - 2;
      add(
        "darkRoof",
        "box",
        [hi - lo, 0.013, 0.04],
        [(hi + lo) / 2, 13.227, z],
      );
    }
    for (const [x, z] of [
      [24, 43],
      [31, 38],
      [36, 29],
    ]) {
      add("vent", "box", [2.5, 0.8, 1.45], [x, 13.65, z]);
      add("ivory", "box", [2.65, 0.15, 1.6], [x, 14.13, z]);
    }
  }
  for (const [key, matrices] of buckets) {
    const [mat, type] = key.split(":"),
      geometry =
        type === "plane"
          ? new PlaneGeometry(1, 1)
          : type === "column"
            ? new CylinderGeometry(0.5, 0.5, 1, 10)
            : new BoxGeometry(1, 1, 1);
    const mesh = new InstancedMesh(geometry, mats[mat], matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = key;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  scene.userData = {
    modelVersion: "fengcai-cafeteria-v1-2026-11-13",
    placeId: place.id,
    levels,
    levelsSource: "owner_confirmed",
    heightAccuracy: "photo_visual_estimate_not_surveyed",
    imageCount: 0,
    textureCount: 0,
    stairsAreNavigationPaths: false,
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
          "CampusOS procedural Fengcai cafeteria model; OSM footprint retained. Photos used internally only; metric dimensions are display estimates.",
      }),
    );
  const file = `fengcai-cafeteria-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  assets[mode] = { file, sha256: hash(binary), bytes: binary.length, ...stats };
}
const referencePaths = [
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/三饭正面.png",
  "C:/Users/zhuju/Downloads/三饭卫星图.png",
];
const references = await Promise.all(
  referencePaths.map(async (path) => ({
    path,
    sha256: hash(await readFile(path)),
    usage: "internal_visual_reference_only_no_pixels_published",
  })),
);
const manifest = {
  modelVersion: "fengcai-cafeteria-v1-2026-11-13",
  sourceMapVersion: campus.mapVersion,
  mapIntegrated: true,
  placeId: place.id,
  name: place.name,
  origin: place.coordinate,
  sourceGeometryWgs84: place.geometry,
  sourceFootprintSha256: hash(JSON.stringify(place.geometry)),
  sourceVertexCount: outer.length,
  levels,
  levelsSource:
    "Owner explicitly confirmed three storeys in this conversation.",
  heightAccuracy: "photo_visual_estimate_not_surveyed",
  mainRoofMeters: roofTop,
  towerTopMeters: 18.175,
  alignedToLocal: { anchor, rotationYRadians: -axisAngle },
  alignedOuterMeters: outer,
  orientation:
    "East-facing glazed entrance and white columns; silver-white tower at the south end of that facade; curved end to the west. Roof subdivision inferred from supplied images.",
  assets,
  references,
  limitations: [
    "Three floors are owner-confirmed; metric heights, window pitch, roof frames and devices remain visual estimates.",
    "The western curve is a roof detail; source GIS outer ring remains unchanged in the model foundation and 2.5D volume.",
    "Entrance steps are display geometry, not verified GIS entrances or walking paths.",
    "2.5D is a plain white source volume; glazing, equipment and roof frames are 3D-only.",
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
      palette,
      alignedToLocal: manifest.alignedToLocal,
      alignedOuterMeters: outer,
      assets,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ name: place.name, levels, assets }, null, 2));
