// Offline architecture/document audit; never reads secret values or calls a service.
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const retired = /\bdify\b|DifyDatasetRetriever|dify[_-]|[_-]dify/i;
const runtimeFiles = readdirSync("src", { recursive: true })
  .filter((p) => /\.(?:ts|tsx|js|mjs|json)$/.test(p))
  .map((p) => "src/" + p);
const configs = [
  "package.json",
  "wrangler.jsonc",
  "open-next.config.ts",
  "next.config.ts",
  ".env.example",
  ".dev.vars.example",
].filter(existsSync);
const runtimeHits = [...runtimeFiles, ...configs].filter((p) =>
  retired.test(readFileSync(p, "utf8")),
);
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const dependencyHits = Object.keys(lock.packages).filter((p) =>
  retired.test(p),
);
const plan = readFileSync("docs/S3_D_RETRIEVAL_PLAN.md", "utf8");
const criteria = [...plan.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) =>
  Number(m[1]),
);
const plannedOnly =
  ["KnowledgeRetriever", "D1KeywordRetriever"].every((x) => plan.includes(x)) &&
  plan.includes("尚无这两个实现");
const taxonomy = JSON.parse(
  readFileSync("docs/contracts/s3-taxonomy.v1.json", "utf8"),
);
const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "-z"], {
  encoding: "utf8",
}).split("\0");
const added = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0");
const documents = [
  ...new Set([
    "README.md",
    "AGENTS.md",
    "docs/DIFY_RETIREMENT.md",
    "docs/S3_D_RETRIEVAL_PLAN.md",
    "docs/S3_0_ARCHITECTURE_BASELINE.md",
    "docs/S3_0_DATA_MODEL.md",
    ...changed,
    ...added,
  ]),
].filter((p) => p.endsWith(".md"));
const missingLinks = [];
let linksChecked = 0;
for (const file of documents) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!href || /^(?:https?:|mailto:|app:|codex:|\/)/.test(href)) continue;
    linksChecked++;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(href))))
      missingLinks.push({ file, href });
  }
}
const migrationChanges = changed.filter((p) => p.startsWith("migrations/"));
const sourceChanges = changed.filter(
  (p) => p.startsWith("src/") || p.startsWith("public/"),
);
const report = {
  checkedAt: new Date().toISOString(),
  offline: true,
  runtimeFilesScanned: runtimeFiles.length,
  configFilesScanned: configs,
  runtimeHits,
  dependencyHits,
  retrievalImplementation: "planned_not_implemented",
  twelveCriteriaPresent: criteria.join(",") === "1,2,3,4,5,6,7,8,9,10,11,12",
  plannedOnly,
  taxonomyCategories: {
    radar: taxonomy.radar.length,
    knowledge: taxonomy.knowledge.length,
  },
  documentsChecked: documents.length,
  linksChecked,
  missingLinks,
  migrationChanges,
  sourceChanges,
  networkCalls: 0,
  modelCalls: 0,
  databaseWrites: 0,
  deployment: false,
};
report.passed =
  !runtimeHits.length &&
  !dependencyHits.length &&
  report.twelveCriteriaPresent &&
  plannedOnly &&
  !missingLinks.length &&
  !migrationChanges.length &&
  !sourceChanges.length &&
  taxonomy.radar.length === 7 &&
  taxonomy.knowledge.length === 6;
mkdirSync("docs/verification/dify-retirement", { recursive: true });
writeFileSync(
  "docs/verification/dify-retirement/audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
