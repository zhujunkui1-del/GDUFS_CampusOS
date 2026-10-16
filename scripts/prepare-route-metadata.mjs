// Explicit offline derivation of immutable public geometry. Never downloads map
// data. Normal builds only CHECK this artifact and fail closed when it is stale.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const inputs = [
  "src/features/campus-map/data/campus.json",
  "src/features/campus-map/data/campus.ts",
  "src/features/campus-map/data/owner-sports-label-review.json",
  "src/features/campus-map/data/walking-network.json",
  "src/features/campus-map/data/local-routing.ts",
  "src/features/campus-map/data/navigation-geometry.ts",
  "src/features/campus-map/data/route-progress.ts",
  "src/features/campus-map/data/geometry.ts",
  "src/features/campus-map/adapters/online-services.ts",
];
const hash = createHash("sha256");
for (const file of inputs) hash.update(file).update(readFileSync(file));
const sourceHash = hash.digest("hex");
const output = "src/lib/server/maps/public-walking-attachments.json";
if (process.argv.includes("--check")) {
  if (JSON.parse(readFileSync(output, "utf8")).sourceHash !== sourceHash)
    throw Error(
      "Public walking metadata is stale. Review the fixed map change and run npm run map:route-metadata.",
    );
  console.log("Fixed public walking metadata matches reviewed source hashes.");
} else {
  mkdirSync("test-results", { recursive: true });
  const bundle = "test-results/public-walking-metadata.cjs";
  await build({
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "ts",
      resolveDir: process.cwd(),
      contents: `
      export {planLocalRoute,publicWalkingAttachments} from "@/features/campus-map/data/local-routing";
      export {campusData} from "@/features/campus-map/data/campus";
      export {toGcj02} from "@/features/campus-map/adapters/online-services";`,
    },
    outfile: bundle,
  });
  const require = createRequire(import.meta.url);
  const {
    planLocalRoute,
    publicWalkingAttachments,
    campusData,
    toGcj02,
  } = require(resolve(bundle));
  const point = (place) => ({
    name: place.name,
    placeId: place.id,
    zone: place.zone,
    coordinateGcj02: toGcj02(place.coordinate),
    source: "campus_place",
  });
  const start = point(
    campusData.places.find((place) => place.id === "osm-way-312536955"),
  );
  for (const place of campusData.places) planLocalRoute(start, point(place));
  const metadata = { sourceHash, ...publicWalkingAttachments() };
  writeFileSync(output, JSON.stringify(metadata) + "\n");
  console.log(
    JSON.stringify({
      publicPlaces: Object.keys(metadata.entries).length,
      options: Object.values(metadata.entries).reduce(
        (n, rows) => n + rows.length,
        0,
      ),
      bytes: readFileSync(output).length,
      mapVersion: metadata.mapVersion,
      networkVersion: metadata.networkVersion,
      offline: true,
    }),
  );
}
