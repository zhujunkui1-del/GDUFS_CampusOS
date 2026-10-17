// Sanitized summaries only. Raw Playwright state/traces and credentials stay ignored.
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const unit = read("test-results/s3-unit.json");
assert.equal(unit.numFailedTests, 0);
const browser = (file, description) => {
  const result = read(file);
  assert.equal(result.stats.unexpected, 0, description);
  assert.equal(result.errors.length, 0, description);
  return {
    description,
    passed: result.stats.expected,
    skipped: result.stats.skipped,
    failed: result.stats.unexpected,
    flaky: result.stats.flaky,
    startedAt: result.stats.startTime,
    durationMs: result.stats.duration,
  };
};
const tests = [
  browser(
    ".map-tools/s3-a/final-chrome.json",
    "Local Chrome: map/Agent regression and Console, desktop + mobile viewport",
  ),
  browser(
    ".map-tools/s3-a/regression-msedge.json",
    "Local Edge: map/Agent regression, desktop + mobile viewport",
  ),
  browser(
    ".map-tools/s3-a/console-chrome-final.json",
    "Final Worker Chrome: real isolated Console APIs, desktop + mobile viewport",
  ),
  browser(
    ".map-tools/s3-a/console-msedge-final.json",
    "Final Worker Edge: real isolated Console APIs, desktop + mobile viewport",
  ),
  browser(
    ".map-tools/s3-a/cloud-key-chrome.json",
    "Real HTTPS Chrome: administrator key/session/refresh/logout, anonymous gate, map + all five Skills",
  ),
  browser(
    ".map-tools/s3-a/cloud-key-msedge.json",
    "Real HTTPS Edge: administrator key/session/refresh/logout, anonymous gate, map + all five Skills",
  ),
  browser(
    ".map-tools/s3-a/live-model.json",
    "Real HTTPS Chrome desktop: DeepSeek query, details and two acknowledged map actions",
  ),
];
const before = read("docs/verification/s3-a/model-budget-before.json"),
  after = read("docs/verification/s3-a/model-budget-after.json");
const live = read(
  "docs/verification/s3-a/model/chrome-desktop-details-live.json",
);
const cloud = read("docs/verification/s3-a/preview-after.json");
const percentile = (values, fraction) =>
  values.sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * fraction) - 1)
  ] ?? null;
const records = read("docs/verification/s3-a/cloud-invocations.json").records;
const beforeStatic = read(
  "docs/verification/s3-a/cloud-invocations-before-static.json",
).records;
const keyRecords = read(
  "docs/verification/s3-a/key-mode-invocations.json",
).records;
const cpuSummary = (values) => {
  const cpu = values
    .map((x) => x.cpuTimeMs)
    .filter((x) => typeof x === "number");
  return {
    samples: cpu.length,
    p50Ms: percentile([...cpu], 0.5),
    p95Ms: percentile([...cpu], 0.95),
    over10Ms: cpu.filter((x) => x > 10).length,
  };
};
const paths = [...new Set(records.map((x) => x.path))]
  .filter(Boolean)
  .map((path) => {
    const rows = records.filter((x) => x.path === path),
      cpu = rows.map((x) => x.cpuTimeMs).filter((x) => typeof x === "number");
    return {
      path,
      requests: rows.length,
      cpuP50Ms: percentile([...cpu], 0.5),
      cpuP95Ms: percentile([...cpu], 0.95),
      cpuOver10Ms: cpu.filter((x) => x > 10).length,
      exceededResources: rows.filter((x) => /exceed/i.test(x.outcome)).length,
      exceptions: rows.reduce((n, x) => n + x.exceptionCount, 0),
      statuses: [...new Set(rows.map((x) => x.status))],
    };
  });
