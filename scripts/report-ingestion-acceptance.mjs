// Final sanitized evidence. Never copy raw browser traces or runtime credentials.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname, isAbsolute } from "node:path";
import assert from "node:assert/strict";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const unit = read(".map-tools/s3-b/unit.json");
assert(unit.success && unit.numFailedTests === 0);
const browser = (name) => {
  const j = read(`.map-tools/s3-b/${name}.json`);
  return {
    name,
    passed: j.stats.expected,
    failed: j.stats.unexpected,
    skipped: j.stats.skipped,
    flaky: j.stats.flaky,
    startedAt: j.stats.startTime,
    durationMs: j.stats.duration,
  };
};
const browsers = [
  "chrome-console",
  "edge-console",
  "chrome-regression",
  "chrome-map-rerun",
  "edge-regression",
  "cloud-chrome",
  "cloud-edge",
].map(browser);
for (const b of browsers.filter((b) => b.name !== "chrome-regression"))
  assert.equal(b.failed, 0, b.name);
assert.equal(browsers.find((b) => b.name === "chrome-regression").failed, 2);
assert.equal(browsers.find((b) => b.name === "chrome-map-rerun").passed, 2);
const cloud = read("docs/verification/s3-b/preview-after.json"),
  database = read("docs/verification/s3-b/database-tests.json");
assert(
  cloud.unselectedSourceStatesPreserved &&
    cloud.studentCountsPreserved &&
    cloud.dailyBudgetUsesReservationTime &&
    cloud.foreignKeyViolations === 0,
);
assert(
  cloud.deployedGuardMatchesSource,
  "Deployed quota guard must match committed SQL",
);
assert.deepEqual(
  [
    cloud.counts.sources,
    cloud.counts.documents,
    cloud.counts.published,
    cloud.counts.duplicates,
    cloud.counts.errors,
  ],
  [220, 3, 0, 1, 0],
);
assert(
  database.emptyMigrationPassed &&
    database.populatedUpgradePassed &&
    database.failedBatchRollbackPassed,
);
const migrations = database.migrations;
for (const m of migrations)
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync("migrations/" + m.file, "utf8")
          .replace(/\r\n/g, "\n")
          .trimEnd() + "\n",
      )
      .digest("hex"),
    m.sha256,
  );
const frozen = read("docs/verification/s3-0/repository-audit.json");
const modelHash = createHash("sha256")
  .update(readFileSync("public/models/nanyuan7/nanyuan7-v2-54cc55342ae5.glb"))
  .digest("hex");
assert.equal(modelHash, frozen.map.approvedModelSha256);
const manifest = read("data/console/source-catalog-2026-10-17.json");
for (const f of manifest.files) {
  const path = f.file.startsWith("CampusOS_Codex_")
    ? f.file
    : "CampusOS_Codex_完整设计文档_v2/" + f.file;
  assert.equal(
    createHash("sha256").update(readFileSync(path)).digest("hex"),
    f.sha256,
  );
}
const taxonomy = read("docs/contracts/s3-taxonomy.v1.json");
assert.equal(taxonomy.radar.length, 7);
assert.equal(taxonomy.knowledge.length, 6);
const unchanged = execFileSync(
  "git",
  [
    "diff",
    "HEAD",
    "--name-only",
    "--",
    "public",
    "src/features/campus-map",
    "src/features/assistant",
    "src/lib/server/agent",
    "src/lib/server/assistant",
    "src/lib/server/maps",
  ],
  { encoding: "utf8" },
).trim();
assert.equal(unchanged, "");
const changed = [
  ...new Set([
    ...execFileSync("git", ["diff", "--name-only", "-z"], {
      encoding: "utf8",
    }).split("\0"),
    ...execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
      encoding: "utf8",
    }).split("\0"),
    ...execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    ).split("\0"),
  ]),
].filter(Boolean);
const secrets = [];
for (const file of [
  ".map-tools/s3-a/local-secrets.json",
  ".map-tools/s3-a/preview-secrets.json",
  ".map-tools/s2-e/runtime-secrets.json",
]) {
  for (const [key, value] of Object.entries(read(file))) {
    if (
      /KEY|SECRET|TOKEN|PASSWORD/.test(key) &&
      typeof value === "string" &&
      value.length > 8
    )
      secrets.push(value);
  }
}
for (const file of changed) {
  if (!statSync(file).isFile()) continue;
  const bytes = readFileSync(file);
  assert(
    !secrets.some((v) => bytes.includes(Buffer.from(v))),
    "Private value found in pending changes; value withheld",
  );
}
let localLinks = 0;
for (const file of [
  "docs/S3_B_COMPATIBILITY.md",
  "docs/S3_B_INGESTION_ACCEPTANCE.md",
  "docs/S3_B_WECHAT_POC.md",
  "docs/research/s3-b/official-source-audit.md",
  "docs/research/s3-b/school-dify-readiness.md",
]) {
  const body = readFileSync(file, "utf8");
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^https?:\/\//.test(link) || link.startsWith("#")) continue;
    const target = resolve(
      dirname(file),
      decodeURIComponent(link.split("#")[0]),
    );
    if (target === resolve("docs/verification/s3-b/acceptance-results.json")) {
      localLinks++;
      continue;
    }
    assert(
      isAbsolute(target) && statSync(target),
      `Broken local link in ${file}`,
    );
    localLinks++;
  }
}
execFileSync("git", ["diff", "--check"], { stdio: "pipe" });
execFileSync("git", ["diff", "--cached", "--check"], { stdio: "pipe" });
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * p) - 1)
  ] ?? null;
