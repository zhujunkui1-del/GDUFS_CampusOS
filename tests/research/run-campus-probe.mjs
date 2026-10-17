// Verify reproduction of known contract failures without changing the strict assertions.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const output = "docs/verification/s3-wechat-resumed/campus-offline.json";
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
  result.status === 1 &&
  raw.numTotalTests === 10 &&
  raw.numPassedTests === 8 &&
  failures.length === 2 &&
  failures.every(
    (test) =>
      /R0[12] /.test(test.title) &&
      test.failureMessages.some((message) =>
        message.includes("expected null to be"),
      ),
  );
const summary = {
  checkedAt: new Date().toISOString(),
  scope: "offline research diagnostics, no network or cloud writes",
  tests: raw.numTotalTests,
  passed: raw.numPassedTests,
  knownContractFailures: failures.map((t) => t.title),
  strictAssertionsUnchanged: true,
  reproductionPassed: reproduced,
  campusContractAcceptancePassed: false,
  explanation:
    "R01/R02 require exact times for Chinese 日HH:mm without whitespace; current parser returns null. These remain failed requirements, not fixed or approved.",
};
writeFileSync(
  "docs/verification/s3-wechat-resumed/campus-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary));
if (!reproduced) process.exitCode = 1;
