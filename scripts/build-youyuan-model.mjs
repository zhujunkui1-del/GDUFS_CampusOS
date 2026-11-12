// Historical first-pass pair builder for the Youyuan campus-map feature.
// Its 2.5D output was superseded on 2026-11-12. For the current low model use
// build-youyuan-2-5d.mjs; that builder hashes and preserves the approved 3D file.
// Do not rerun this paired builder for routine 2.5D updates.
// Source GIS stays authoritative; height and facade details are documented visual estimates.
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
  PlaneGeometry,
  DoubleSide,
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

const modelRoot = "docs/model-previews/youyuan-v1";
const sourcePath = "src/features/campus-map/data/campus.json";
const campus = JSON.parse(await readFile(sourcePath, "utf8"));
const place = campus.places.find((item) => item.id === "osm-way-313039031");
if (!place || place.name !== "友苑" || !Array.isArray(place.geometry))
  throw new Error("Canonical Youyuan OSM place is missing.");
if (campus.mapVersion !== "s1-2026-10-14.2")
  throw new Error(`Review source map version ${campus.mapVersion}.`);

const origin = MercatorCoordinate.fromLngLat(place.coordinate);
const mercatorUnits = origin.meterInMercatorCoordinateUnits();
const local = ([lng, lat]) => {
  const point = MercatorCoordinate.fromLngLat([lng, lat]);
  return [
    (point.x - origin.x) / mercatorUnits,
    (point.y - origin.y) / mercatorUnits,
  ];
};
const outer = place.geometry.slice(0, -1).map(local);
if (outer.length !== 22) throw new Error(`Expected 22 source vertices, got ${outer.length}.`);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const footprintJson = JSON.stringify(place.geometry);
const footprintHash = sha256(footprintJson);
const signedArea = (ring) =>
  ring.reduce((sum, a, index) => {
    const b = ring[(index + 1) % ring.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const ringAreaSign = Math.sign(signedArea(outer)) || 1;
const edges = (ring) =>
  ring.map((a, index) => {
    const b = ring[(index + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    return {
      a,
      b,
      dx,
      dz,
      length,
      // For a positive-area X/Z ring, the right-hand side is the exterior.
      normal: [(ringAreaSign * dz) / length, (-ringAreaSign * dx) / length],
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

const levels = 7;
const estimatedHeightMeters = 21;
const floorRise = 2.9;
const roofBase = floorRise * levels;
const colors = {
  tile: "#e5e1d8",
  brick: "#b96f5c",
  glass: "#647b83",
  metal: "#899493",
  balcony: "#d6d4cb",
  roof: "#cccac2",
  roofDark: "#6e716e",
  concrete: "#cbc8bd",
};

function createMaterials() {
  return Object.fromEntries(
    Object.entries(colors).map(([name, color]) => {
      const material = new MeshStandardMaterial({
        color,
        roughness: name === "glass" ? 0.52 : name === "metal" ? 0.74 : 0.9,
        metalness: name === "metal" ? 0.16 : 0,
        ...(name === "glass" ? { side: DoubleSide } : {}),
      });
      material.name = name;
      return [name, material];
    }),
  );
}

function extrude(ring, base, height) {
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

function boxInstances(scene, buckets, material, size, position, angle = 0) {
  if (!buckets.has(material)) buckets.set(material, []);
  buckets.get(material).push(
    new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
      new Vector3(...size),
    ),
  );
}

function addBody(scene, material, base = 0.15, height = roofBase + 0.18) {
  const mesh = new Mesh(extrude(outer, base, height), material);
  mesh.name = "source-outline-residence-shell";
  scene.add(mesh);
  return mesh;
}

function addRoofBlocks(scene, materials, buckets, detailed) {
  const candidates = [
    { center: [-22, 0], width: 10, depth: 7, height: 2.6, kind: "roofDark" },
    { center: [-17, -43], width: 8, depth: 4.6, height: 1.7, kind: "roof" },
    { center: [48, -49], width: 10, depth: 5.4, height: 2.1, kind: "tile" },
    { center: [-47, 47], width: 7, depth: 5, height: 1.7, kind: "roof" },
  ].filter((item) => pointInRing(item.center, outer));
  for (const item of candidates) {
    const y = roofBase + item.height / 2;
    boxInstances(
      scene,
      buckets,
      item.kind,
      [item.width, item.height, item.depth],
      [item.center[0], y, item.center[1]],
    );
    if (detailed) {
      boxInstances(
        scene,
        buckets,
        "concrete",
        [item.width + 0.22, 0.16, item.depth + 0.22],
        [item.center[0], roofBase + item.height + 0.08, item.center[1]],
      );
      // Louver/vent bars are simple display details; their exact roof equipment is unknown.
      const bars = Math.max(2, Math.floor(item.width / 2.1));
      for (let index = 0; index < bars; index++) {
        const x = item.center[0] - item.width * 0.36 + index * (item.width * 0.72) / (bars - 1);
        boxInstances(
          scene,
          buckets,
          "roofDark",
          [0.09, 0.07, item.depth * 0.58],
          [x, roofBase + item.height + 0.18, item.center[1]],
        );
      }
    }
  }
  return candidates;
}

function addRoundedLobby(scene, materials, buckets, detailed) {
  // The photo shows one shallow rounded lobby/portico. Its exact surveyed entrance is unknown.
  const southEdge = edges(outer)
    .filter((edge) => edge.normal[1] > 0.86 && edge.length > 30)
    .sort((a, b) => b.length - a.length)[0];
  if (!southEdge) return undefined;
  const radius = Math.min(4.4, southEdge.length * 0.1);
  const centerX = southEdge.a[0] + southEdge.dx * 0.56;
  const wallZ = southEdge.a[1] + southEdge.dz * 0.56;
  const lobbyRing = [[centerX - radius, wallZ]];
  for (let index = 1; index <= 16; index++) {
    const theta = Math.PI - (Math.PI * index) / 16;
    lobbyRing.push([
      centerX + Math.cos(theta) * radius,
      wallZ + Math.sin(theta) * radius,
    ]);
  }
  const lobby = new Mesh(
    extrude(lobbyRing, 0.15, detailed ? 4.5 : 2.3),
    materials.glass,
  );
  lobby.name = "approximate-rounded-lobby-display-only";
  scene.add(lobby);
  if (detailed) {
    const angle = Math.atan2(southEdge.normal[0], southEdge.normal[1]);
    const extent = radius * 1.45;
    for (const y of [1.05, 2.15, 3.25, 4.2])
      boxInstances(
        scene,
        buckets,
        "metal",
        [extent, 0.07, 0.08],
        [centerX, y, wallZ + 0.72],
        angle,
      );
    for (let index = 0; index <= 4; index++) {
      const along = -radius * 0.72 + index * (radius * 1.44) / 4;
      boxInstances(
        scene,
        buckets,
        "metal",
        [0.06, 4.1, 0.06],
        [centerX + along, 2.2, wallZ + 0.72],
        angle,
      );
    }
  }
  return { center: [centerX, wallZ], radius };
}

function addDetailedFacade(scene, materials, buckets) {
  const facadeEdges = edges(outer);
  let longFaceCount = 0;
  for (const edge of facadeEdges) {
    const { a, dx, dz, length, normal } = edge;
    if (length < 7) continue;
    const angle = Math.atan2(normal[0], normal[1]);
    const pointAt = (distance, y, offset = 0) => [
      a[0] + dx * (distance / length) + normal[0] * offset,
      y,
      a[1] + dz * (distance / length) + normal[1] * offset,
    ];
    const bayCount = Math.max(2, Math.round(length / 3.45));
    const bayWidth = length / bayCount;
    const isLongFace = length >= 28;
    if (isLongFace) longFaceCount++;

    // Broad red-brick stair/service cores divide the long balcony elevations.
    const coreCount = length >= 40 ? 3 : length >= 22 ? 2 : 1;
    const coreWidth = Math.min(2.25, Math.max(1.5, bayWidth * 0.72));
    const coreCenters = Array.from({ length: coreCount }, (_, index) =>
      (length * (index + 1)) / (coreCount + 1),
    );
    for (const center of coreCenters) {
      boxInstances(
        scene,
        buckets,
        "brick",
        [coreWidth, roofBase - 0.18, 0.22],
        pointAt(center, roofBase / 2 + 0.18, 0.11),
        angle,
      );
      for (let floor = 0; floor < levels; floor++) {
        boxInstances(
          scene,
          buckets,
          "glass",
          [Math.min(0.96, coreWidth * 0.44), 1.08, 0.03],
          pointAt(center, floor * floorRise + 1.56, 0.24),
          angle,
        );
      }
    }

    for (let floor = 0; floor < levels; floor++) {
      const floorY = floor * floorRise;
      // A shallow balcony/gallery slab extends along each facade bay.
      if (isLongFace) {
        boxInstances(
          scene,
          buckets,
          "balcony",
          [length, 0.16, 0.96],
          pointAt(length / 2, floorY + 0.44, 0.38),
          angle,
        );
        for (const railY of [floorY + 1.02, floorY + 1.28])
          boxInstances(
            scene,
            buckets,
            "metal",
            [length, 0.055, 0.06],
            pointAt(length / 2, railY, 0.88),
            angle,
          );
        const postCount = Math.floor(length / 4.5);
        for (let post = 0; post <= postCount; post++)
          boxInstances(
            scene,
            buckets,
            "metal",
            [0.055, 0.36, 0.055],
            pointAt((post * length) / Math.max(1, postCount), floorY + 1.17, 0.88),
            angle,
          );
      }

      // Individual blue-gray window panes and pale surrounds repeat at a stable bay pitch.
      for (let bay = 0; bay < bayCount; bay++) {
        const center = bayWidth * (bay + 0.5);
        if (coreCenters.some((core) => Math.abs(core - center) < coreWidth * 0.78))
          continue;
        const windowWidth = Math.min(1.8, bayWidth * 0.61);
        const windowHeight = 1.18;
        const windowY = floorY + 1.56;
        boxInstances(
          scene,
          buckets,
          "concrete",
          [windowWidth + 0.22, windowHeight + 0.19, 0.075],
          pointAt(center, windowY, 0.12),
          angle,
        );
        boxInstances(
          scene,
          buckets,
          "glass",
          [windowWidth, windowHeight, 0.035],
          pointAt(center, windowY, 0.18),
          angle,
        );
        boxInstances(
          scene,
          buckets,
          "metal",
          [0.045, windowHeight, 0.04],
          pointAt(center, windowY, 0.21),
          angle,
        );
      }

      boxInstances(
        scene,
        buckets,
        "concrete",
        [length, 0.11, 0.13],
        pointAt(length / 2, floorY + 0.12, 0.12),
        angle,
      );
    }

    // Small top parapet and tile seams follow the source roof outline.
    boxInstances(
      scene,
      buckets,
      "concrete",
      [length, 0.22, 0.26],
      pointAt(length / 2, roofBase + 0.26, 0.06),
      angle,
    );
    if (isLongFace) {
      const seamCount = Math.floor(length / 7);
      for (let seam = 1; seam < seamCount; seam++)
        boxInstances(
          scene,
          buckets,
          "roofDark",
          [0.045, 0.025, 0.28],
          pointAt((seam * length) / seamCount, roofBase + 0.39, 0.02),
          angle,
        );
    }
  }
  return longFaceCount;
}

function createScene(mode) {
  const detailed = mode === "3d";
  const scene = new Scene();
  scene.name = `友苑-${mode}`;
  const materials = createMaterials();
  const buckets = new Map();

  addBody(scene, materials.tile);
  const roof = new Mesh(extrude(outer, roofBase + 0.02, 0.3), materials.roof);
  roof.name = "flat-stepped-roof-envelope";
  scene.add(roof);

  if (detailed) {
    // Stacked slab edges make the seven-storey rhythm readable from orbit.
    const slabGeometry = extrude(outer, 0, 0.095);
    const slabs = new InstancedMesh(slabGeometry, materials.concrete, levels);
    for (let floor = 0; floor < levels; floor++)
      slabs.setMatrixAt(
        floor,
        new Matrix4().makeTranslation(0, floor * floorRise + 0.15, 0),
      );
    slabs.name = "seven-repeated-floor-slab-datums";
    slabs.computeBoundingBox();
    slabs.computeBoundingSphere();
    scene.add(slabs);
  }

  const longFaceCount = detailed
    ? addDetailedFacade(scene, materials, buckets)
    : 0;
  const roofBlocks = addRoofBlocks(scene, materials, buckets, detailed);
  const lobby = addRoundedLobby(scene, materials, buckets, detailed);

  if (!detailed) {
    // The 2.5D asset keeps the same footprint/height but uses sparse window rhythm.
    for (const edge of edges(outer)) {
      const { a, dx, dz, length, normal } = edge;
      if (length < 11) continue;
      const angle = Math.atan2(normal[0], normal[1]);
      const count = Math.max(2, Math.round(length / 4.5));
      if (length >= 20) {
        const coreCount = length >= 40 ? 3 : 2;
        for (let core = 0; core < coreCount; core++) {
          const t = (core + 1) / (coreCount + 1);
          boxInstances(
            scene,
            buckets,
            "brick",
            [2.15, roofBase - 0.15, 0.22],
            [
              a[0] + dx * t + normal[0] * 0.11,
              roofBase / 2 + 0.18,
              a[1] + dz * t + normal[1] * 0.11,
            ],
            angle,
          );
        }
      }
      for (let floor = 0; floor < levels; floor++) {
        const y = floor * floorRise;
        boxInstances(
          scene,
          buckets,
          "balcony",
          [length, 0.13, length >= 20 ? 0.48 : 0.2],
          [a[0] + dx * 0.5 + normal[0] * 0.14, y + 0.36, a[1] + dz * 0.5 + normal[1] * 0.14],
          angle,
        );
        if (length >= 20)
          boxInstances(
            scene,
            buckets,
            "metal",
            [length, 0.055, 0.055],
            [a[0] + dx * 0.5 + normal[0] * 0.47, y + 1.03, a[1] + dz * 0.5 + normal[1] * 0.47],
            angle,
          );
        for (let bay = 0; bay < count; bay++) {
          const t = (bay + 0.5) / count;
          boxInstances(
            scene,
            buckets,
            "glass",
            [Math.min(1.42, (length / count) * 0.55), 1.0, 0.025],
            [
              a[0] + dx * t + normal[0] * 0.14,
              y + 1.45,
              a[1] + dz * t + normal[1] * 0.14,
            ],
            angle,
          );
        }
      }
    }
  }

  for (const [materialName, matrices] of buckets) {
    if (!matrices.length) continue;
    const material = materials[materialName];
    const mesh = new InstancedMesh(
      materialName === "glass" ? new PlaneGeometry(1, 1) : new BoxGeometry(1, 1, 1),
      material,
      matrices.length,
    );
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.name = `repeat-${materialName}`;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  scene.userData = {
    modelVersion: "youyuan-v1-2026-11-12",
    sourcePlaceId: place.id,
    sourceMapVersion: campus.mapVersion,
    sourceFootprintSha256: footprintHash,
    sourceVertexCount: outer.length,
    levels,
    heightMeters: estimatedHeightMeters,
    heightAccuracy: "visual_estimate_only_not_surveyed",
    roofBlocks: roofBlocks.length,
    longFacadeCount: longFaceCount,
    lobbyDisplayOnly: !!lobby,
    imagesEmbedded: false,
    textureCount: 0,
  };
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
  let triangles = 0;
  let drawCalls = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position;
    triangles +=
      ((node.geometry.index?.count ?? positions.count) / 3) *
      (node.isInstancedMesh ? node.count : 1);
    drawCalls += 1;
  });
  return {
    scene,
    stats: {
      triangles: Math.round(triangles),
      drawCalls,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      materialCount: Object.keys(materials).length,
      textureCount: 0,
    },
  };
}

await mkdir(modelRoot, { recursive: true });
const assets = {};
for (const mode of ["2.5d", "3d"]) {
  const { scene, stats } = createScene(mode);
  const binary = Buffer.from(
    await new GLTFExporter().parseAsync(scene, {
      binary: true,
      trs: false,
      onlyVisible: true,
      includeCustomExtensions: false,
      copyright:
        "Procedural CampusOS Youyuan model; source OSM footprint retained separately, facade and seven-storey height are visual estimates.",
    }),
  );
  const fileName = `youyuan-${mode}.glb`;
  await writeFile(`${modelRoot}/${fileName}`, binary);
  assets[mode] = {
    file: fileName,
    sha256: sha256(binary),
    bytes: binary.length,
    ...stats,
  };
}

const manifest = {
  modelVersion: "youyuan-v1-2026-11-12",
  stage: "map_integrated_visual_model",
  mapIntegrated: true,
  sourceMapVersion: campus.mapVersion,
  placeId: place.id,
  name: place.name,
  origin: place.coordinate,
  levels,
  levelsSource: "Seven visible facade bands inferred from the supplied oblique photograph; not surveyed.",
  heightMeters: estimatedHeightMeters,
  heightAccuracy: "visual_estimate_only_not_surveyed",
  footprintSourceIds: [place.id],
  sourceGeometryWgs84: place.geometry,
  sourceFootprintSha256: footprintHash,
  sourceAreaMeters2: Math.abs(signedArea(outer)),
  visualInputs: [
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/友苑.png",
      usage: "internal visual facade/roof reference only; no source pixels exported",
    },
    {
      path: "C:/Users/zhuju/Downloads/友苑卫星图.png",
      usage: "internal top-view relationship reference only; inner void dimensions are not measured",
    },
    {
      path: "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/粗略/n.jpg",
      usage: "rough campus location context only; not geometry or texture source",
    },
  ],
  assets,
  limitations: [
    "GIS source has one 22-vertex outer ring and no verified inner rings or independent wing IDs; no courtyard geometry is invented or written to GIS.",
    "Seven stories and 21 m are visual estimates from facade bands; no height field is written to campus.json.",
    "Red brick cores, balcony/window rhythm, roof service blocks and a shallow rounded lobby are display geometry inferred from photos.",
    "Reference photographs remain in the source/documents folders; both GLBs have zero textures and zero embedded images.",
  ],
};
await writeFile(`${modelRoot}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  `${modelRoot}/design.json`,
  `${JSON.stringify(
    {
      version: manifest.modelVersion,
      sourceMapVersion: manifest.sourceMapVersion,
      placeId: manifest.placeId,
      sourceFootprintSha256: footprintHash,
      levels,
      heightMeters: estimatedHeightMeters,
      heightAccuracy: manifest.heightAccuracy,
      facadePalette: colors,
      buildingFeatures: [
        "exact-connected-22-vertex-footprint",
        "seven-floor-horizontal-datums",
        "repeated-window-and-balcony-bays",
        "brick-red-stair-service-core-bands",
        "flat-stepped-roof-and-service-blocks",
        "approximate-rounded-lobby-display-only",
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
      name: place.name,
      placeId: place.id,
      sourceVertices: outer.length,
      sourceFootprintSha256: footprintHash,
      assets,
    },
    null,
    2,
  ),
);
