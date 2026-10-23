import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { build } from "esbuild";

const args = process.argv.slice(2);
if (!args.includes("--run")) {
  console.log(
    JSON.stringify({
      mode: "dry-run-no-network",
      usage: "node scripts/inspect-official-web-list-samples.mjs --run",
    }),
  );
  process.exit(0);
}
mkdirSync("test-results/official-web-discovery", { recursive: true });
const bundle = "test-results/official-web-discovery/list-samples.mjs";
await build({
  entryPoints: ["scripts/inspect-official-web-list-samples.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  tsconfig: "tsconfig.json",
  logLevel: "silent",
  packages: "external",
});
const result = spawnSync(process.execPath, [bundle, ...args], {
  stdio: "inherit",
  env: process.env,
});
process.exitCode = result.status ?? 1;
