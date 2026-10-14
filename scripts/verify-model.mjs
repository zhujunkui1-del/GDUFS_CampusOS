import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});
const args = process.argv.slice(2);
const env = { ...process.env, MODEL_LIVE_TEST: "1" };
const sourceIndex = args.indexOf("--credential-file");
if (sourceIndex >= 0) {
  const source = readFileSync(args[sourceIndex + 1], "utf8");
  const keys = [...new Set(source.match(/sk-[A-Za-z0-9_-]{12,}/g) || [])];
  if (keys.length !== 1 || !/deepseek/i.test(source))
    throw new Error("Credential file must identify exactly one DeepSeek key");
  env.MODEL_API_KEY = keys[0];
}
env.MODEL_BASE_URL ||= "https://api.deepseek.com";
env.MODEL_NAME ||= "deepseek-flash";
if (!env.MODEL_API_KEY) {
  console.error("Configure server MODEL_API_KEY before verification.");
  process.exit(1);
}
const receiptPath = "test-results/model-capability-receipt.json";
if (existsSync(receiptPath)) rmSync(receiptPath);
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.live.config.ts",
  ],
  { env, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
if (args.includes("--configure-local")) {
  const receipt = readFileSync(receiptPath, "utf8");
  const additions = {
    MODEL_API_KEY: env.MODEL_API_KEY,
    MODEL_NAME: env.MODEL_NAME,
    MODEL_BASE_URL: env.MODEL_BASE_URL,
    MODEL_CAPABILITIES_JSON: receipt,
  };
  for (const path of [".env.local", ".dev.vars"]) {
    let text = existsSync(path) ? readFileSync(path, "utf8") : "";
    text = text
      .split(/\r?\n/)
      .filter(
        (line) =>
          !Object.keys(additions).some((name) =>
            new RegExp(`^\\s*${name}\\s*=`).test(line),
          ),
      )
      .join("\n")
      .trimEnd();
    text +=
      "\n" +
      Object.entries(additions)
        .map(([name, value]) => `${name}='${value}'`)
        .join("\n") +
      "\n";
    writeFileSync(path, text, { mode: 0o600 });
  }
  console.log(
    "Verified default model configured in ignored server env files. No keys printed.",
  );
}
