import { readFile, writeFile } from "node:fs/promises";

const file = async (name) => JSON.parse(await readFile(name, "utf8"));
const base = "docs/model-previews/youyuan-v1/";
const assessment = await file(base + "pre-spec-assessment.json");
const inventory = await file(base + "detail-inventory.json");
const observed = [
  ["zone-r0c0", "contour", "A high pale roof block and the long parapet edge are directly visible; the roof-block internal equipment is occluded.", "roof-service-rooms", 0.77],
  ["zone-r0c1", "seam", "Stepped flat roof slabs connect two taller masses; panel joints read as shallow horizontal seams.", "roofline-setbacks", 0.79],
  ["zone-r0c2", "contour", "A pale rectangular rooftop block rises one storey above the adjacent roof and meets red masonry below.", "roof-service-rooms", 0.73],
  ["zone-r1c0", "ridge", "A broad uninterrupted brick-red stair-core band interrupts the balcony/window rhythm.", "brick-stair-cores", 0.89],
  ["zone-r1c1", "seam", "Repeated floor slabs and projecting bands separate stacked window/balcony rows.", "floor-slab-bands", 0.88],
  ["zone-r1c2", "linework", "White horizontal balcony rails, thin mullions and warm-red vertical piers repeat across the elevation.", "balcony-window-grid", 0.87],
  ["zone-r2c0", "contour", "An inward-facing curved lobby canopy forms a low, rounded projection between wings.", "round-inner-lobby", 0.68],
  ["zone-r2c1", "ridge", "Brick-red core panels continue through multiple storeys beside recessed openings.", "brick-stair-cores", 0.78],
  ["zone-r2c2", "linework", "A close view shows repeated bay spacing, light balcony rims and blue-gray glazing.", "balcony-window-grid", 0.86],
].map(([id, kind, description, feature, confidence]) => {
  const original = inventory.detailInventory.details.find((d) => d.id === id);
  return {
    ...original,
    kind,
    description,
    scale: "meso/repeated facade feature at campus-map viewing distance",
    affects: kind === "contour" || kind === "ridge" ? "visible form" : "facade rhythm and material response",
    mapsTo: { type: "component.localFeatures", ref: feature },
    confidence,
  };
});
observed.push(
  {
    id: "satellite-courtyard-west",
    kind: "contour",
    description: "The roof plan contains a broad open landscaped gap beside the offset central wing; its inner boundary is image-estimated and remains display-only.",
    region: { x: 0.16, y: 0.25, width: 0.37, height: 0.34, units: "normalized" },
    scale: "macro court opening and adjoining wings",
    affects: "negative space and top plan",
    mapsTo: { type: "component.localFeatures", ref: "unverified-courtyard-limits" },
    evidenceRef: "roof-plan",
    confidence: 0.62,
    realization: "not-modeled-unverified-inner-boundary",
  },
  {
    id: "satellite-inner-courtyard",
    kind: "contour",
    description: "A second inner garden/air gap is visible around the lower wing connection; exact courtyard limits cannot be measured from this image.",
    region: { x: 0.24, y: 0.52, width: 0.42, height: 0.3, units: "normalized" },
    scale: "macro court opening",
    affects: "negative space and display-only landscaping",
    mapsTo: { type: "component.localFeatures", ref: "unverified-courtyard-limits" },
    evidenceRef: "roof-plan",
    confidence: 0.57,
    realization: "not-modeled-unverified-inner-boundary",
  },
);
inventory.detailInventory = {
  ...inventory.detailInventory,
  scanMethod: "grid-3x3 facade image and uncalibrated roof-plan visual scan",
  targetMinDetails: 10,
  details: observed,
};
await writeFile(base + "detail-inventory.json", JSON.stringify(inventory, null, 2) + "\n");

