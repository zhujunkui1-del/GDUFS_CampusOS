// Wencai Garden / First Cafeteria: image-free procedural campus model.
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

const folder = "docs/model-previews/wencai-cafeteria-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((p) => p.id === "osm-way-313039048");
if (!place || place.name !== "文采园（一饭）")
  throw new Error("Wencai place missing");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const units = origin.meterInMercatorCoordinateUnits();
const sourceLocal = place.geometry.slice(0, -1).map((coordinate) => {
  const q = MercatorCoordinate.fromLngLat(coordinate);
  return [(q.x - origin.x) / units, (q.y - origin.y) / units];
});
// The long northeast roof edge runs northwest -> southeast. +Z faces the southwest road.
const anchor = sourceLocal[2];
const axisAngle = Math.atan2(
  sourceLocal[3][1] - anchor[1],
  sourceLocal[3][0] - anchor[0],
);
const cos = Math.cos(axisAngle),
  sin = Math.sin(axisAngle);
const outer = sourceLocal.map(([x, z]) => [
  (x - anchor[0]) * cos + (z - anchor[1]) * sin,
  -(x - anchor[0]) * sin + (z - anchor[1]) * cos,
]);
const levels = 3,
  floorDatums = [0.28, 4.4, 8.5],
  roofTop = 13.25;
