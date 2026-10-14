// Explicit, offline asset preparation. Never runs during startup or production build.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
  Shape,
  Path,
  ExtrudeGeometry,
  BoxGeometry,
  PlaneGeometry,
  Mesh,
  MeshStandardMaterial,
  InstancedMesh,
  Matrix4,
  Vector3,
  Quaternion,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// GLTFExporter uses the browser FileReader API even for texture-free binary export.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const review = await readJson(
  "src/features/campus-map/data/owner-model-review.json",
);
const campus = await readJson("src/features/campus-map/data/campus.json");
const mapManifest = await readJson(
  "src/features/campus-map/data/local-map-manifest.json",
);
const place = campus.places.find((p) => p.id === review.placeId);
if (
  !place?.geometry ||
  review.mapVersion !== mapManifest.version ||
  campus.mapVersion !== mapManifest.version
)
  throw new Error(
    "Pilot footprint or map version mismatch. Review before regenerating assets.",
  );
const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const unit = origin.meterInMercatorCoordinateUnits();
// Model axis: X east, Y up, Z south; glTF is Y-up.
const exterior = place.geometry.slice(0, -1).map((p) => {
  const m = MercatorCoordinate.fromLngLat(p);
  return [(m.x - origin.x) / unit, (m.y - origin.y) / unit];
});
const minX = Math.min(...exterior.map((p) => p[0])),
  maxX = Math.max(...exterior.map((p) => p[0]));
const minZ = Math.min(...exterior.map((p) => p[1])),
  maxZ = Math.max(...exterior.map((p) => p[1]));
const width = maxX - minX,
  depth = maxZ - minZ;
const courtWidth = width * review.courtyard.widthRatio,
  courtDepth = depth * review.courtyard.depthRatio;
const courtX = minX + width * review.courtyard.centerRatio[0];
const courtZ = minZ + depth * review.courtyard.centerRatio[1];
const courtyard = [
  [courtX - courtWidth / 2, courtZ - courtDepth / 2],
  [courtX + courtWidth / 2, courtZ - courtDepth / 2],
  [courtX + courtWidth / 2, courtZ + courtDepth / 2],
  [courtX - courtWidth / 2, courtZ + courtDepth / 2],
];
function toWgs84([x, z]) {
  const p = new MercatorCoordinate(
    origin.x + x * unit,
    origin.y + z * unit,
  ).toLngLat();
  return [p.lng, p.lat];
}
const close = (ring) => [...ring, ring[0]];
const volumeCoordinates = [place.geometry, close(courtyard.map(toWgs84))];

