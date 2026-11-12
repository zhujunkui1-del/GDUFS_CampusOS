// Build image-free 2.5D masses and detailed 3D facades for Shiyuan 1–4.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MercatorCoordinate } from "maplibre-gl";
import {
  Scene,
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

const root = "docs/model-previews/shiyuan-1-4-v1";
const campus = JSON.parse(
  await readFile("src/features/campus-map/data/campus.json", "utf8"),
);
if (campus.mapVersion !== "s1-2026-10-14.2")
  throw new Error(`Review source map version ${campus.mapVersion}.`);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const levels = 6;
const estimatedHeightMeters = 18;
const roofThickness = 0.25;
const floorRise = 3;
const wallHeight = estimatedHeightMeters - roofThickness;
const palettes = {
  wall: "#e6e3db",
  white: "#d8d6ce",
  frame: "#bd8b6a",
  brick: "#b67562",
  glass: "#627a83",
  metal: "#899391",
  roof: "#777b78",
  roofCap: "#d5d2c8",
};

function localGeometry(place) {
  const origin = MercatorCoordinate.fromLngLat(place.coordinate);
  const units = origin.meterInMercatorCoordinateUnits();
  const local = ([lng, lat]) => {
    const point = MercatorCoordinate.fromLngLat([lng, lat]);
    return [(point.x - origin.x) / units, (point.y - origin.y) / units];
  };
  const outer = place.geometry.slice(0, -1).map(local);
  return { origin: place.coordinate, outer, footprintHash: sha256(JSON.stringify(place.geometry)) };
}

function createMaterials() {
  return Object.fromEntries(
    Object.entries(palettes).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: name === "glass" ? 0.58 : name === "metal" ? 0.75 : 0.9,
        metalness: name === "metal" ? 0.12 : 0,
      });
      material.name = name;
      return [name, material];
    }),
  );
}

const signedArea = (ring) =>
  ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const ringSign = (ring) => Math.sign(signedArea(ring)) || 1;
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
      normal: [(ringSign(ring) * dz) / length, (-ringSign(ring) * dx) / length],
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

function collectBoxes(buckets, material, size, position, angle = 0) {
  if (!buckets.has(material)) buckets.set(material, []);
  buckets.get(material).push(
    new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
      new Vector3(...size),
    ),
  );
}

