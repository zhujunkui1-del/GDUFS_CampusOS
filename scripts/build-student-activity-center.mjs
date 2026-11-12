// Build the activity center from its canonical OSM footprint and owner-supplied visual references.
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
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  InstancedMesh,
  BoxGeometry,
  Box3,
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

const out = "docs/model-previews/student-activity-center-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
const place = campus.places.find((item) => item.name === "学生活动中心");
if (!place?.geometry || place.id !== "osm-way-313039010")
  throw new Error("Canonical student activity center place is missing.");
if (campus.mapVersion !== "s1-2026-10-14.2")
  throw new Error(`Review source map version ${campus.mapVersion}.`);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const meterUnits = origin.meterInMercatorCoordinateUnits();
const local = ([lng, lat]) => {
  const point = MercatorCoordinate.fromLngLat([lng, lat]);
  return [(point.x - origin.x) / meterUnits, (point.y - origin.y) / meterUnits];
};
const toWgs84 = ([x, z]) => {
  const point = new MercatorCoordinate(
    origin.x + x * meterUnits,
    origin.y + z * meterUnits,
  ).toLngLat();
  return [point.lng, point.lat];
};
const closedWgs84 = (ring) => [...ring.map(toWgs84), toWgs84(ring[0])];
const outer = place.geometry.slice(0, -1).map(local);
if (outer.length !== 12) throw new Error(`Expected 12 unique outline vertices, got ${outer.length}.`);
const footprintHash = sha256(JSON.stringify(place.geometry));
// Owner's north-up satellite shows a small open pocket in the center; this is display-only.
const courtyard = [
  [-10, -11],
  [-2, -11],
  [-2, -5],
  [-10, -5],
];

// The photos suggest a four-storey perimeter wing and a taller activity hall/stair core.
// Approximate heights are only for display and are not surveyed GIS values.
const facadeLevels = 4;
const floorRise = 3.1;
const wingHeight = facadeLevels * floorRise;
const hallHeight = 17.2;
const towerHeight = 19.2;
const hallCenterLocalMeters = [16, -3];
const towerCenterLocalMeters = [-7, 12];
const roofThickness = 0.28;
const colors = {
  ivory: "#e6e2d9",
  pale: "#d9d7cf",
  red: "#c62f35",
  blueRoof: "#83b5da",
  glass: "#5d7781",
  metal: "#8c9694",
  perforation: "#695d58",
  roof: "#747774",
};
const signedArea = (ring) =>
  ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const ringSign = Math.sign(signedArea(outer)) || 1;
const edges = (ring) =>
  ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    return {
      a,
      dx,
      dz,
      length,
      normal: [(ringSign * dz) / length, (-ringSign * dx) / length],
    };
  });
const pointInRing = ([x, z], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};
const boxRing = (x, z, width, depth) => [
  [x - width / 2, z - depth / 2],
  [x + width / 2, z - depth / 2],
  [x + width / 2, z + depth / 2],
  [x - width / 2, z + depth / 2],
];
function extrusion(ring, base, height, innerRing = null) {
  const shape = new Shape(ring.map(([x, z]) => new Vector2(x, -z)));
  if (innerRing)
    shape.holes.push(new Path(innerRing.map(([x, z]) => new Vector2(x, -z))));
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
function materialsFor(palette) {
  return Object.fromEntries(
    Object.entries(palette).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: name === "glass" ? 0.55 : name === "metal" ? 0.76 : 0.9,
        metalness: name === "metal" ? 0.13 : 0,
      });
      material.name = name;
      return [name, material];
    }),
  );
}
function addInstanced(scene, buckets, material, size, position, angle = 0) {
  if (!buckets.has(material)) buckets.set(material, []);
  buckets.get(material).push(
    new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
      new Vector3(...size),
    ),
  );
}
function finishInstanced(scene, materials, buckets) {
  for (const [name, matrices] of buckets) {
    if (!matrices.length) continue;
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      materials[name],
      matrices.length,
    );
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.name = `repeat-${name}`;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}
function sceneStats(scene, materials) {
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
  let triangles = 0;
  let drawCalls = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const p = node.geometry.attributes.position;
    triangles +=
      ((node.geometry.index?.count ?? p.count) / 3) *
      (node.isInstancedMesh ? node.count : 1);
    drawCalls++;
  });
  return {
    triangles: Math.round(triangles),
    drawCalls,
    materialCount: Object.keys(materials).length,
    textureCount: 0,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
}

