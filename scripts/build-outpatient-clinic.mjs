// Campus outpatient clinic: self-authored procedural geometry without image textures.
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
const folder = "docs/model-previews/outpatient-clinic-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === "osm-way-313039046");
if (!place || place.name !== "门诊部")
  throw new Error("Outpatient clinic source missing");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const origin = MercatorCoordinate.fromLngLat(place.coordinate),
  units = origin.meterInMercatorCoordinateUnits();
const sourceLocal = place.geometry.slice(0, -1).map((c) => {
  const p = MercatorCoordinate.fromLngLat(c);
  return [(p.x - origin.x) / units, (p.y - origin.y) / units];
});
// Long rear edge northwest -> southeast; +Z faces the folded south/southwest frontage.
const anchor = sourceLocal[0],
  axisAngle = Math.atan2(
    sourceLocal[1][1] - anchor[1],
    sourceLocal[1][0] - anchor[0],
  );
const co = Math.cos(axisAngle),
  si = Math.sin(axisAngle);
const outer = sourceLocal.map(([x, z]) => [
  (x - anchor[0]) * co + (z - anchor[1]) * si,
  -(x - anchor[0]) * si + (z - anchor[1]) * co,
]);
const levels = 3,
  datums = [0.3, 3.9, 7.5],
  roofTop = 11.15;