const p = assessment.preSpecAssessment;
p.objectClass = {
  primaryType: "large connected multi-wing university residence complex",
  primaryDomain: "object",
  formLanguage: ["architectural", "geometric", "hard-surface"],
  structureKind: ["compound object", "branching wing hierarchy", "repeated modules", "layered shell"],
  motionPotential: ["static prop", "whole-object transform"],
  materialFamilies: ["ceramic tile", "red masonry", "glass", "painted metal", "concrete"],
  notes: "One real OSM outer way; wings are visual child groups, not separately verified OSM buildings.",
};
p.complexity = {
  tier: "complex",
  scores: {
    silhouetteComplexity: 3,
    componentCount: 3,
    hierarchyDepth: 2,
    repetitionDensity: 3,
    materialLayerCount: 2,
    localDetailDensity: 2,
    occlusionRisk: 3,
    actionReadinessNeed: 0,
  },
  estimatedCounts: {
    macroComponents: 5,
    mesoComponents: 8,
    microFeatureGroups: observed.length,
    materialLayers: 5,
    repetitionSystems: 4,
  },
  reasoning: [
    "The source outline is a long orthogonal zigzag with multiple concave recesses, not a rectangle.",
    "Several vertical red masonry cores interrupt long repeated window/balcony elevations.",
    "The facade and roof images are not calibrated; exact inner-courtyard boundaries, rear details, measured heights and entrance connectivity remain unverified.",
  ],
};
p.specDepthDecision = {
  requiredDepth: "complex",
  minimumComponentLevels: ["macro", "meso", "micro"],
  needsRepetitionSystems: true,
  needsMaterialLocalOverrides: true,
  needsMultipleReviewViews: true,
  needsActionReadyHierarchy: false,
  rationale: "A static campus-map asset needs a stable transform and visual hierarchy, not physics, destructibility or an invented indoor rig.",
};
p.unknownsToResolveBeforeImplementation = [];
p.implementationLimits = [
  "Measured floor-to-floor height and total elevation are unavailable; seven visible bands and approximately 21 m are photo-based estimates only.",
  "The source map contains one outer way and no independently verified wing IDs or inner-ring geometry; photo-suggested inner gardens are not cut into the GIS-faithful footprint.",
  "The back facade, roof equipment internals, window dimensions, exact courtyard widths, lobby diameter and verified walking entrance are unmeasured.",
  "Map GLBs use image-free MeshStandardMaterial colors and repeated geometry; reference PBR maps were not embedded because the photos are uncalibrated and the map asset pipeline rejects texture payloads.",
];
p.detailInventory = inventory.detailInventory;
assessment.qualityContract = {
  qualityBar: "complex",
  definitionOfDone: [
    "Both GLBs preserve the exact 22 unique WGS84 footprint vertices (23 entries including the closing point), connected zigzag silhouette and source concave recesses.",
    "The 2.5D asset is a plain white extruded mass and light roof cap, matching the North/South dormitory 2.5D style; no windows, red cores, balconies, rooftop equipment or lobby detail appear in this mode.",
    "The 3D asset reads as a seven-band residence group through repeated floor slabs, tiled/brick facade fields, glazed bays and balcony rails.",
    "The visible warm-red core strips, pale roof blocks and inward rounded lobby remain recognizable without implying measured dimensions or independent building IDs.",
    "No unverified courtyard ring, entrance, sub-building ID or height value is written to campus GIS or routing.",
    "All surface geometry is self-authored, image-less GLB material; unknown back-side or roof detail remains simple and visibly approximate.",
  ],
  minimumSpecDepth: {
    macroComponents: 3,
    mesoComponents: 8,
    microFeatureGroups: 10,
    materialLayers: 3,
    repetitionSystems: 3,
    reviewViewpoints: 4,
  },
  featureGroups: [
    { id: "zigzag-outline", name: "Connected zigzag footprint and recesses", required: true, qualityCriteria: ["All 22 unique source vertices remain exact in map coordinates.", "Concave source recesses remain open in the top-view outline."], evidenceRefs: ["full-object", "roof-plan"], failureModes: ["one rectangular volume replaces several offset wings", "invented inner rings change the source footprint"] },
    { id: "wing-hierarchy", name: "Connected wing and stair-core hierarchy", required: true, qualityCriteria: ["Each major wing is named and attached to its real parent shell.", "Brick stair-core strips visibly divide the long elevations."], evidenceRefs: ["full-object", "roof-plan"], failureModes: ["disconnected floating wings", "red cores omitted or placed arbitrarily"] },
    { id: "floor-and-balcony-rhythm", name: "Repeated floor, window and balcony systems", required: true, qualityCriteria: ["Approximately seven facade bands are visible as a visual estimate.", "Window bays, floor edges and balcony railings repeat with stable spacing along every long facade."], evidenceRefs: ["full-object"], failureModes: ["uniform blank wall", "repeated floor count differs between wings"] },
    { id: "tile-brick-glass-palette", name: "Observed tile, brick and glazing response", required: true, qualityCriteria: ["Warm-red masonry fields remain distinct from pale tile walls, blue-gray glass and light rails.", "Lighting variation is procedural, not baked from the photograph."], evidenceRefs: ["full-object"], failureModes: ["single flat color across all facades", "photo pixels exported as texture"] },
    { id: "rounded-lobby-display", name: "Inward rounded lobby and entry canopy cue", required: true, qualityCriteria: ["A single shallow circular/glazed facade projection echoes the visible round lobby.", "It is treated as visual detail, not a verified map entrance."], evidenceRefs: ["full-object", "roof-plan"], failureModes: ["the lobby floats unattached", "the decorative canopy is treated as a routable entrance"] },
  ],
  visualDeltaChecks: ["exact outer-ring vertex delta", "top-view open-space/shell overlap", "facade floor-band count and spacing", "brick-core bay placement", "window/rail palette separation", "round-lobby attachment and silhouette"],
  antiShallowSpecRules: assessment.qualityContract.antiShallowSpecRules,
};
assessment.authoringInstruction = "Conditional visual reconstruction: preserve the one source way, treat facade count/height and the rounded lobby as display estimates, and do not invent unverified inner rings.";
await writeFile(base + "pre-spec-assessment.json", JSON.stringify(assessment, null, 2) + "\n");

