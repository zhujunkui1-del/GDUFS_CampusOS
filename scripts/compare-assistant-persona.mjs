// Isolated comparison against the already-configured local model credential.
// Does not alter a user's model preference or the deployed platform router.
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
      "export {defaultModelRuntime} from './src/lib/server/models/runtime';export {personaPrompt,defaultPersona} from './src/lib/server/assistant/persona';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: ".map-tools/assistant-quality/persona-compare.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const lib = await import(
  pathToFileURL(
    process.cwd() + "/.map-tools/assistant-quality/persona-compare.mjs",
  ).href
);
const runtime = await lib.defaultModelRuntime().resolve();
const dir = "docs/verification/assistant-quality-2026-11-03";
let live = JSON.parse(await fs.readFile(`${dir}/after-live.json`, "utf8"));
if (live.length < 8)
  live = JSON.parse(await fs.readFile(`${dir}/after-first-live.json`, "utf8"));
const rows = [];
for (const index of [0, 1, 2, 4, 6])
  for (const enabled of [true, false]) {
    const sample = live[index],
      sources = sample.cards;
    const preference = { ...lib.defaultPersona(), enabled };
    const started = performance.now();
    try {
      const reply = await runtime.client.generateWithTools({
        messages: [
          {
            role: "system",
            content:
              "直接回答。校园事实只使用给定来源片段，用[n]引用对应编号；标题不代表全文，不补写未知内容，不输出来源清单。不声称执行过工具或地图动作。" +
              lib.personaPrompt(sample.message, preference),
          },
          {
            role: "user",
            content: JSON.stringify({
              question: sample.message,
              sources: sources.map((s, i) => ({
                citation: i + 1,
                title: s.title,
                snippet: s.snippet,
                evidenceType: s.evidenceType,
              })),
            }),
          },
        ],
        tools: [],
        maxTokens: 1024,
        signal: AbortSignal.timeout(20000),
      });
      rows.push({
        question: sample.message,
        enabled,
        provider: runtime.snapshot.provider,
        model: runtime.snapshot.model,
        comparison:
          "same source-card excerpts as live platform answer, not identical complete system/history prompts",
        platformAnswer: enabled ? sample.text : undefined,
        answer: reply.content,
        usage: reply.usage,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (e) {
      rows.push({
        question: sample.message,
        enabled,
        provider: runtime.snapshot.provider,
        error: e.code || "MODEL_ERROR",
      });
    }
    await fs.writeFile(
      `${dir}/persona-model-comparison.json`,
      JSON.stringify(rows, null, 2),
    );
    console.log(`persona comparison ${rows.length}/10`);
  }
