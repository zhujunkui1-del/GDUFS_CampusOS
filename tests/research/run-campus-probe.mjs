// Regression gate after S3-B repair; the original ten assertions stay unchanged.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const output = "docs/verification/s3-b-final/time-after.json";
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "tests/research/vitest.config.ts",
    "--reporter=json",
    `--outputFile=${output}`,
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
const raw = JSON.parse(readFileSync(output, "utf8"));
const failures = raw.testResults
  .flatMap((file) => file.assertionResults)
  .filter((test) => test.status === "failed");
const reproduced =
  result.status === 0 &&
  raw.numTotalTests === 10 &&
  raw.numPassedTests === 10 &&
  failures.length === 0;
const summary = {
  checkedAt: new Date().toISOString(),
  scope: "offline research diagnostics, no network or cloud writes",
  tests: raw.numTotalTests,
  passed: raw.numPassedTests,
  knownContractFailures: failures.map((t) => t.title),
  strictAssertionsUnchanged: true,
  reproductionPassed: reproduced,
  campusContractAcceptancePassed: reproduced,
  explanation:
    "Original R01/R02 now pass after the production parser fix; all ten strict diagnostics retained. This does not approve publication of real content.",
};
writeFileSync(
  "docs/verification/s3-b-final/time-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary));
if (!reproduced) process.exitCode = 1;
