// Differential correctness/performance probe. Uses only public campus points.
// Node timings are local probes, never substituted for Cloudflare CPU metrics.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import assert from "node:assert/strict";
const dir = "docs/verification/s2-e-cpu";
mkdirSync(".map-tools/cpu", { recursive: true });
mkdirSync(dir, { recursive: true });
const path = "src/features/campus-map/data/local-routing.ts";
const baseline = execFileSync("git", ["show", "a3ab24b:" + path], {
  encoding: "utf8",
});
const options = {
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
  tsconfig: "tsconfig.json",
};
await build({
  ...options,
  stdin: {
    contents: baseline,
    loader: "ts",
    resolveDir: resolve("src/features/campus-map/data"),
  },
  outfile: "test-results/cpu-equivalence-baseline.cjs",
});
await build({
  ...options,
  entryPoints: [path],
  outfile: "test-results/cpu-equivalence-current.cjs",
});
const require = createRequire(import.meta.url);
const old = require(resolve("test-results/cpu-equivalence-baseline.cjs"));
const current = require(resolve("test-results/cpu-equivalence-current.cjs"));
const metadata = JSON.parse(
  readFileSync("src/lib/server/maps/public-walking-attachments.json", "utf8"),
);
assert.throws(() =>
  current.loadPublicWalkingAttachments({
    ...metadata,
    networkVersion: "stale",
  }),
);
current.loadPublicWalkingAttachments(metadata);
await build({
  ...options,
  stdin: {
    contents:
      'export {campusData} from "@/features/campus-map/data/campus";export {toGcj02} from "@/features/campus-map/adapters/online-services";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: "test-results/cpu-equivalence-points.cjs",
});
const { campusData, toGcj02 } = require(
  resolve("test-results/cpu-equivalence-points.cjs"),
);
const all = campusData.places;
const named = [
  "南苑7栋",
  "图书馆",
  "语心桥",
  "北苑5栋",
  "教学楼A栋",
  "博雅园",
  "风采园",
];
const places = named
  .map((name) => all.find((p) => p.name.includes(name)))
  .filter(Boolean);
const point = (p) => ({
  name: p.name,
  placeId: p.id,
  coordinateGcj02: toGcj02(p.coordinate),
  zone: p.zone,
  source: "campus_place",
});
const pairs = places.slice(1).flatMap((p) => [
  [point(places[0]), point(p)],
  [point(p), point(places[0])],
]);
for (const place of all) {
  pairs.push(
    [point(places[0]), point(place)],
    [point(place), point(places[0])],
  );
}
// Simulated public campus coordinate, not a person's GPS. Exercise the uncached
// private-origin branch and the unchanged dashed approach semantics.
pairs.push([
  { ...point(places[0]), placeId: undefined, source: "device_location" },
  point(places[1]),
]);
const results = [];
const strip = (route) => {
  if (!route) return null;
  const copy = { ...route };
  delete copy.id;
  return copy;
};
for (const [a, b] of pairs) {
  const startedOld = performance.now(),
    expected = old.planLocalRoute(a, b);
  const oldMs = performance.now() - startedOld;
  const startedCurrent = performance.now(),
    actual = current.planLocalRoute(a, b);
  const currentMs = performance.now() - startedCurrent;
  assert.deepEqual(strip(actual), strip(expected));
  results.push({
    start: a.name,
    end: b.name,
    deviceOriginSimulated: a.source === "device_location",
    available: !!actual,
    distanceMeters: actual?.distanceMeters,
    oldLocalWallMs: oldMs,
    newLocalWallMs: currentMs,
  });
}
const evidence = {
  at: new Date().toISOString(),
  baseline: "a3ab24b",
  localOnly: true,
  exactEqualityExcludingRandomRouteId: true,
  cases: results,
};
writeFileSync(
  `${dir}/route-equivalence.json`,
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    compared: results.length,
    exactMatch: true,
    localOnly: true,
  }),
);
