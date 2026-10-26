import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});
const source = JSON.parse(
  await fs.readFile(".map-tools/cloud-search/secrets.json", "utf8"),
);
const model = JSON.parse(
  await fs.readFile(".map-tools/cloud-search/model-secrets.json", "utf8"),
);
if (process.env.MODEL_API_KEY) {
  model.MODEL_API_KEY = process.env.MODEL_API_KEY;
  model.MODEL_NAME = process.env.MODEL_NAME || "deepseek-flash";
  model.MODEL_BASE_URL =
    process.env.MODEL_BASE_URL || "https://api.deepseek.com";
}
const args = ["node_modules/wrangler/bin/wrangler.js", "secret", "bulk"];
for (const [target, flags, values] of [
  [
    "cloud-search",
    ["--config", "services/cloud-search/wrangler.jsonc"],
    source,
  ],
  [
    "campusos-preview",
    ["--env", "preview"],
    { ...model, CLOUD_SEARCH_TOKEN: source.SERVICE_TOKEN },
  ],
]) {
  const result = spawnSync(process.execPath, [...args, ...flags], {
    input: JSON.stringify(values),
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: "5328fbf5ef7ef40f7743723c2c192499",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0)
    throw Error(
      "Secret configuration failed for " + target + "; raw output withheld",
    );
  console.log(
    JSON.stringify({
      target,
      secretsConfigured: Object.keys(values),
      success: true,
    }),
  );
}
