// Research deliverables only: no cloud queries, credentials, source fetching or deployment.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const reports = [
  "S3_WECHAT_OPEN_SOURCE_COMPARISON.md",
  "S3_WECHAT_POC_PLAN.md",
  "S3_THU_PUSH_ADAPTATION.md",
  "S3_SOURCE_PIPELINE_RECOMMENDATION.md",
].map((x) => "docs/research/" + x);
const documents = [
  ...reports,
  ...[
    "README.md",
    "ab-audit.md",
    "werss-helper-audit.md",
    "thu-algorithms-audit.md",
  ].map((x) => "docs/research/s3-wechat/" + x),
];
const brokenLinks = [];
let links = 0;
for (const file of documents) {
  for (const match of readFileSync(file, "utf8").matchAll(/\]\(([^\s)]+)\)/g)) {
    const href = match[1].split("#")[0];
    if (!href || /^(?:https?:|mailto:|\/)/.test(href)) continue;
    links++;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(href))))
      brokenLinks.push({ file, href });
  }
}
const matrix = [
  ...readFileSync(reports[0], "utf8").matchAll(/^\|\s*(\d+)\s+/gm),
].map((x) => +x[1]);
const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const runtimeChanged = changed.filter((x) =>
  /^(?:src\/|public\/|migrations\/)|^(?:package(?:-lock)?\.json|wrangler\.jsonc|open-next\.config\.ts|next-env\.d\.ts)$/.test(
    x,
  ),
);
const read = (x) =>
  JSON.parse(readFileSync("docs/verification/s3-wechat-resumed/" + x, "utf8"));
const ab = read("ab-offline-probes.json"),
  w = read("werss-helper-offline.json"),
  t = read("thu-offline.json"),
  c = read("campus-summary.json");
const summary = {
  checkedAt: new Date().toISOString(),
  baseline: "206e01d",
  reports,
  linksChecked: links,
  brokenLinks,
  matrixTwentyCapabilities:
    matrix.join(",") === Array.from({ length: 20 }, (_, i) => i + 1).join(","),
  runtimeChanged,
  abAssertions: ab.summary,
  werssChecks: {
    total: w.total,
    passed: w.passed,
    gatewayIsResearchOnly: !w.gatewayImplementedInCampusOS,
  },
  thu: t.summary,
  campus: c,
  scope: {
    liveWechatArticles: 0,
    modelCalls: 0,
    smtpSends: 0,
    cloudD1Reads: 0,
    cloudD1Writes: 0,
    migrations: false,
    deployment: false,
    newResources: false,
  },
};
summary.researchComplete =
  !brokenLinks.length &&
  summary.matrixTwentyCapabilities &&
  !runtimeChanged.length &&
  ab.summary.assertions_failed === 0 &&
  w.passed === 26 &&
  t.summary.upstreamFailures === 0 &&
  t.summary.upstreamErrors === 0 &&
  t.summary.probesCompleted === 17 &&
  c.reproductionPassed;
summary.productionWechatOrS3CAccepted = false;
mkdirSync("docs/verification/s3-wechat-resumed", { recursive: true });
writeFileSync(
  "docs/verification/s3-wechat-resumed/research-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    researchComplete: summary.researchComplete,
    brokenLinks,
    links,
    runtimeChanged,
    campusStrictFailures: c.knownContractFailures,
  }),
);
if (!summary.researchComplete) process.exitCode = 1;
