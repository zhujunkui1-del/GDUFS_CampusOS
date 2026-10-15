import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});
if (!process.env.MODEL_API_KEY || !process.env.MODEL_CAPABILITIES_JSON) {
  console.error(
    "Configure and verify the server default model first: npm run model:verify -- --configure-local",
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.map-live.config.ts",
  ],
  { env: { ...process.env, MODEL_LIVE_TEST: "1" }, stdio: "inherit" },
);
process.exit(result.status ?? 1);
