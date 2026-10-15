// Capture only numerical invocation metadata. Discard headers, bodies, logs,
// exceptions, full URLs and any other fields before writing evidence.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const dir = "docs/verification/s2-e";
mkdirSync(dir, { recursive: true });
const records = [];
const output = process.env.PREVIEW_TAIL_CAPTURE || `${dir}/invocations.json`;
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "tail",
    "--env",
    "preview",
    "--config",
    "wrangler.jsonc",
    "--format",
    "json",
  ],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
let buffer = "",
  depth = 0,
  quoted = false,
  escaped = false,
  start = -1;
function save() {
  writeFileSync(
    output,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        actualCloudTail: true,
        rawLogsStored: false,
        records,
      },
      null,
      2,
    ) + "\n",
  );
}
function accept(value) {
  if (!value.eventTimestamp) return;
  let path = null;
  try {
    path = new URL(value.event?.request?.url).pathname.replace(
      /\/[a-f0-9-]{36}(?=\/|$)/g,
      "/:id",
    );
  } catch {}
  records.push({
    at: value.eventTimestamp,
    path,
    outcome: value.outcome,
    status: value.event?.response?.status,
    cpuTimeMs: value.cpuTime ?? null,
    wallTimeMs: value.wallTime ?? null,
    exceptionCount: value.exceptions?.length || 0,
  });
  save();
}
child.stdout.on("data", (chunk) => {
  for (const ch of chunk.toString()) {
    if (start < 0) {
      if (ch !== "{") continue;
      buffer = "";
      depth = 0;
      quoted = false;
      escaped = false;
      start = 0;
    }
    buffer += ch;
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0 && !quoted) {
      try {
        accept(JSON.parse(buffer));
      } catch {}
      start = -1;
      buffer = "";
    }
    if (buffer.length > 1024 * 1024) {
      start = -1;
      buffer = "";
    }
  }
});
child.stderr.on("data", () => {});
child.on("exit", (code) => {
  save();
  console.log(
    JSON.stringify({
      tailEnded: true,
      exitCode: code,
      invocations: records.length,
    }),
  );
});
const stop = () => {
  save();
  child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const duration = Math.min(
  600000,
  Math.max(10000, Number(process.env.PREVIEW_TAIL_MS) || 240000),
);
setTimeout(stop, duration).unref();
console.log(
  "Collecting sanitized preview invocation metadata for a bounded acceptance window.",
);