const result = {
  recordedAt: new Date().toISOString(),
  baseline: "b71e29e",
  worker: "campusos-preview",
  url: "https://campusos-preview.zhujunkui1.workers.dev",
  deploymentId: cloud.deploymentId,
  versions: cloud.activeVersions,
  typecheck: "passed",
  lint: "passed",
  unit: {
    passed: unit.numPassedTests,
    failed: unit.numFailedTests,
    files: unit.testResults.length,
  },
  migrations: read("docs/verification/s3-a/database-tests.json"),
  previewMigration: "passed, original user content counts preserved",
  import: read("docs/verification/s3-a/import/preview-import.json"),
  productionBuild:
    "Next.js + OpenNext passed via mandatory sanitized deploy:preview",
  artifactSecurity: read("docs/verification/s3-a/security-integrity.json"),
  browserTests: tests,
  cloudAdminAuthentication:
    "CONFIGURED_AND_VERIFIED: explicit HTTPS admin_key, exact origin, revocable D1 session; Access not used",
  publicAdminAuthenticatedOperations:
    "Verified: catalog/detail reads, refresh recovery, logout, revoked-cookie replay rejection, CSRF/cross-origin denial. Positive source/content mutations tested only in isolated local D1; no fabricated cloud articles or source verification.",
  consoleAuthSecrets: cloud.bindings
    .filter((x) => x.name.startsWith("CONSOLE_"))
    .map((x) => x.name),
  adminEmailOwnershipVerified: false,
  consoleCloudState: cloud.consoleState,
  model: {
    testedWorkerVersion: read(
      "docs/verification/s3-a/preview-initial-deployment.json",
    ).activeVersions,
    capturedCpu: cpuSummary(
      beforeStatic.filter((x) => x.path === "/api/agent/chat"),
    ),
    diagnosticRequests: 3,
    cloudAgentRuns: live.records.length,
    cloudUpstreamRequests: live.records.reduce(
      (n, x) => n + x.result.metrics.requests,
      0,
    ),
    cloudTokens: live.records.reduce(
      (n, x) => n + x.result.metrics.totalTokens,
      0,
    ),
    diagnosticTokenUsage: "not recorded by existing verifier",
    tools: live.records[0].tools,
    actions: live.records[0].actions,
    firstTextMs: live.records[0].result.metrics.timings.firstTextMs,
    serverElapsedMs: live.records[0].result.metrics.timings.serverElapsedMs,
    approximateStageBalanceDecreaseCny: Math.max(
      0,
      after.accountBalanceDecreaseCny - before.accountBalanceDecreaseCny,
    ),
    cumulativeApprovedBudgetDecreaseCny: after.accountBalanceDecreaseCny,
    totalApprovedBudgetCny: 1,
    budgetInvoice: false,
  },
  controlledCloudSample: {
    consoleRootBefore: cpuSummary(
      beforeStatic.filter((x) => x.path === "/admin"),
    ),
    consoleRootAfter: cpuSummary(records.filter((x) => x.path === "/admin")),
    invocations: records.length,
    paths,
    fullIsolateMemory: "not measured",
    longTermCapacity: "not verified",
    authenticatedConsoleCpu:
      "See keyModeSample; mixed HTTP methods per path, not per-function attribution",
  },
  keyModeSample: {
    invocations: keyRecords.length,
    exceededResources: keyRecords.filter((x) => /exceed/i.test(x.outcome))
      .length,
    paths: [...new Set(keyRecords.map((x) => x.path))]
      .filter(
        (path) =>
          path?.startsWith("/api/admin/") || path === "/api/console-auth",
      )
      .map((path) => ({
        path,
        ...cpuSummary(keyRecords.filter((x) => x.path === path)),
        statuses: [
          ...new Set(
            keyRecords.filter((x) => x.path === path).map((x) => x.status),
          ),
        ],
      })),
    scope:
      "Controlled read/login/logout and rejected mutations; positive content mutations not run in cloud",
  },
  realPhone: "NOT_TESTED; viewport only",
  collectionEnabled: false,
  ragIndexEnabled: false,
  productionResourcesChanged: false,
  paidPlanActivated: false,
};
writeFileSync(
  "docs/verification/s3-a/acceptance-results.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    unit: result.unit,
    browsers: tests.map(({ description, passed, skipped, failed }) => ({
      description,
      passed,
      skipped,
      failed,
    })),
    previewSources: cloud.registry,
    cloudAdminAuthentication: result.cloudAdminAuthentication,
    exceededResources: paths.reduce((n, x) => n + x.exceededResources, 0),
    model: result.model,
  }),
);