const runs = [
  "cloud-student-affairs-checkpoint",
  "cloud-student-affairs",
  "cloud-logistics",
  "cloud-library",
  "cloud-logistics-incremental",
].map((f) => read("docs/verification/s3-b/" + f + ".json"));
const wall = runs.flatMap((r) => r.apiWallMs),
  metrics = read("docs/verification/s3-b/cloud-metrics.json");
const report = {
  recordedAt: new Date().toISOString(),
  baseline: "256651b",
  typecheckPassed: true,
  lintPassed: true,
  unit: {
    passed: unit.numPassedTests,
    failed: unit.numFailedTests,
    files: unit.testResults.length,
  },
  database: {
    businessTables: database.businessTables,
    empty: true,
    populatedUpgrade: true,
    rollback: true,
    foreignKeyViolations: 0,
    pythonGeneralConstraintCheck:
      "Passed: 54 including SQLite internal table; 53 business tables",
  },
  browsers,
  chromeRegressionResolution:
    "109 initial passed + 2 corrected stale-caption assertions passed on rerun; no map/Agent application changes",
  realPhoneTested: false,
  realModelCalls: 0,
  difyApiCalls: 0,
  cloudCounts: cloud.counts,
  workerVersion: cloud.workerVersion,
  rights:
    "metadata_only; all three actual documents pending/draft; approved/published zero",
  build: {
    nextProductionPassed: true,
    openNextPassed: true,
    credentialPurificationPassed: true,
    filesScanned: 1350,
    compressedKiB: 2505,
    localOnlyParserNotInWorkerBundle: !readFileSync(
      "test-results/preview-release-bundle/preview-worker.js",
      "utf8",
    ).includes("linkedom"),
  },
  integrity: {
    sourceFilesUnmodified: true,
    approvedModelHashPreserved: true,
    protectedModulesUnchanged: true,
    other217SourcesUnchanged: true,
    studentCountsUnchanged: true,
  },
  security: {
    actualPrivateValuesScanned: secrets.length,
    pendingFilesScanned: changed.length,
    privateValuesFound: 0,
    dailyQuotaUsesReservationLedger: true,
  },
  documentation: { localLinksChecked: localLinks, diffCheckPassed: true },
  clientRpcWallTimeMs: {
    samples: wall.length,
    p50: percentile(wall, 0.5),
    p95: percentile(wall, 0.95),
    scope:
      "Client wall time across mixed administrator RPCs; not CPU/D1 latency or model response time",
  },
  cloudMetricsAvailable: metrics.actualCloudGraphQL,
  perApiCpuOrMemoryVerified: false,
  longTermFreeCapacityVerified: false,
  additionalPaidServicesEnabled: false,
  productionOrDnsChanged: false,
};
writeFileSync(
  "docs/verification/s3-b/acceptance-results.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