const palette = {
  ivory: "#e6e3da",
  orange: "#c99574",
  brick: "#bf7a60",
  glass: "#648089",
  metal: "#9ba5a2",
  roof: "#dad8cf",
  solar: "#405966",
  solarGrid: "#9aaeb1",
  vent: "#818986",
  teal: "#6799a6",
};
const area = (r) =>
  r.reduce((s, a, i) => {
    const b = r[(i + 1) % r.length];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
function edges(ring) {
  const sign = Math.sign(area(ring));
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    return {
      a,
      dx,
      dz,
      length,
      nx: (sign * dz) / length,
      nz: (-sign * dx) / length,
    };
  });
}
function inset(ring, amount) {
  const all = edges(ring),
    cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  return ring.map((p, i) => {
    const a = all[(i + all.length - 1) % all.length],
      b = all[i];
    const p1 = [p[0] - a.nx * amount, p[1] - a.nz * amount],
      p2 = [p[0] - b.nx * amount, p[1] - b.nz * amount];
    const den = cross([a.dx, a.dz], [b.dx, b.dz]);
    if (Math.abs(den) < 1e-7) return p1;
    const t = cross([p2[0] - p1[0], p2[1] - p1[1]], [b.dx, b.dz]) / den;
    return [p1[0] + a.dx * t, p1[1] + a.dz * t];
  });
}
function inside([x, z], ring = outer) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
function extrude(ring, base, height) {
  const geometry = new ExtrudeGeometry(
    new Shape(ring.map(([x, z]) => new Vector2(x, -z))),
    { depth: height, steps: 1, bevelEnabled: false, curveSegments: 1 },
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  return geometry;
}
function makeModel(mode) {
  const mono = mode === "2.5d",
    scene = new Scene(),
    root = new Group();
  root.position.set(anchor[0], 0, anchor[1]);
  root.rotation.y = -axisAngle;
  scene.add(root);
  scene.name = `文采园（一饭）-${mode}`;
  const colors = mono ? { ivory: "#e8e5dc", roof: "#d5d2c8" } : palette;
  const mats = Object.fromEntries(
    Object.entries(colors).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: name === "glass" || name === "solar" ? 0.55 : 0.91,
        metalness: name === "metal" ? 0.16 : 0,
        side: DoubleSide,
      });
      material.name = name;
      return [name, material];
    }),
  );
  const buckets = new Map();
  const add = (material, type, size, position, angle = 0) => {
    const key = `${material}:${type}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets
      .get(key)
      .push(
        new Matrix4().compose(
          new Vector3(...position),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
          new Vector3(...size),
        ),
      );
  };
  const rod = (material, a, b, width = 0.06) => {
    const start = new Vector3(...a),
      end = new Vector3(...b),
      d = end.clone().sub(start),
      key = `${material}:box`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets
      .get(key)
      .push(
        new Matrix4().compose(
          start.add(end).multiplyScalar(0.5),
          new Quaternion().setFromUnitVectors(
            new Vector3(0, 1, 0),
            d.clone().normalize(),
          ),
          new Vector3(width, d.length(), width),
        ),
      );
  };
  const shape = (name, material, ring, base, height) => {
    const mesh = new Mesh(extrude(ring, base, height), mats[material]);
    mesh.name = name;
    root.add(mesh);
  };
  if (mono) {
    shape("plain-white-source-volume", "ivory", outer, 0, roofTop);
    shape("light-flat-roof-cap", "roof", outer, roofTop, 0.25);
  } else {
    const core = inset(outer, 2.7),
      topRing = inset(outer, 0.35);
    shape("recessed-lower-dining-volume", "ivory", core, 0.3, 8.0);
    for (const y of floorDatums)
      shape(`floor-${y}-slab`, "ivory", outer, y, 0.23);
    shape("orange-third-storey", "orange", topRing, 8.72, 4.53);
    shape("flat-light-roof", "roof", outer, roofTop, 0.22);

    for (const e of edges(outer)) {
      const angle = Math.atan2(e.nx, e.nz),
        at = (d, y, offset = 0) => [
          e.a[0] + (e.dx * d) / e.length + e.nx * offset,
          y,
          e.a[1] + (e.dz * d) / e.length + e.nz * offset,
        ];
      const front = e.nz > 0.5 || e.nx < -0.7;
      const bays = Math.max(2, Math.round(e.length / 4.8));
      // Continuous orange upper storey with a horizontal band of glazing.
      for (let bay = 0; bay < bays; bay++) {
        const d = (e.length * (bay + 0.5)) / bays;
        add(
          "glass",
          "plane",
          [Math.min(3.7, e.length / bays - 0.45), 1.3, 1],
          at(d, 11.2, -0.27),
          angle,
        );
        if (!front)
          for (const y of [2.45, 6.5])
            add(
              "glass",
              "plane",
              [Math.min(3.5, e.length / bays - 0.5), 1.6, 1],
              at(d, y, -2.59),
              angle,
            );
      }
      if (front) {
        const columns = Math.max(2, Math.round(e.length / 9));
        for (let k = 0; k <= columns; k++)
          add(
            "ivory",
            "column",
            [0.55, 8.25, 0.55],
            at((e.length * k) / columns, 4.4, -0.25),
          );
        for (const y of [5.05, 5.4])
          add(
            "metal",
            "box",
            [e.length, 0.055, 0.055],
            at(e.length / 2, y, -0.1),
            angle,
          );
        for (let d = 0.8; d < e.length; d += 4)
          add("metal", "box", [0.05, 0.95, 0.05], at(d, 4.95, -0.1), angle);
        for (const y of [2.2, 6.3])
          add(
            "glass",
            "plane",
            [e.length - 1, 2.55, 1],
            at(e.length / 2, y, -2.6),
            angle,
          );
      }
      // Thin roof parapet remains distinct from the orange facade.
      add(
        "ivory",
        "box",
        [e.length, 0.53, 0.18],
        at(e.length / 2, 13.72, -0.08),
        angle,
      );
      if (!front && e.length > 20) {
        for (let d = 4; d < e.length - 1; d += 15)
          add("brick", "box", [2.0, 12.4, 0.2], at(d, 6.6, 0.05), angle);
      }
    }

    // Southwest external stair: a broad flight rises from the plaza to the open second-floor gallery.
    const frontZ = (x) =>
      x < 48.9 ? 37.4658 + (x * (50.1232 - 37.4658)) / 48.9034 : 50.124;
    for (let step = 0; step < 18; step++) {
      const x = 26 + step * 0.72;
      add(
        "ivory",
        "box",
        [0.74, 0.23, 2.2],
        [x, 0.42 + step * 0.23, frontZ(x) + 0.9],
      );
    }
    add("ivory", "box", [3, 0.2, 3.3], [40, 4.55, frontZ(40) + 0.35]);
    add("teal", "box", [3.2, 0.08, 3.5], [40, 4.4, frontZ(40) + 0.35]);
    for (const dz of [-0.95, 0.95]) {
      rod(
        "metal",
        [26, 1.45, frontZ(26) + 0.9 + dz],
        [39, 5.55, frontZ(39) + 0.9 + dz],
      );
      for (let k = 0; k <= 5; k++) {
        const x = 26 + k * 2.6,
          y = 1.45 + k * 0.82;
        add(
          "metal",
          "box",
          [0.05, 0.95, 0.05],
          [x, y - 0.45, frontZ(x) + 0.9 + dz],
        );
      }
    }
    // Raised link visible in the satellite view, southwest of the southeast end.
    for (const y of [4.4, 8.5]) {
      add("ivory", "box", [4.1, 0.24, 14], [68, y, 57]);
      for (const dx of [-2, 2]) {
        for (const ry of [y + 0.65, y + 1.0])
          add("metal", "box", [0.055, 0.055, 14], [68 + dx, ry, 57]);
        for (let z = 51; z <= 63; z += 3)
          add("metal", "box", [0.055, 0.95, 0.055], [68 + dx, y + 0.55, z]);
      }
    }
    for (const x of [66.3, 69.7])
      add("ivory", "column", [0.45, 8.5, 0.45], [x, 4.25, 62.5]);
    for (let step = 0; step < 4; step++)
      add(
        "ivory",
        "box",
        [27.5, 0.16, 0.5],
        [64.5, 0.12 + step * 0.16, 52.1 - step * 0.5],
      );

    // Satellite-informed rooftop arrays are schematic geometry, not a photographed texture.
    const arrays = [];
    for (const x of [6, 24, 42, 60])
      for (const z of [7, 20, 33]) {
        const ring = [
          [x, z],
          [x + 13.5, z],
          [x + 13.5, z + 8],
          [x, z + 8],
        ];
        if (!ring.every((p) => inside(p, inset(outer, 2)))) continue;
        arrays.push({ x, z });
        add("solar", "box", [13.5, 0.09, 8], [x + 6.75, 13.66, z + 4]);
        for (let k = 1; k <= 4; k++)
          add(
            "solarGrid",
            "box",
            [0.035, 0.012, 8],
            [x + k * 2.7, 13.713, z + 4],
          );
        for (const dz of [2, 4, 6])
          add(
            "solarGrid",
            "box",
            [13.5, 0.012, 0.035],
            [x + 6.75, 13.713, z + dz],
          );
      }
    for (const x of [11, 27, 43, 59, 73]) {
      add("ivory", "box", [3.6, 1.0, 2.1], [x, 13.95, 3.4]);
      add("vent", "column", [0.65, 1.25, 0.65], [x + 0.7, 15.0, 3.4]);
      add("brick", "box", [1.1, 0.38, 1.3], [x - 0.7, 14.7, 3.4]);
    }
    root.userData.solarArrayCountIsIllustrative = arrays.length;
  }
  for (const [key, matrices] of buckets) {
    const [material, type] = key.split(":");
    const geometry =
      type === "plane"
        ? new PlaneGeometry(1, 1)
        : type === "column"
          ? new CylinderGeometry(0.5, 0.5, 1, 8)
          : new BoxGeometry(1, 1, 1);
    const mesh = new InstancedMesh(geometry, mats[material], matrices.length);
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.name = key;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  scene.userData = {
    modelVersion: "wencai-cafeteria-v1-2026-11-13",
    placeId: place.id,
    levels,
    heightAccuracy: "photo_visual_estimate_not_surveyed",
    bridgesAreNavigationPaths: false,
    imageCount: 0,
    textureCount: 0,
  };
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
  let triangles = 0,
    drawCalls = 0;
  scene.traverse((n) => {
    if (!n.isMesh) return;
    triangles +=
      ((n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3) *
      (n.isInstancedMesh ? n.count : 1);
    drawCalls++;
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
  const { scene, stats } = makeModel(mode);
  const binary = Buffer.from(
    await new GLTFExporter().parseAsync(scene, {
      binary: true,
      trs: false,
      copyright:
        "CampusOS procedural Wencai cafeteria model; OSM footprint retained; photograph-derived dimensions are display estimates. No source photos or textures.",
    }),
  );
  const file = `wencai-cafeteria-${mode}.glb`;
  await writeFile(`${folder}/${file}`, binary);
  assets[mode] = { file, sha256: hash(binary), bytes: binary.length, ...stats };
}
const references = [
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/一饭背面09.png",
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/文采园一饭侧面.png",
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/一饭正面20.png",
  "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/一饭左面093.png",
  "C:/Users/zhuju/Downloads/一饭卫星图.png",
];
const manifest = {
  modelVersion: "wencai-cafeteria-v1-2026-11-13",
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
    "Three visible storeys inferred from supplied facade photos; not a surveyed GIS tag.",
  heightAccuracy: "photo_visual_estimate_not_surveyed",
  mainRoofMeters: roofTop,
  parapetMeters: 13.99,
  alignedToLocal: { anchor, rotationYRadians: -axisAngle },
  alignedOuterMeters: outer,
  orientation:
    "Long axis northwest-southeast; open colonnade/stair and bridge face southwest, kitchen rear faces northeast.",
  assets,
  references: references.map((path) => ({
    path,
    usage: "internal_visual_reference_only_no_pixels_published",
  })),
  limitations: [
    "Roof panels, vents, window/bay pitch and heights are schematic visual estimates.",
    "External stair and two-level link are display-only geometry, not verified walking routes.",
    "Outer footprint and existing canteen place ID stay exact; no courtyard/entrance/path is added to GIS.",
    "2.5D is a plain white mass; facade and rooftop detail belong to 3D.",
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
      floorDatums,
      roofTopMeters: roofTop,
      palette,
      alignedToLocal: manifest.alignedToLocal,
      alignedOuterMeters: outer,
      assets,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    { name: place.name, placeId: place.id, levels, assets },
    null,
    2,
  ),
);