function shapeFromRings() {
  const shape = new Shape(exterior.map(([x, z]) => new Vector3(x, -z, 0)));
  shape.holes.push(new Path(courtyard.map(([x, z]) => new Vector3(x, -z, 0))));
  return shape;
}
function buildScene(lod) {
  const scene = new Scene();
  scene.name = "南苑7栋";
  scene.userData = {
    placeId: place.id,
    levels: review.levels,
    heightAccuracy: review.heightAccuracy,
    appearanceAccuracy: review.appearanceAccuracy,
  };
  const palette = {
    wall: "#e6ddca",
    roof: "#dddaca",
    trim: "#f1ebdf",
    glass: "#54727d",
    recess: "#82796a",
    roofStrip: "#879092",
    frame: "#d5d1c5",
  };
  const materials = Object.fromEntries(
    Object.entries(palette).map(([name, color]) => {
      const m = new MeshStandardMaterial({
        color,
        roughness: name === "glass" ? 0.5 : 0.88,
        metalness: name === "glass" ? 0.08 : 0,
      });
      m.name = name;
      return [name, m];
    }),
  );
  const instances = new Map();
  const addInstance = (material, type, dimensions, position, angle = 0) => {
    const key = material + ":" + type;
    if (!instances.has(key)) instances.set(key, []);
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      angle,
    );
    instances
      .get(key)
      .push(
        new Matrix4().compose(
          new Vector3(...position),
          rotation,
          new Vector3(...dimensions),
        ),
      );
  };
  const extrude = (base, height, material) => {
    const geometry = new ExtrudeGeometry(shapeFromRings(), {
      depth: height,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, base, 0);
    const mesh = new Mesh(geometry, materials[material]);
    mesh.name = material;
    scene.add(mesh);
  };
  const roofBase = review.heightMeters - 0.6;
  extrude(0, roofBase, "wall");
  extrude(roofBase, 0.16, "roof");
  const floorHeight = review.heightMeters / review.levels;
  function decorate(ring, inner) {
    const area = ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 0.1) return;
      const normalSign = (area > 0 ? 1 : -1) * (inner ? -1 : 1);
      const nx = (dz / length) * normalSign,
        nz = (-dx / length) * normalSign;
      const angle = Math.atan2(nx, nz);
      // Parapets remain within the owner's approximate total 21m height.
      addInstance(
        "trim",
        "box",
        [length, 0.44, 0.18],
        [(a[0] + b[0]) / 2, review.heightMeters - 0.22, (a[1] + b[1]) / 2],
        angle,
      );
      for (let floor = 1; floor < review.levels; floor++)
        addInstance(
          "trim",
          "box",
          [length, 0.12, 0.16],
          [
            (a[0] + b[0]) / 2 + nx * 0.05,
            floor * floorHeight,
            (a[1] + b[1]) / 2 + nz * 0.05,
          ],
          angle,
        );
      if (length < 4) return;
      const bays = Math.max(1, Math.floor((length - 1.4) / 3.4));
      for (let bay = 1; bay <= bays; bay++) {
        const t = bay / (bays + 1),
          x = a[0] + dx * t,
          z = a[1] + dz * t;
        for (let floor = 0; floor < review.levels; floor++) {
          const y = floor * floorHeight + 1.55;
          addInstance(
            "recess",
            "plane",
            [1.7, 1.65, 1],
            [x + nx * 0.021, y, z + nz * 0.021],
            angle,
          );
          addInstance(
            "glass",
            "plane",
            [1.42, 1.36, 1],
            [x + nx * 0.04, y, z + nz * 0.04],
            angle,
          );
          if (lod === "full") {
            addInstance(
              "frame",
              "plane",
              [0.07, 1.36, 1],
              [x + nx * 0.055, y, z + nz * 0.055],
              angle,
            );
            addInstance(
              "frame",
              "plane",
              [1.42, 0.07, 1],
              [x + nx * 0.057, y, z + nz * 0.057],
              angle,
            );
          }
        }
      }
      if (lod === "full" && length > 7) {
        // Schematic roof strips, not measured solar/utility installations.
        const count = Math.floor(length / 3.5);
        for (let k = 1; k <= count; k++) {
          const t = k / (count + 1);
          addInstance(
            "roofStrip",
            "box",
            [0.48, 0.1, 1.8],
            [
              a[0] + dx * t - nx * 1.4,
              roofBase + 0.22,
              a[1] + dz * t - nz * 1.4,
            ],
            angle,
          );
        }
      }
    });
  }
  decorate(exterior, false);
  decorate(courtyard, true);
  for (const [key, matrices] of instances) {
    const [material, type] = key.split(":");
    const geometry =
      type === "box" ? new BoxGeometry(1, 1, 1) : new PlaneGeometry(1, 1);
    const mesh = new InstancedMesh(
      geometry,
      materials[material],
      matrices.length,
    );
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.name = key;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  scene.updateMatrixWorld(true);
  return scene;
}
const output = "public/models/nanyuan7";
await mkdir(output, { recursive: true });
const assets = {};
for (const lod of ["low", "full"]) {
  const scene = buildScene(lod);
  const binary = await new GLTFExporter().parseAsync(scene, {
    binary: true,
    copyright:
      "OSM footprint © OpenStreetMap contributors (ODbL-1.0). Original procedural CampusOS model; no reference image textures.",
  });
  const bytes = Buffer.from(binary);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const file = `nanyuan7-${lod}-${hash.slice(0, 12)}.glb`;
  await writeFile(output + "/" + file, bytes);
  let triangles = 0,
    drawCalls = 0;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    triangles +=
      ((object.geometry.index?.count ??
        object.geometry.attributes.position.count) /
        3) *
      (object.isInstancedMesh ? object.count : 1);
    drawCalls++;
  });
  assets[lod] = {
    url: "/models/nanyuan7/" + file,
    sha256: hash,
    bytes: bytes.length,
    triangles,
    drawCalls,
  };
}
const modelManifest = {
  modelVersion: "nanyuan7-2026-10-14.1",
  mapVersion: mapManifest.version,
  footprintId: place.id,
  placeId: place.id,
  name: place.name,
  origin: place.coordinate,
  footprintSha256: createHash("sha256")
    .update(JSON.stringify(place.geometry))
    .digest("hex"),
  heightMeters: review.heightMeters,
  levels: review.levels,
  heightAccuracy: review.heightAccuracy,
  appearanceAccuracy: review.appearanceAccuracy,
  courtyardAccuracy: review.courtyard.accuracy,
  geometry: { type: "Polygon", coordinates: volumeCoordinates },
  courtyardGeometry: { type: "Polygon", coordinates: [volumeCoordinates[1]] },
  dimensionsMeters: [width, review.heightMeters, depth],
  assets,
  license:
    "OSM footprint: ODbL-1.0; original procedural geometry/materials. Research imagery not embedded.",
};
await writeFile(
  "src/features/campus-map/data/nanyuan7-model.json",
  JSON.stringify(modelManifest, null, 2) + "\n",
);
await writeFile(
  output + "/SOURCE.md",
  "# 南苑7栋模型来源\n\nOSM footprint: https://www.openstreetmap.org/way/312536955 — © OpenStreetMap contributors, ODbL-1.0.\n\n7 floors / approximately 21m: project owner, 2026-10-14; not a surveyed height.\n\nOriginal procedural geometry/materials. Courtyard proportions, facade windows and roof trim are schematic visual approximations. No Apple/Sohu/Xiaohongshu image pixels, textures or supplier meshes are included. Source footprint and navigation data remain unchanged.\n\nEditable source: scripts/build-nanyuan7-model.mjs and src/features/campus-map/data/owner-model-review.json.\n",
);
console.log(
  JSON.stringify(
    {
      modelVersion: modelManifest.modelVersion,
      dimensionsMeters: modelManifest.dimensionsMeters,
      assets,
    },
    null,
    2,
  ),
);
