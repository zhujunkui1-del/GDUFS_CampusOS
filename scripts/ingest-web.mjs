// Explicit, bounded local executor. No cron, paid model, server process or cloud resource creation.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
mkdirSync("test-results", { recursive: true });
await build({
  entryPoints: ["scripts/ingest-web-runner.ts"],
  outfile: "test-results/s3-b-runner.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  tsconfig: "tsconfig.json",
  logLevel: "silent",
});
await import("../test-results/s3-b-runner.mjs");