function createMass() {
  const palette = { ivory: "#e8e5dc", roofCap: "#d5d2c8" };
  const mats = materialsFor(palette);
  const scene = new Scene();
  scene.name = "学生活动中心-2.5d-white-mass";
  const capStart = 17.75;
  scene.add(
    new Mesh(extrusion(outer, 0, capStart, courtyard), mats.ivory),
    new Mesh(extrusion(outer, capStart, 0.25, courtyard), mats.roofCap),
  );
  scene.userData = {
    modelVersion: "student-activity-center-v1-2026-11-12",
    sourcePlaceId: place.id,
    sourceMapVersion: campus.mapVersion,
    sourceFootprintSha256: footprintHash,
    sourceVertexCount: outer.length,
    displayCourtyardLocalMeters: courtyard,
    courtyardAccuracy: "north_up_satellite_visual_estimate_not_GIS",
    mode: "2.5d",
    appearanceStyle: "plain-white-building-mass",
    heightMeters: 18,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    imagesEmbedded: false,
    textureCount: 0,
  };
  return { scene, stats: sceneStats(scene, mats) };
}

function createDetailed() {
  const mats = materialsFor(colors);
  const scene = new Scene();
  scene.name = "学生活动中心-3d";
  const buckets = new Map();
  const wing = new Mesh(extrusion(outer, 0, wingHeight, courtyard), mats.ivory);
  wing.name = "connected-perimeter-wings";
  scene.add(wing);
  scene.add(new Mesh(extrusion(outer, wingHeight, 0.24, courtyard), mats.roof));

  // The corrected north-up satellite places the large blue hall east of the small central opening.
  const hallCenter = hallCenterLocalMeters;
  const hallFootprint = boxRing(hallCenter[0], hallCenter[1], 30, 22);
  if (!hallFootprint.every((point) => pointInRing(point, outer)))
    throw new Error("The inferred hall volume would extend beyond the OSM footprint.");
  scene.add(new Mesh(extrusion(hallFootprint, wingHeight, hallHeight - wingHeight), mats.ivory));
  scene.add(new Mesh(extrusion(hallFootprint, hallHeight, roofThickness), mats.blueRoof));

  // The bright red tower is southwest of the hall in the owner's north-up satellite.
  const towerCenter = towerCenterLocalMeters;
  const towerFootprint = boxRing(towerCenter[0], towerCenter[1], 5.4, 6.4);
  if (towerFootprint.every((point) => pointInRing(point, outer)))
    scene.add(new Mesh(extrusion(towerFootprint, 0, towerHeight), mats.red));

  // Blue roof ribs and a restrained clerestory line emphasize the large activity hall volume.
  for (let index = -5; index <= 5; index++)
    addInstanced(
      scene,
      buckets,
      "roof",
      [0.16, 0.07, 19],
      [hallCenter[0] + index * 2.45, hallHeight + 0.34, hallCenter[1]],
    );

  const edgeList = edges(outer);
  const longestEdge = [...edgeList].sort((a, b) => b.length - a.length)[0];
  const frontEdge =
    edgeList
      .filter((edge) => edge.length > 30 && edge.normal[1] > 0.6)
      .sort((a, b) => b.length - a.length)[0] || longestEdge;
  for (const edge of edgeList) {
    const { a, dx, dz, length, normal } = edge;
    if (length < 7) continue;
    const angle = Math.atan2(normal[0], normal[1]);
    const pointAt = (distance, y, offset = 0) => [
      a[0] + dx * (distance / length) + normal[0] * offset,
      y,
      a[1] + dz * (distance / length) + normal[1] * offset,
    ];
    const bays = Math.max(2, Math.round(length / 6.6));
    const bayWidth = length / bays;
    const floorCount = Math.floor(wingHeight / floorRise);
    for (let floor = 0; floor < floorCount; floor++) {
      const floorY = floor * floorRise;
      if (length >= 15)
        addInstanced(
          scene,
          buckets,
          "pale",
          [length, 0.16, 0.24],
          pointAt(length / 2, floorY + 0.18, 0.1),
          angle,
        );
      for (let bay = 0; bay < bays; bay++) {
        const center = bayWidth * (bay + 0.5);
        addInstanced(
          scene,
          buckets,
          "glass",
          [Math.min(2.3, bayWidth * 0.62), 1.35, 0.05],
          pointAt(center, floorY + 1.75, 0.15),
          angle,
        );
        if (length >= 28 && bay % 2 === 0) {
          addInstanced(
            scene,
            buckets,
            "pale",
            [bayWidth * 0.78, 0.14, 0.7],
            pointAt(center, floorY + 0.48, 0.42),
            angle,
          );
          addInstanced(
            scene,
            buckets,
            "metal",
            [bayWidth * 0.78, 0.06, 0.06],
            pointAt(center, floorY + 1.1, 0.9),
            angle,
          );
          for (const offset of [-0.31, 0.31])
            addInstanced(
              scene,
              buckets,
              "metal",
              [0.05, 0.62, 0.05],
              pointAt(center + bayWidth * offset, floorY + 0.8, 0.9),
              angle,
            );
        }
      }
    }
    const columnCount = Math.max(2, Math.floor(length / 7));
    for (let column = 0; column <= columnCount; column++)
      addInstanced(
        scene,
        buckets,
        length >= 28 ? "red" : "pale",
        [length >= 28 ? 0.22 : 0.14, wingHeight, 0.22],
        pointAt((column * length) / columnCount, wingHeight / 2, 0.14),
        angle,
      );
    addInstanced(
      scene,
      buckets,
      "pale",
      [length, 0.2, 0.3],
      pointAt(length / 2, wingHeight + 0.12, 0.08),
      angle,
    );
  }

  // The reference facade has small circular ventilation holes; simplified to a low-count dot grid.
  if (frontEdge.length > 35) {
    const { a, dx, dz, length, normal } = frontEdge;
    const angle = Math.atan2(normal[0], normal[1]);
    const pointAt = (distance, y, offset = 0) => [
      a[0] + dx * (distance / length) + normal[0] * offset,
      y,
      a[1] + dz * (distance / length) + normal[1] * offset,
    ];
    const dots = 10;
    for (let row = 0; row < 3; row++)
      for (let dot = 0; dot < dots; dot++)
        addInstanced(
          scene,
          buckets,
          "perforation",
          [0.18, 0.18, 0.035],
          pointAt((dot + 0.5) * (length / dots), 4.1 + row * 1.25, 0.2),
          angle,
        );
  }

  // Display-only entry portal/stair cue on the longest straight facade; it is not a verified route entrance.
  if (frontEdge) {
    const angle = Math.atan2(frontEdge.normal[0], frontEdge.normal[1]);
    const centerAt = (outward) => [
      frontEdge.a[0] + frontEdge.dx * 0.5 + frontEdge.normal[0] * outward,
      frontEdge.a[1] + frontEdge.dz * 0.5 + frontEdge.normal[1] * outward,
    ];
    const stairCount = 10;
    for (let step = 0; step < stairCount; step++)
      addInstanced(
        scene,
        buckets,
        "pale",
        [16, 0.16, 0.42],
        [
          centerAt(4.1 - step * 0.42)[0],
          0.13 + step * 0.17,
          centerAt(4.1 - step * 0.42)[1],
        ],
        angle,
      );
    for (const dx of [-8.5, 8.5])
      addInstanced(
        scene,
        buckets,
        "pale",
        [0.28, 6.8, 0.28],
        [
          centerAt(0.3)[0] + dx * Math.cos(angle),
          8.6,
          centerAt(0.3)[1] - dx * Math.sin(angle),
        ],
        angle,
      );
    addInstanced(
      scene,
      buckets,
      "pale",
      [18, 0.48, 2.4],
      [centerAt(0.3)[0], 12.15, centerAt(0.3)[1]],
      angle,
    );
  }

  finishInstanced(scene, mats, buckets);
  scene.userData = {
    modelVersion: "student-activity-center-v1-2026-11-12",
    sourcePlaceId: place.id,
    sourceMapVersion: campus.mapVersion,
    sourceFootprintSha256: footprintHash,
    sourceVertexCount: outer.length,
    displayCourtyardLocalMeters: courtyard,
    courtyardAccuracy: "north_up_satellite_visual_estimate_not_GIS",
    levels: facadeLevels,
    heightMeters: towerHeight,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    displayHallHeightMeters: hallHeight,
    entryStairCueIsNavigation: false,
    imagesEmbedded: false,
    textureCount: 0,
  };
  return { scene, stats: sceneStats(scene, mats) };
}

