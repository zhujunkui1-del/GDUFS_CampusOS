import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { build } from "esbuild";

const args = process.argv.slice(2);
if (!args.includes("--run")) {
  console.log(
    JSON.stringify({
      mode: "dry-run-no-network",
      usage: "node scripts/discover-official-web-routes.mjs --run [--limit N] [--source GDUFS-SRC-0001]",
    }),
  );
  process.exit(0);
}
mkdirSync("test-results/official-web-discovery", { recursive: true });
const bundle = "test-results/official-web-discovery/discover.mjs";
await build({
  entryPoints: ["scripts/discover-official-web-routes.ts"],
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
