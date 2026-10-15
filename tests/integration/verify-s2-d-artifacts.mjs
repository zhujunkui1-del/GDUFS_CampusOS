// Read-only release checks. Never print secret values, SQL, cookies or environment contents.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});
const names = [
  "MODEL_API_KEY",
  "AGENT_SIGNING_SECRET",
  "AMAP_SECURITY_JS_CODE",
  "AMAP_WEBSERVICE_KEY",
  "DEEPSEEK_API_KEY",
];
const secrets = names
  .filter((name) => process.env[name]?.length > 7)
  .map((name) => ({ name, value: process.env[name] }));
if (
  !secrets.some((s) => s.name === "MODEL_API_KEY") ||
  !secrets.some((s) => s.name === "AGENT_SIGNING_SECRET")
)
  throw new Error(
    "Required local secret inputs unavailable; cannot claim a credential scan",
  );
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const candidates = [
  ...new Set(
    git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter(Boolean),
  ),
];
function filesUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, name))
    .filter((name) => statSync(name).isFile());
}
function scan(files) {
  const matches = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const { name, value } of secrets)
      if (bytes.includes(Buffer.from(value)))
        matches.push({ file, variable: name });
  }
  return { files: files.length, matches };
}
const repository = scan(candidates);
const generatedWorkerAndAssets = scan(filesUnder(".open-next"));
const credentialFilesIgnored = [
  ".env.local",
  ".dev.vars",
  "CampusOS_Codex_完整设计文档_v2/anykey.md",
].every((name) => {
  try {
    git("check-ignore", "--", name);
    return true;
  } catch {
    return false;
  }
});
const changed = git("diff", "010072b", "--name-only").trim().split(/\r?\n/);
function normalizedGate(file, baseline) {
  const data = JSON.parse(
    baseline ? git("show", `010072b:${file}`) : readFileSync(file, "utf8"),
  );
  const normalize = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.id === "owner-gate-4") {
      value.name = "GATE_NAME_ONLY";
      value.aliases = [];
    }
    for (const child of Object.values(value)) normalize(child);
  };
  normalize(data);
  return JSON.stringify(data);
}
const gateFiles = [
  "src/features/campus-map/data/campus.json",
  "src/features/campus-map/data/owner-poi-review.json",
];
const gateOnlyNameAliasesChanged = gateFiles.every(
  (name) => normalizedGate(name, false) === normalizedGate(name, true),
);
const frozenDataUntouched = !changed.some(
  (name) =>
    name.startsWith("public/") ||
    /walking-network|local-routing|nanyuan7-model\.json|owner-model-review/.test(
      name,
    ),
);
const modelSha256 = createHash("sha256")
  .update(readFileSync("public/models/nanyuan7/nanyuan7-v2-54cc55342ae5.glb"))
  .digest("hex");
const expectedModel =
  "54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a";
const checks = {
  recordedAt: new Date().toISOString(),
  baseline: "010072b",
  scannedVariableNames: secrets.map((s) => s.name),
  actualModelKeyChecked: true,
  repository,
  generatedWorkerAndAssets,
  credentialFilesIgnored,
  gateOnlyNameAliasesChanged,
  frozenDataUntouched,
  modelSha256,
  modelMatchesApprovedAsset: modelSha256 === expectedModel,
};
writeFileSync(
  "docs/verification/s2-d/security-integrity.json",
  JSON.stringify(checks, null, 2) + "\n",
);
const passed =
  !repository.matches.length &&
  !generatedWorkerAndAssets.matches.length &&
  credentialFilesIgnored &&
  gateOnlyNameAliasesChanged &&
  frozenDataUntouched &&
  checks.modelMatchesApprovedAsset;
console.log(
  JSON.stringify({
    passed,
    repositoryFiles: repository.files,
    generatedFiles: generatedWorkerAndAssets.files,
    secretValuesPrinted: false,
    credentialFilesIgnored,
    gateOnlyNameAliasesChanged,
    frozenDataUntouched,
    modelMatchesApprovedAsset: checks.modelMatchesApprovedAsset,
  }),
);
if (!passed) process.exitCode = 1;
