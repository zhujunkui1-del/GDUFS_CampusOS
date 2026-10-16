import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { publicWorkerEnvironment } from "./worker-env.mjs";

const metadata = spawnSync(
  process.execPath,
  ["scripts/prepare-route-metadata.mjs", "--check"],
  {
    stdio: "inherit",
    env: process.env,
  },
);
if (metadata.error || metadata.status !== 0) process.exit(metadata.status ?? 1);

const result = spawnSync(
  process.execPath,
  [
    "node_modules/@opennextjs/cloudflare/dist/cli/index.js",
    "build",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
const file = ".open-next/cloudflare/next-env.mjs";
const { content, privateValues } = publicWorkerEnvironment(
  readFileSync(file, "utf8"),
);
writeFileSync(file, content);
const envIndex = process.argv.indexOf("--env");
const environment = envIndex >= 0 ? process.argv[envIndex + 1] : undefined;
const generatedDirs = [".open-next"];
// Include independently generated Console credentials in every release scan.
for (const privateFile of [
  ".map-tools/s3-a/local-secrets.json",
  ".map-tools/s3-a/preview-secrets.json",
]) {
  if (!existsSync(privateFile)) continue;
  for (const [name, value] of Object.entries(
    JSON.parse(readFileSync(privateFile, "utf8")),
  ))
    if (
      typeof value === "string" &&
      value.length > 7 &&
      /KEY|SECRET|TOKEN|PASSWORD|_CODE/.test(name)
    )
      privateValues.push(value);
}
if (environment === "preview") {
  const previewSecrets = ".map-tools/s2-e/runtime-secrets.json";
  if (existsSync(previewSecrets))
    for (const [name, value] of Object.entries(
      JSON.parse(readFileSync(previewSecrets, "utf8")),
    )) {
      if (
        typeof value === "string" &&
        value.length > 7 &&
        /KEY|SECRET|TOKEN|PASSWORD|_CODE/.test(name)
      )
        privateValues.push(value);
    }
  const outdir = "test-results/preview-release-bundle";
  const dryRun = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "deploy",
      "--dry-run",
      "--config",
      "wrangler.jsonc",
      "--env",
      "preview",
      "--outdir",
      outdir,
    ],
    { stdio: "inherit", env: process.env },
  );
  if (dryRun.error || dryRun.status !== 0) process.exit(dryRun.status ?? 1);
  generatedDirs.push(outdir);
}
let scanned = 0;
for (const directory of generatedDirs)
  for (const relative of readdirSync(directory, { recursive: true })) {
    const path = join(directory, relative);
    if (!statSync(path).isFile()) continue;
    scanned++;
    const bytes = readFileSync(path);
    if (privateValues.some((value) => bytes.includes(Buffer.from(value)))) {
      console.error(
        "Worker build rejected: private environment value found in generated output.",
      );
      process.exit(1);
    }
  }
console.log(
  `Worker environment sanitized; ${scanned} generated files checked. Server credentials require runtime bindings.`,
);