const palette = {
  ivory: "#e5e4de",
  red: "#bc6059",
  glass: "#70868a",
  backGlass: "#b0bfc0",
  spandrel: "#a9c7c2",
  metal: "#c2c9c5",
  roof: "#d9d7cc",
  darkRoof: "#7b7f7a",
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
function inside([x, z]) {
  let hit = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const a = outer[i],
      b = outer[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
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
  root.position.set(anchor[0], 0, anchor[1]);
  root.rotation.y = -axisAngle;
  scene.add(root);
  scene.name = `门诊部-${mode}`;
  const colors = mono ? { ivory: "#e8e5dc", roof: "#d5d2c8" } : palette;
  const mats = Object.fromEntries(
    Object.entries(colors).map(([name, color]) => {
      const m = new MeshStandardMaterial({
        color,
        roughness: name.toLowerCase().includes("glass") ? 0.58 : 0.92,
        metalness: name === "metal" ? 0.15 : 0,
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
  function shape(name, mat, ring, base, height) {
    const mesh = new Mesh(extrude(ring, base, height), mats[mat]);
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
  const all = edges(outer);
  if (mono) {
    shape("plain-white-source-volume", "ivory", outer, 0, roofTop);
    shape("light-roof-cap", "roof", outer, roofTop, 0.25);
  } else {
    shape("exact-source-ground-slab", "ivory", outer, 0.15, 0.18);
    shape(
      "three-storey-clinical-volume",
      "ivory",
      inset(outer, 0.48),
      0.33,
      10.82,
    );
    for (const y of datums.slice(1))
      shape(`floor-${y}-slab`, "ivory", outer, y, 0.18);
    shape("flat-clinic-roof", "roof", outer, roofTop, 0.18);
    // Three segments of the folded frontage follow the source, rather than a rectangular facade.
    for (const i of [1, 2, 3]) {
      const e = all[i],
        angle = Math.atan2(e.nx, e.nz),
        bays = Math.max(2, Math.round(e.length / 3.25));
      for (let k = 0; k <= bays; k++)
        add(
          "ivory",
          "box",
          [0.43, 10.8, 0.56],
          at(e, (e.length * k) / bays, 5.7, 0.04),
          angle,
        );
      for (let k = 0; k < bays; k++) {
        const d = (e.length * (k + 0.5)) / bays,
          width = Math.max(0.8, e.length / bays - 0.55);
        for (const y of [1.95, 5.55, 9.15]) {
          const p = at(e, d, y, -0.38);
          add("glass", "plane", [Math.min(1.9, width), 2.45, 1], p, angle);
          add("metal", "plane", [0.045, 2.45, 1], at(e, d, y, -0.36), angle);
        }
        for (const y of [3.42, 7.02])
          add("spandrel", "plane", [width, 0.52, 1], at(e, d, y, -0.35), angle);
      }
      for (const y of [0.45, 3.98, 7.58]) band(e, y, 0.17, "ivory", 0.28, 0.06);
      band(e, 11.4, 0.55, "ivory", 0.72, 0.06);
    }
    // Red rear and west return walls, with narrow horizontal window bands.
    for (const i of [0, 4]) {
      const e = all[i],
        angle = Math.atan2(e.nx, e.nz),
        bays = Math.max(2, Math.round(e.length / 5.7));
      band(e, 6.1, 11.55, "red", 0.46, 0.06);
      for (let k = 0; k < bays; k++)
        for (const y of [2.15, 5.75, 9.35]) {
          const d = (e.length * (k + 0.5)) / bays;
          add(
            "backGlass",
            "plane",
            [Math.max(0.8, e.length / bays - 0.7), 1.15, 1],
            at(e, d, y, 0.41),
            angle,
          );
        }
    }
    // Horizontal metal screen is a facade feature, not another building.
    const west = all[4],
      westAngle = Math.atan2(west.nx, west.nz),
      screenWidth = 17;
    add(
      "glass",
      "plane",
      [screenWidth, 7.3, 1],
      at(west, west.length * 0.42, 6.8, 0.42),
      westAngle,
    );
    for (let i = 0; i < 12; i++)
      add(
        "metal",
        "box",
        [screenWidth, 0.12, 0.19],
        at(west, west.length * 0.42, 3.3 + i * 0.63, 0.49),
        westAngle,
      );
    for (const d of [-screenWidth / 2, screenWidth / 2])
      add(
        "red",
        "box",
        [0.55, 8.3, 0.46],
        at(west, west.length * 0.42 + d, 6.9, 0.27),
        westAngle,
      );
    for (const e of all) band(e, 11.65, 0.5, "ivory", 0.14, -0.1);

    // White rooftop access/plant box with its dark inset flat roof.
    add("ivory", "box", [9.0, 2.8, 7.2], [31, 12.75, 6.2]);
    add("darkRoof", "box", [8.5, 0.13, 6.7], [31, 14.23, 6.2]);
    for (const y of [11.8, 12.6, 13.4])
      add("metal", "plane", [9, 0.028, 1], [31, y, 2.58], Math.PI);
    for (let x = 27.5; x < 35; x += 1.7)
      add("metal", "plane", [0.025, 2.7, 1], [x, 12.75, 2.58], Math.PI);

    // Small entrance canopy on the middle recessed segment of the frontage.
    const entrance = all[2],
      entranceAngle = Math.atan2(entrance.nx, entrance.nz);
    add(
      "glass",
      "plane",
      [5.2, 2.4, 1],
      at(entrance, entrance.length / 2, 1.65, -0.3),
      entranceAngle,
    );
    add(
      "ivory",
      "box",
      [8, 0.22, 2.4],
      at(entrance, entrance.length / 2, 3.15, 0.9),
      entranceAngle,
    );
    for (const d of [-3.6, 3.6])
      add(
        "ivory",
        "column",
        [0.24, 2.8, 0.24],
        at(entrance, entrance.length / 2 + d, 1.65, 1.8),
      );
    for (let i = 0; i < 3; i++)
      add(
        "ivory",
        "box",
        [7.8, 0.16, 0.45],
        at(entrance, entrance.length / 2, 0.1 + i * 0.16, 2.6 - i * 0.45),
        entranceAngle,
      );

    // Geometry-only roof joints and a few plant units visible from above.
    for (const z of [4, 9, 14, 19]) {
      const hits = [];
      for (const e of all)
        if (e.a[1] > z !== e.b[1] > z)
          hits.push(
            e.a[0] + ((e.b[0] - e.a[0]) * (z - e.a[1])) / (e.b[1] - e.a[1]),
          );
      hits.sort((a, b) => a - b);
      const lo = hits[0] + 1,
        hi = hits.at(-1) - 1;
      if (hi > lo)
        add(
          "darkRoof",
          "box",
          [hi - lo, 0.012, 0.035],
          [(hi + lo) / 2, 11.337, z],
        );
    }
    for (const [x, z] of [
      [15, 5],
      [44, 5],
      [56, 3],
      [29, 17],
    ]) {
      if (
        ![
          [x - 1, z - 0.7],
          [x + 1, z - 0.7],
          [x + 1, z + 0.7],
          [x - 1, z + 0.7],
        ].every(inside)
      )
        continue;
      add("metal", "box", [2, 0.65, 1.4], [x, 11.7, z]);
      add("ivory", "box", [2.1, 0.12, 1.5], [x, 12.08, z]);
    }
  }
  for (const [key, matrices] of buckets) {
    const [mat, type] = key.split(":"),
      geometry =
        type === "plane"
          ? new PlaneGeometry(1, 1)
          : type === "column"
            ? new CylinderGeometry(0.5, 0.5, 1, 8)
            : new BoxGeometry(1, 1, 1);
    const mesh = new InstancedMesh(geometry, mats[mat], matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = key;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  scene.userData = {
    modelVersion: "outpatient-clinic-v1-2026-11-13",
    placeId: place.id,
    levels,
    levelsSource: "owner_confirmed",
    heightAccuracy: "photo_visual_estimate_not_surveyed",
    imageCount: 0,
    textureCount: 0,
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
          "CampusOS procedural outpatient clinic model; OSM footprint retained. No reference images or textures published; metric dimensions are visual estimates.",
      }),
    );
  const file = `outpatient-clinic-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  assets[mode] = { file, sha256: hash(binary), bytes: binary.length, ...stats };
}
const paths = [
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/门诊部.png",
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/门诊部23.jpg",
  "C:/Users/zhuju/Downloads/门诊部卫星图.png",
];
const references = await Promise.all(
  paths.map(async (path) => ({
    path,
    sha256: hash(await readFile(path)),
    usage: "internal_visual_reference_only_no_pixels_published",
  })),
);
const manifest = {
  modelVersion: "outpatient-clinic-v1-2026-11-13",
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
  rooftopPlantTopMeters: 14.295,
  alignedToLocal: { anchor, rotationYRadians: -axisAngle },
  alignedOuterMeters: outer,
  orientation:
    "Folded south/southwest-facing white frontage; long red rear wall follows northwest-southeast axis, with a west return/louver screen. Display details inferred from supplied images.",
  assets,
  references,
  limitations: [
    "Three floors are owner-confirmed; all metric heights, window spacing, roof units and screen dimensions remain visual estimates.",
    "The rooftop plant/access box is not an additional full building storey.",
    "No GIS entrance, courtyard, path, indoor floor plan or clinical service data is inferred from this visual model.",
    "2.5D is a plain white source volume; facade and roof details are 3D-only.",
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