const spec = await file(base + "object-sculpt-spec.json");
const rgba = (hex) => {
  const value = hex.replace("#", "");
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, 1.0)`;
};
const palettes = {
  tile: { dominant: "#e5e1d8", secondary: "#d4d0c6", materialClass: "ceramic", confidence: 0.76 },
  brick: { dominant: "#b96f5c", secondary: "#9f5b4d", materialClass: "stone", confidence: 0.82 },
  glass: { dominant: "#647b83", secondary: "#82949a", materialClass: "glass", confidence: 0.75 },
  metal: { dominant: "#899493", secondary: "#bbc0bb", materialClass: "metal", confidence: 0.7 },
  balcony: { dominant: "#d6d4cb", secondary: "#c4c2b9", materialClass: "stone", confidence: 0.7 },
  roof: { dominant: "#cccac2", secondary: "#b5b3ab", materialClass: "stone", confidence: 0.72 },
  roofDark: { dominant: "#6e716e", secondary: "#878983", materialClass: "stone", confidence: 0.68 },
  concrete: { dominant: "#cbc8bd", secondary: "#e2ded4", materialClass: "stone", confidence: 0.72 },
};
const root = structuredClone(spec.componentTree[0]);
const component = (id, name, level, parent, material, features, dims, evidence = ["full-object"]) => {
  const c = structuredClone(root);
  const palette = palettes[material] || palettes.tile;
  c.id = id;
  c.name = name;
  c.level = level;
  c.role = level === "macro" ? "connected-building-mass" : level === "meso" ? "architectural-system" : "repeated-detail-group";
  c.importance = level === "macro" ? 0.98 : level === "meso" ? 0.84 : 0.72;
  c.confidence = palette.confidence;
  c.primitive = level === "macro" ? "extrude" : level === "meso" ? "instanced-cluster" : "plane-card";
  c.topologyClass = level === "macro" ? "assembled-solid" : level === "meso" ? "conforming-shell" : "surface-relief";
  c.topologyRationale = level === "macro"
    ? "The connected orthogonal GIS outline extrudes as one continuous campus volume with visible concave recesses."
    : level === "meso"
      ? "Repeated architectural surfaces attach to the connected host shell and follow its facade or roof edges."
      : "Small repeated facade modules remain attached to the host elevation and read as linework at map scale.";
  c.geometryDescriptor = {
    topologyIntent: level === "macro" ? "extruded source footprint with image-inferred elevation" : "repeated attached facade geometry",
    edgeTreatment: { type: "none", bevelRadius: 0, segments: 1 },
    deformationStack: [],
    uvStrategy: "not-used-image-free-map-materials",
    normalStrategy: "generated-geometry-normals",
  };
  c.parent = parent;
  c.attachment = parent === null ? null : {
    parentSocket: "source-outline-shell",
    localStart: [0, 0, 0],
    localEnd: [0, dims.height || 1, 0],
    contactType: "overlap",
    embedDepth: 0.08,
    gapTolerance: 0.12,
  };
  c.dimensions = { width: dims.width || 1, height: dims.height || 1, depth: dims.depth || 1, units: "meters", confidence: c.confidence };
  c.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  c.actionProfile = {
    animationRole: parent === null ? "root" : "static-display-subassembly",
    pivot: { mode: parent === null ? "footprint-origin" : "component-center", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.9 },
    transformChannels: { translate: parent === null, rotate: parent === null, scale: parent === null, bend: false, twist: false, detach: false, visibility: true, materialState: false },
    sockets: [],
    collider: { type: "box", offset: [0, 0, 0], scale: [dims.width || 1, dims.height || 1, dims.depth || 1], isTrigger: false, notes: "Static campus display proxy; not used for navigation or indoor interaction." },
    constraints: [],
    destruction: { breakable: false, fractureGroup: id, seamRefs: [], detachableFragments: [], breakImpulse: 0, debrisMaterial: material },
  };
  c.material = material;
  c.materialLayers = [material];
  c.deformations = [];
  c.joints = [];
  c.seams = [];
  c.localFeatures = features.map((feature) => ({ id: feature.id, name: feature.name, geometry: feature.geometry, evidenceRefs: feature.evidenceRefs || evidence, realization: feature.realization || "instanced-procedural-geometry" }));
  c.surfaceDetail = { macroRoughness: 0.05, microRoughness: 0.02, bumpAmplitude: 0, normalPattern: "none", displacementPattern: "none", occlusionPattern: "geometry-contact-only", edgeWearPattern: "not-modeled-at-campus-map-scale", notes: "Image-free geometry and broad material zones are the intended campus-map fidelity tier." };
  c.evidenceRefs = evidence;
  c.details = [];
  c.fidelityTier = "map-display";
  c.colorMaterialRecipe = { dominantAlbedo: rgba(palette.dominant), secondaryAlbedo: rgba(palette.secondary), materialClass: palette.materialClass, materialClassConfidence: palette.confidence, evidenceRefs: evidence };
  return c;
};
const feats = {
  shell: [
    { id: "zigzag-outline", name: "Exact connected source outline", geometry: "22 unique source vertices; 23 closed-ring entries" },
    { id: "concave-open-recesses", name: "Concave outline recesses", geometry: "Preserve GIS recesses; do not add unverified inner rings" },
    { id: "unverified-courtyard-limits", name: "Unverified inner courtyard boundaries", geometry: "Retain as an explicit limitation; do not cut unsupported void polygons" },
  ],
  roof: [
    { id: "roofline-setbacks", name: "Stepped flat roofline", geometry: "Layered flat parapet and shallow roof cap" },
    { id: "roof-service-rooms", name: "Pale rooftop service blocks", geometry: "Few low rectangular roof boxes placed inside the source outline" },
  ],
  facade: [
    { id: "floor-slab-bands", name: "Seven repeated floor datums", geometry: "Seven shallow full-footprint slab bands" },
    { id: "balcony-window-grid", name: "Window and balcony bay grid", geometry: "Repeated panes, balcony ledges and rail lines along long facades" },
    { id: "brick-stair-cores", name: "Warm red vertical core fields", geometry: "Repeated vertical brick-colored facade strips" },
    { id: "parapet-tile-seams", name: "Roof parapet and tile seams", geometry: "Shallow repeated edge lines" },
  ],
  lobby: [
    { id: "round-inner-lobby", name: "Rounded lobby visual cue", geometry: "Shallow semicircular glazed display mass; not a verified entrance" },
  ],
  micro: [
    { id: "window-mullions", name: "Window mullion rhythm", geometry: "Thin vertical glazing dividers" },
    { id: "balcony-rails", name: "Balcony rail lines", geometry: "Paired horizontal rails and sparse posts" },
    { id: "roof-vent-bars", name: "Roof vent cue", geometry: "Sparse low bars on roof service blocks" },
    { id: "lobby-frame-ribs", name: "Lobby frame ribs", geometry: "Repeated vertical supports on rounded lobby" },
  ],
};
spec.targetName = "友苑宿舍楼群";
spec.targetId = "osm-way-313039031";
spec.sourceImage = "CampusOS_Codex_完整设计文档_v2/assets/source_maps/广外地图/友苑.png";
spec.referenceCamera = { solved: false, fovDegrees: 40, aspect: 1271 / 429, orientation: { yaw: 0, pitch: 0, roll: 0 }, positionHint: [0, 0, 3], note: "Uncalibrated aerial reference; no photo projection or texture bake is used." };
spec.suitability = "conditional";
spec.scores = { object_isolation: 2, silhouette_readability: 3, depth_inference: 2, primitive_decomposition: 3, material_procedurality: 2, occlusion_risk: 2, interaction_fit: 3 };
spec.preSpecAssessment = assessment.preSpecAssessment;
spec.qualityContract = assessment.qualityContract;
spec.qualityTargets = {
  mustMatch: ["canonical 22-vertex connected footprint", "seven-storey facade rhythm as a visual estimate", "pale tile, red core, blue-gray glass and flat roof palette", "2.5D and 3D map asset modes"],
  niceToHave: ["shallow rounded lobby display cue", "small stepped rooftop service rooms"],
  reviewViewpoints: ["front oblique view", "opposite oblique view", "high roof view", "top-down footprint view"],
};
spec.componentTree = [
  component("root", "友苑连接式宿舍楼群", "macro", null, "tile", feats.shell, { width: 133, height: 21, depth: 110 }, ["full-object", "roof-plan"]),
  component("north-wing", "北侧长翼", "macro", "root", "tile", [{ id: "north-wing-envelope", name: "北侧长翼外墙", geometry: "Connected segment of the source outer shell" }], { width: 103, height: 21, depth: 16 }),
  component("central-wing", "中部连接翼", "macro", "root", "tile", [{ id: "central-spine", name: "中部连接脊", geometry: "Narrow connecting section preserving the GIS orthogonal turn" }], { width: 47, height: 21, depth: 34 }),
  component("south-wing", "南侧横向翼", "macro", "root", "brick", [{ id: "south-wing-envelope", name: "南侧横向翼外墙", geometry: "Connected southern bar of the source outline" }], { width: 61, height: 21, depth: 15 }),
  component("roof-system", "平屋顶与设备小体量", "meso", "root", "roof", feats.roof, { width: 133, height: 3.1, depth: 110 }),
  component("facade-system", "重复楼层与阳台立面", "meso", "root", "tile", feats.facade, { width: 133, height: 20.3, depth: 110 }),
  component("window-system", "蓝灰玻璃窗格", "meso", "facade-system", "glass", feats.micro.slice(0, 1), { width: 3.4, height: 1.2, depth: 0.2 }),
  component("balcony-system", "外廊阳台栏杆", "meso", "facade-system", "metal", feats.micro.slice(1, 2), { width: 4.5, height: 1.3, depth: 1.0 }),
  component("brick-core-system", "红砖楼梯核心", "meso", "facade-system", "brick", [{ id: "brick-core-panels", name: "重复红砖核心面", geometry: "Vertical warm-red strips at broad facade intervals" }], { width: 2.3, height: 20.3, depth: 0.22 }),
  component("lobby-system", "圆弧入口大厅提示", "meso", "root", "glass", feats.lobby, { width: 9, height: 4.5, depth: 1.2 }, ["full-object", "roof-plan"]),
  component("floor-band-system", "七层水平楼板线", "meso", "root", "concrete", [feats.facade[0]], { width: 133, height: 20.3, depth: 110 }),
  component("parapet-system", "屋檐女儿墙线脚", "meso", "roof-system", "concrete", [feats.facade[3]], { width: 133, height: 0.4, depth: 110 }),
];
spec.materials = Object.entries(palettes).map(([id, palette]) => ({
  id,
  name: ({ tile: "浅色外墙砖", brick: "暖红砖饰面", glass: "蓝灰玻璃", metal: "栏杆金属", balcony: "阳台混凝土", roof: "浅色屋面", roofDark: "深色屋顶构件", concrete: "浅灰混凝土" })[id],
  type: "standard",
  shaderModel: "MeshStandardMaterial; image-free campus-map approximation",
  baseColor: palette.dominant,
  color: palette.dominant,
  albedo: { dominant: palette.dominant, secondary: [palette.secondary], samplingNotes: "Qualitative color family observed under daylight; exact color is uncalibrated." },
  colorVariation: { palette: [palette.dominant, palette.secondary], pattern: "broad architectural material zones", amplitude: 0.04, heightCorrelation: 0.0 },
  roughness: { base: id === "glass" ? 0.52 : 0.9, variation: 0.04, map: "none; map-scale material only", localResponse: "broad material zones are separated by geometry and instance material" },
  metalness: { base: id === "metal" ? 0.16 : 0, variation: 0 },
  normal: { pattern: "none", strength: 0, scale: 1, space: "tangent" },
  bump: { pattern: "none", amplitude: 0, scale: 1 },
  displacement: { pattern: "none", amplitude: 0, scale: 1, silhouetteAffects: false },
  ambientOcclusion: { cavityStrength: 0.1, contactShadowBias: 0.2, notes: "No baked AO map; runtime geometry depth and map shadowing provide the display cue." },
  wear: { edgeWear: 0, scratches: [], chips: [] },
  dirt: { amount: 0, cavityBias: 0, color: "#4c4038" },
  localOverrides: id === "tile" ? [{ id: "warm-red-core-regions", material: "brick", evidenceRefs: ["full-object"], note: "Brick color is assigned to the vertical stair/core fields in the builder." }] : [],
  qualityTier: "utility",
  notes: "No photo-derived texture is shipped; broad color and roughness values are approximate and optimized for consistent campus-map shading.",
}));
spec.repetitionSystems = [
  { id: "seven-floor-datums", name: "Seven floor datums", pattern: "vertical-repeat", material: "concrete", instances: 7, buildsGeometry: true, geometry: { primitive: "extrude", riseMeters: 2.9, thicknessMeters: 0.095 }, evidenceRefs: ["full-object"] },
  { id: "window-bays", name: "Window bays", pattern: "facade-edge-repeat", material: "glass", instances: "edge length divided by approx. 3.45 m", buildsGeometry: true, geometry: { primitive: "plane-card", estimatedBaySpacingMeters: 3.45 }, evidenceRefs: ["full-object"] },
  { id: "balcony-rails", name: "Balcony rails and posts", pattern: "long-facade-repeat", material: "metal", instances: "one per long facade per visible floor; post interval approx. 4.5 m", buildsGeometry: true, geometry: { primitive: "instanced-cluster", postIntervalMeters: 4.5 }, evidenceRefs: ["full-object"] },
  { id: "brick-core-panels", name: "Brick stair/service cores", pattern: "vertical-bay-repeat", material: "brick", instances: "one to three per facade edge according to length", buildsGeometry: true, geometry: { primitive: "instanced-cluster", heightMeters: 20.3 }, evidenceRefs: ["full-object"] },
];
spec.featureReviewTargets = [
  { id: "outline", name: "Connected orthogonal footprint", tier: "critical", passIds: ["blockout"], minimumScore: 0.8, mustPass: true, componentRefs: ["root", "north-wing", "central-wing", "south-wing"], evidenceRefs: ["roof-plan"] },
  { id: "floor-rhythm", name: "Seven-storey balcony and window rhythm", tier: "critical", passIds: ["structural-pass", "form-refinement"], minimumScore: 0.78, mustPass: true, componentRefs: ["facade-system", "window-system", "balcony-system"], evidenceRefs: ["full-object"] },
  { id: "brick-cores", name: "Warm-red vertical core bands", tier: "important", passIds: ["form-refinement"], minimumScore: 0.7, mustPass: false, componentRefs: ["brick-core-system"], evidenceRefs: ["full-object"] },
  { id: "roof", name: "Stepped flat roof blocks", tier: "important", passIds: ["form-refinement"], minimumScore: 0.7, mustPass: false, componentRefs: ["roof-system", "parapet-system"], evidenceRefs: ["roof-plan", "full-object"] },
  { id: "lobby", name: "Rounded lobby display cue", tier: "important", passIds: ["form-refinement"], minimumScore: 0.65, mustPass: false, componentRefs: ["lobby-system"], evidenceRefs: ["full-object"] },
];
spec.viewEvidence = [
  { id: "full-object", view: "front-oblique-aerial", imageRegion: { x: 0, y: 0, width: 1, height: 1, units: "normalized" }, observations: ["pale tiled walls", "warm-red vertical facade fields", "repeated balcony/window bands", "flat roof and rounded lower lobby"], confidence: 0.8 },
  { id: "roof-plan", view: "top-down-satellite", imageRegion: { x: 0, y: 0, width: 1, height: 1, units: "normalized" }, observations: ["connected angular roof wings", "several visible open gaps", "exact inner-gap boundaries are not measurable"], confidence: 0.62 },
];
spec.coordinateFrame = { front: "front direction is visually inferred from the supplied oblique image; compass bearing is unverified", up: "positive Y", scaleReference: "local meters from the source place coordinate; 7 stories / 21 m is a visual estimate" };
spec.lightingFromPhoto = [
  { role: "key light", direction: "soft daylight from the upper-left in the facade reference", color: "neutral daylight", intensity: "high diffuse" },
  { role: "fill light", direction: "sky/environment fill", color: "cool-neutral", intensity: "medium" },
  { role: "environment light", direction: "broad outdoor skylight", color: "neutral blue-gray", intensity: "low to medium" },
  { role: "display policy", exposure: "map renderer controlled", toneMapping: "MapLibre/Three renderer default", background: "campus basemap", contactShadow: "soft contact shadow and ground shadow from the map renderer and geometry occlusion; no baked photo lighting" },
];
spec.lookDevTargets = {
  qualityPriority: "geometry-first-campus-map",
  materialPass: { albedoPaletteRequired: true, roughnessVariationRequired: true, normalOrBumpRequired: false, localOverridesRequired: true, independentMapChannels: [], referencePbrExtraction: { requiredWhenSourceImagePresent: false, targetThreshold: 0.7, stopOnLowConfidence: false, acceptedLimitation: "Uncalibrated aerial references do not provide reliable PBR; the campus-map publisher rejects image/texture payloads, so qualitative image-free MeshStandardMaterial is used." } },
  lightingPass: { requiredTerms: ["key light", "fill light", "environment light", "exposure", "tone mapping", "contact shadow"], mustAvoid: ["baked photo lighting", "invented measured color values"] },
  screenshotReview: ["Compare top-down shell outline against canonical GIS vertices.", "Compare front oblique facade bands and brick-core rhythm.", "Compare rooftop blocks against the satellite photo without asserting unseen interior measurements.", "Confirm all map assets remain image- and texture-free."],
};
spec.proceduralStrategy = [
  "Use canonical 22-vertex WGS84 outer ring projected to local meters; keep it unchanged in the source GIS.",
  "Extrude one connected shell to an estimated 21 m roof datum and use seven repeated facade bands.",
  "Instance windows, balcony rails, brick cores, parapet seams and rooftop service blocks from the same source ring edges.",
  "Keep image-inferred lobby as a small display-only rounded mass; do not register it as an entrance.",
  "Use image-free MeshStandardMaterial colors; no uncalibrated photos or generated textures enter the formal GLBs.",
];
spec.assumptions = ["Seven visible facade bands are treated as approximately seven floors.", "Main building height is approximately 21 m; rooftop service blocks can extend slightly above it.", "The rounded lobby and facade placements are display-level visual estimates."];
spec.sculptPipeline = { ...spec.sculptPipeline, currentPass: "blockout", completedPasses: [], lastCompletedPass: "", blockedReason: "Awaiting first rendered review of the GIS-faithful footprint and facade volume.", nextRequiredEvidence: ["2.5D and 3D browser renders", "top-down outline review", "front and orbit views", "documented score/critique before continuing"] };

await writeFile(base + "object-sculpt-spec.json", JSON.stringify(spec, null, 2) + "\n");
