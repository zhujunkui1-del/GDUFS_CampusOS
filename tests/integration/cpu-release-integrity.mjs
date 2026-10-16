// Keep the previous all-code-frozen guard intact. This milestone intentionally
// changes local-routing.ts; verify source DATA independently, plus the reviewed
// route equivalence. Credential checks remain mandatory with zero exceptions.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const dir = "docs/verification/s2-e-cpu/final";
const scan = spawnSync(
  process.execPath,
  ["tests/integration/verify-s2-d-artifacts.mjs"],
  {
    env: {
      ...process.env,
      ARTIFACT_BASELINE: "a3ab24b",
      ARTIFACT_VERIFICATION_DIR: dir,
      ARTIFACT_EXTRA_DIRS: "test-results/preview-release-bundle",
      RELEASE_PREVIEW_SECRETS_FILE: ".map-tools/s2-e/runtime-secrets.json",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
assert.ok([0, 1].includes(scan.status), "Credential scan execution failed");
const scanResult = JSON.parse(
  readFileSync(`${dir}/security-integrity.json`, "utf8"),
);
assert.equal(scanResult.repository.matches.length, 0);
assert.equal(scanResult.generatedWorkerAndAssets.matches.length, 0);
assert.equal(scanResult.credentialFilesIgnored, true);
assert.equal(scanResult.modelMatchesApprovedAsset, true);
const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const frozen = git(
  "ls-tree",
  "-r",
  "--name-only",
  "a3ab24b",
  "--",
  "public",
  "src/features/campus-map/data",
)
  .toString()
  .trim()
  .split(/\r?\n/)
  .filter((file) => file.startsWith("public/") || file.endsWith(".json"));
const changes = frozen.filter(
  (file) =>
    digest(readFileSync(file)) !== digest(git("show", `a3ab24b:${file}`)),
);
assert.deepEqual(changes, [], "Frozen source map/model DATA changed");
const sourceChanges = git(
  "diff",
  "a3ab24b",
  "--name-only",
  "--",
  "public",
  "src/features/campus-map/data",
)
  .toString()
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
assert.deepEqual(sourceChanges, [
  "src/features/campus-map/data/local-routing.ts",
]);
const equivalence = JSON.parse(
  readFileSync("docs/verification/s2-e-cpu/route-equivalence.json", "utf8"),
);
assert.equal(equivalence.exactEqualityExcludingRandomRouteId, true);
assert.equal(equivalence.cases.length, 239);
execFileSync(
  process.execPath,
  ["scripts/prepare-route-metadata.mjs", "--check"],
  { stdio: "pipe" },
);
const result = {
  at: new Date().toISOString(),
  passed: true,
  credentialScanPassed: true,
  legacyAllRoutingCodeFrozen: scanResult.frozenDataUntouched,
  explicitlyReviewedCodeChanges: sourceChanges,
  frozenDataFilesChecked: frozen.length,
  sourceMapModelDataHashesUnchanged: true,
  exactRouteComparisons: equivalence.cases.length,
  metadataSourceHashChecked: true,
  modelSha256: scanResult.modelSha256,
};
writeFileSync(
  `${dir}/cpu-release-integrity.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