await mkdir(out, { recursive: true });
const assets = {};
for (const mode of ["2.5d", "3d"]) {
  const built = mode === "2.5d" ? createMass() : createDetailed();
  const binary = Buffer.from(
    await new GLTFExporter().parseAsync(built.scene, {
      binary: true,
      trs: false,
      onlyVisible: true,
      copyright:
        "Procedural image-free student activity center model from canonical OSM outline; hall/tower heights and facade features are visual estimates.",
    }),
  );
  const file = `student-activity-center-${mode}.glb`;
  await writeFile(`${out}/${file}`, binary);
  assets[mode] = { file, sha256: sha256(binary), bytes: binary.length, ...built.stats };
}

const manifest = {
  modelVersion: "student-activity-center-v1-2026-11-12",
  stage: "map_integrated_visual_estimate",
  mapIntegrated: true,
  sourceMapVersion: campus.mapVersion,
  name: place.name,
  placeId: place.id,
  origin: place.coordinate,
  footprintSourceIds: [place.id],
  sourceGeometryWgs84: place.geometry,
  sourceFootprintSha256: footprintHash,
  sourceVertexCount: outer.length,
  orientationBasis: "owner-supplied satellite is north-up; local X=east and local Z=south",
  blueRoofCenterLocalMeters: hallCenterLocalMeters,
  redTowerCenterLocalMeters: towerCenterLocalMeters,
  displayCourtyardWgs84: closedWgs84(courtyard),
  courtyardAccuracy: "north_up_satellite_visual_estimate_not_GIS",
  facadeLevels,
  estimatedWingHeightMeters: wingHeight,
  estimatedHallHeightMeters: hallHeight,
  estimatedTowerHeightMeters: towerHeight,
  heightAccuracy: "visual_estimate_only_not_surveyed",
  assets,
  visualInputs: [
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/学生活动中心侧面23.jpg",
      usage: "side elevation, entrance arcade, stair tower and perforated facade reference only",
    },
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/学生活动中心_正面俯视.png",
      usage: "roof and volume arrangement reference only; no surveyed dimensions extracted",
    },
    {
      path: "C:/Users/zhuju/AppData/Local/Temp/codex-clipboard-2a26f8be-9947-4116-9cd0-887942439fe2.png",
      usage: "owner-confirmed north-up direction reference for the east/south hall, southwest red tower and central opening",
    },
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/细节/学生活动中心正面23.png",
      usage: "perforated facade and shop-level appearance reference only",
    },
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/粗略/n.jpg",
      usage: "rough campus context only; not geometry or texture source",
    },
  ],
  limitations: [
    "The source map contains one twelve-vertex outer way; the small center opening inferred from the north-up satellite is display-only and not GIS or routing data.",
    "The side-image stairs and overhead portal are display-only visual cues and do not create a navigation entrance.",
    "Four-storey perimeter wings, a taller hall and a red tower are photo-based visual estimates; not surveyed levels or heights.",
    "The 2.5D asset is a simple white volume. The 3D asset uses image-free procedural geometry and contains no source-photo texture.",
  ],
};
const displayGeojson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        displayOnly: true,
        sourcePlaceId: place.id,
        source: "owner-supplied north-up satellite estimate",
      },
      geometry: {
        type: "Polygon",
        coordinates: [place.geometry, closedWgs84(courtyard)],
      },
    },
  ],
};
await writeFile(
  `${out}/student-activity-center-2.5d.geojson`,
  `${JSON.stringify(displayGeojson, null, 2)}\n`,
);
await writeFile(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  `${out}/design.json`,
  `${JSON.stringify(
    {
      version: manifest.modelVersion,
      sourceMapVersion: manifest.sourceMapVersion,
      placeId: manifest.placeId,
      sourceFootprintSha256: footprintHash,
      orientationBasis: manifest.orientationBasis,
      blueRoofCenterLocalMeters: hallCenterLocalMeters,
      redTowerCenterLocalMeters: towerCenterLocalMeters,
      displayCourtyardLocalMeters: courtyard,
      facadeLevels,
      estimatedWingHeightMeters: wingHeight,
      estimatedHallHeightMeters: hallHeight,
      estimatedTowerHeightMeters: towerHeight,
      heightAccuracy: manifest.heightAccuracy,
      palette: colors,
      "2.5dStyle": "plain white mass with a light roof cap",
      "3dFeatures": [
        "exact-twelve-vertex-connected-footprint",
        "four-storey-perimeter-wing-visual-estimate",
        "raised-blue-sheet-metal-activity-hall-roof",
        "red-stair-tower-display-mass",
        "perforated-facade-dot-grid",
      "north-up-satellite-small-center-opening-display-only",
        "window-bands-and-balcony-rails",
        "display-only-entry-stair-and-portal-cue",
      ],
      assets,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify(
    {
      placeId: place.id,
      sourceVertexCount: outer.length,
      sourceFootprintSha256: footprintHash,
      assets,
    },
    null,
    2,
  ),
);
