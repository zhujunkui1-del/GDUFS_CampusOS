// Owner-provided credentials are read in memory. Output is capabilities and numeric usage only.
import fs from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { stepPlanCredential } from "./credential-sections.mjs";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});
const root = ".map-tools/cloud-search";
await fs.mkdir(root, { recursive: true });
await fs.mkdir("docs/verification/cloud-search", { recursive: true });
await build({
  stdin: {
    contents:
      "export {verifyDefaultModel} from './src/lib/server/models/verify';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: root + "/verify.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { verifyDefaultModel } = await import(
  pathToFileURL(process.cwd() + "/" + root + "/verify.mjs").href
);
const text = await fs.readFile(
  "CampusOS_Codex_完整设计文档_v2/anykey.md",
  "utf8",
);
const primary = stepPlanCredential(text);
try {
  const a = await verifyDefaultModel(primary);
  await fs.writeFile(
    "docs/verification/cloud-search/stepfun-model.json",
    JSON.stringify(a.evidence, null, 2),
  );
  const secrets = {
    PRIMARY_MODEL_API_KEY: primary.apiKey,
    PRIMARY_MODEL_NAME: primary.model,
    PRIMARY_MODEL_BASE_URL: primary.baseUrl,
    PRIMARY_MODEL_CAPABILITIES_JSON: JSON.stringify(a.receipt),
  };
  if (process.env.MODEL_API_KEY) {
    const b = await verifyDefaultModel({
      apiKey: process.env.MODEL_API_KEY,
      model: process.env.MODEL_NAME || "deepseek-flash",
      baseUrl: process.env.MODEL_BASE_URL || "https://api.deepseek.com",
    });
    secrets.MODEL_CAPABILITIES_JSON = JSON.stringify(b.receipt);
    secrets.MODEL_API_KEY = process.env.MODEL_API_KEY;
    secrets.MODEL_NAME = process.env.MODEL_NAME || "deepseek-flash";
    secrets.MODEL_BASE_URL =
      process.env.MODEL_BASE_URL || "https://api.deepseek.com";
    await fs.writeFile(
      "docs/verification/cloud-search/deepseek-model.json",
      JSON.stringify(b.evidence, null, 2),
    );
  }
  await fs.writeFile(root + "/model-secrets.json", JSON.stringify(secrets), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      primary: primary.model,
      verified: true,
      fallbackReceiptUpdated: !!secrets.MODEL_CAPABILITIES_JSON,
    }),
  );
} catch (e) {
  console.log(
    JSON.stringify({
      verified: false,
      code: e?.code || "MODEL_VERIFICATION_FAILED",
    }),
  );
  process.exitCode = 1;
}