function stats(scene, materials) {
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

function createWhiteMass(place, outer) {
  const materials = {
    ivory: new MeshStandardMaterial({ color: "#e8e5dc", roughness: 0.93 }),
    roof: new MeshStandardMaterial({ color: "#d5d2c8", roughness: 0.93 }),
  };
  materials.ivory.name = "ivory";
  materials.roof.name = "roof";
  const scene = new Scene();
  scene.name = `${place.name}-2.5d-white-mass`;
  scene.add(
    new Mesh(extrusion(outer, 0, wallHeight), materials.ivory),
    new Mesh(extrusion(outer, wallHeight, roofThickness), materials.roof),
  );
  scene.userData = {
    modelVersion: "shiyuan-1-4-v1-2026-11-12",
    sourcePlaceId: place.id,
    sourceMapVersion: campus.mapVersion,
    sourceFootprintSha256: sha256(JSON.stringify(place.geometry)),
    sourceVertexCount: outer.length,
    mode: "2.5d",
    appearanceStyle: "plain-white-mass-like-north-south-dormitories",
    levels,
    heightMeters: estimatedHeightMeters,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    imagesEmbedded: false,
    textureCount: 0,
  };
  return { scene, stats: stats(scene, materials) };
}

function createDetailed(place, outer) {
  const scene = new Scene();
  scene.name = `${place.name}-3d`;
  const materials = createMaterials();
  const buckets = new Map();
  scene.add(new Mesh(extrusion(outer, 0, wallHeight), materials.wall));
  scene.add(new Mesh(extrusion(outer, wallHeight, roofThickness), materials.roofCap));

  // A dark flat rooftop and one restrained service-room cue echo the source photographs.
  const interiorPoint = [
    outer.reduce((sum, point) => sum + point[0], 0) / outer.length,
    outer.reduce((sum, point) => sum + point[1], 0) / outer.length,
  ];
  if (pointInRing(interiorPoint, outer)) {
    collectBoxes(
      buckets,
      "roof",
      [7.2, 0.12, 2.6],
      [interiorPoint[0], estimatedHeightMeters + 0.06, interiorPoint[1]],
    );
    collectBoxes(
      buckets,
      "white",
      [5.8, 1.1, 2],
      [interiorPoint[0], estimatedHeightMeters + 0.66, interiorPoint[1]],
    );
  }

  for (const edge of edges(outer)) {
    const { a, dx, dz, length, normal } = edge;
    if (length < 6) continue;
    const angle = Math.atan2(normal[0], normal[1]);
    const pointAt = (distance, y, offset = 0) => [
      a[0] + dx * (distance / length) + normal[0] * offset,
      y,
      a[1] + dz * (distance / length) + normal[1] * offset,
    ];
    const bays = Math.max(2, Math.round(length / 3.5));
    const bayWidth = length / bays;
    const longFacade = length > 24;
    const cores = longFacade
      ? [length * 0.16, length * 0.5, length * 0.84]
      : [length * 0.5];

    for (const center of cores) {
      collectBoxes(
        buckets,
        "brick",
        [Math.min(1.6, bayWidth * 0.8), wallHeight, 0.22],
        pointAt(center, wallHeight / 2, 0.12),
        angle,
      );
    }

    for (let floor = 0; floor < levels; floor++) {
      const floorY = floor * floorRise;
      collectBoxes(
        buckets,
        "white",
        [length, 0.16, 0.24],
        pointAt(length / 2, floorY + 0.18, 0.08),
        angle,
      );
      for (let bay = 0; bay < bays; bay++) {
        const center = (bay + 0.5) * bayWidth;
        const windowWidth = Math.min(1.72, bayWidth * 0.62);
        const windowY = floorY + 1.58;
        collectBoxes(
          buckets,
          "glass",
          [windowWidth, 1.12, 0.045],
          pointAt(center, windowY, 0.18),
          angle,
        );
        if (longFacade && bay % 2 === 0) {
          collectBoxes(
            buckets,
            "white",
            [bayWidth * 0.78, 0.13, 0.65],
            pointAt(center, floorY + 0.48, 0.38),
            angle,
          );
          collectBoxes(
            buckets,
            "metal",
            [bayWidth * 0.78, 0.06, 0.06],
            pointAt(center, floorY + 1.16, 0.88),
            angle,
          );
          for (const t of [-0.35, 0, 0.35])
            collectBoxes(
              buckets,
              "metal",
              [0.05, 0.72, 0.05],
              pointAt(center + bayWidth * t, floorY + 0.8, 0.88),
              angle,
            );
        }
      }

    }
    const frameCount = Math.max(2, Math.floor(length / 6));
    for (let frame = 0; frame <= frameCount; frame++)
      collectBoxes(
        buckets,
        "frame",
        [0.17, wallHeight, 0.2],
        pointAt((frame * length) / frameCount, wallHeight / 2, 0.14),
        angle,
      );
    collectBoxes(
      buckets,
      "white",
      [length, 0.22, 0.25],
      pointAt(length / 2, estimatedHeightMeters + 0.13, 0.08),
      angle,
    );
  }

  for (const [materialName, matrices] of buckets) {
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      materials[materialName],
      matrices.length,
    );
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.name = `repeat-${materialName}`;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  scene.userData = {
    modelVersion: "shiyuan-1-4-v1-2026-11-12",
    sourcePlaceId: place.id,
    sourceMapVersion: campus.mapVersion,
    sourceFootprintSha256: sha256(JSON.stringify(place.geometry)),
    sourceVertexCount: outer.length,
    levels,
    heightMeters: estimatedHeightMeters,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    imagesEmbedded: false,
    textureCount: 0,
  };
  return { scene, stats: stats(scene, materials) };
}

await mkdir(root, { recursive: true });
const buildings = [];
for (let number = 1; number <= 4; number++) {
  const place = campus.places.find((item) => item.name === `师苑${number}栋`);
  if (!place?.geometry || place.category !== "dormitory")
    throw new Error(`Canonical GIS place 师苑${number}栋 is missing.`);
  const { origin, outer, footprintHash } = localGeometry(place);
  if (outer.length < 4) throw new Error(`Invalid outline for ${place.name}.`);
  const assets = {};
  for (const mode of ["2.5d", "3d"]) {
    const built = mode === "2.5d" ? createWhiteMass(place, outer) : createDetailed(place, outer);
    const binary = Buffer.from(
      await new GLTFExporter().parseAsync(built.scene, {
        binary: true,
        trs: false,
        onlyVisible: true,
        copyright:
          "Procedural image-free Shiyuan dormitory model from canonical OSM outline; storey height is a visual estimate.",
      }),
    );
    const file = `shiyuan-${number}-${mode}.glb`;
    await writeFile(`${root}/${file}`, binary);
    assets[mode] = {
      file,
      sha256: sha256(binary),
      bytes: binary.length,
      ...built.stats,
    };
  }
  buildings.push({
    key: `shiyuan-${number}`,
    name: place.name,
    placeId: place.id,
    origin,
    levels,
    heightMeters: estimatedHeightMeters,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    sourceGeometryWgs84: place.geometry,
    sourceFootprintSha256: footprintHash,
    sourceVertexCount: outer.length,
    assets,
  });
}

const manifest = {
  modelVersion: "shiyuan-1-4-v1-2026-11-12",
  stage: "map_integrated_visual_estimate",
  mapIntegrated: true,
  sourceMapVersion: campus.mapVersion,
  buildingCount: buildings.length,
  sharedLevels: levels,
  sharedEstimatedHeightMeters: estimatedHeightMeters,
  heightAccuracy: "visual_estimate_only_not_surveyed",
  source: "OpenStreetMap campus snapshot plus owner-supplied visual references",
  visualInputs: [
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/二饭_师苑.png",
      usage: "visual facade and roof reference for Shiyuan 1–4 only; adjacent Second Dining Hall is excluded",
    },
    {
      path: "C:/Users/zhuju/Downloads/师苑卫星图.png",
      usage: "top-view layout reference only; no unverified inner ring is traced",
    },
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/粗略/n.jpg",
      usage: "rough campus context only; not geometry or texture source",
    },
  ],
  styles: {
    "2.5d": "plain white mass matching North/South dormitory 2.5D models",
    "3d": "pale walls, warm terracotta facade frames, red cores, blue-gray windows, balcony rails and flat roof; visual estimate",
  },
  buildings,
  limitations: [
    "The four source outlines remain separate and retain their canonical OSM place IDs; no parent GIS geometry is created.",
    "Six floors and approximately 18 m are inferred visually; campus GIS has no surveyed height or levels.",
    "The satellite reference shows landscape gaps between blocks, but no inner-ring geometry or navigation entrances are added.",
    "The adjacent dining hall visible in the oblique photo is not part of this model batch.",
    "Reference photographs are not copied into public assets or embedded as textures.",
  ],
};
await writeFile(`${root}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  `${root}/design.json`,
  `${JSON.stringify(
    {
      version: manifest.modelVersion,
      sourceMapVersion: manifest.sourceMapVersion,
      levels,
      heightMeters: estimatedHeightMeters,
      heightAccuracy: manifest.heightAccuracy,
      palette: palettes,
      styles: manifest.styles,
      buildingKeys: buildings.map((building) => building.key),
      buildings: buildings.map(({ key, name, placeId, origin, sourceFootprintSha256, assets }) => ({
        key,
        name,
        placeId,
        origin,
        sourceFootprintSha256,
        assets,
      })),
      noEmbeddedImages: true,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify(
    {
      group: "师苑1—4栋",
      modelVersion: manifest.modelVersion,
      buildings: buildings.map((building) => ({
        key: building.key,
        name: building.name,
        placeId: building.placeId,
        sourceVertices: building.sourceVertexCount,
        footprintSha256: building.sourceFootprintSha256,
        assets: building.assets,
      })),
    },
    null,
    2,
  ),
);
