import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});
await build({
  stdin: {
    contents:
      "export {DeepseekModelClient} from './src/lib/server/models/deepseek';export {defaultModelRuntime} from './src/lib/server/models/runtime';export {understandQuery} from './src/lib/server/assistant/query-understanding';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: ".map-tools/assistant-quality/planner.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const lib = await import(
  pathToFileURL(process.cwd() + "/.map-tools/assistant-quality/planner.mjs")
    .href
);
let resolved = await lib
  .defaultModelRuntime({ providerManagedOutput: true })
  .resolve();
if (process.argv.includes("--step")) {
  const source = await fs.readFile(
    "CampusOS_Codex_完整设计文档_v2/anykey.md",
    "utf8",
  );
  const keys = [...new Set(source.match(/sk-[A-Za-z0-9_-]{12,}/g) || [])];
  if (keys.length !== 1 || !/step|阶跃/i.test(source))
    throw Error("Unambiguous Step credential required");
  resolved = {
    client: new lib.DeepseekModelClient(
      "step-3.5-flash-2603",
      keys[0],
      "https://api.stepfun.com/step_plan/v1",
      fetch,
      12000,
      "stepfun",
      1024,
      true,
    ),
    snapshot: { provider: "stepfun" },
  };
}
const rows = [];
for (const question of [
  "学院组织三下乡需要填申请表吗？",
  "广外学子在2025年全运会有什么贡献？",
]) {
  let raw;
  const client = {
    ...resolved.client,
    generateWithTools: async (request) => {
      const r = await resolved.client.generateWithTools(request);
      raw = {
        toolCalls: r.toolCalls,
        finishReason: r.finishReason,
        usage: r.usage,
      };
      return r;
    },
  };
  try {
    rows.push({
      question,
      provider: resolved.snapshot.provider,
      result: await lib.understandQuery(
        client,
        question,
        AbortSignal.timeout(12000),
      ),
      raw,
    });
  } catch (e) {
    rows.push({
      question,
      provider: resolved.snapshot.provider,
      error: e.code || e.message,
      raw,
    });
  }
}
await fs.writeFile(
  `docs/verification/assistant-quality-2026-11-03/query-understanding-${resolved.snapshot.provider}.json`,
  JSON.stringify(rows, null, 2),
);
console.log(JSON.stringify(rows, null, 2));
