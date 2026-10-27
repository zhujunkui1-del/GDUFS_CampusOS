import { build } from "esbuild";
import fs from "node:fs/promises";
await fs.mkdir("services/cloud-search/build", { recursive: true });
await build({
  entryPoints: ["services/cloud-search/server.mjs"],
  outfile: "services/cloud-search/build/server.mjs",
  bundle: true,
  external: ["zod"],
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
