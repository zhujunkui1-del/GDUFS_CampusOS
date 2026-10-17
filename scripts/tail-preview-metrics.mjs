// Bounded preview-only telemetry. Never persist headers, cookies, logs, bodies or exception text.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
assertPreviewTarget(
  parse(readFileSync("wrangler.jsonc", "utf8")),
  process.env.CLOUDFLARE_ACCOUNT_ID,
);
const seconds = Number(process.argv[2] || 180);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 300)
  throw Error("Telemetry window must be 10..300 seconds");
const records = [];
let buffer = "",
  depth = 0,
  quoted = false,
  escaped = false;
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "tail",
    "campusos-preview",
    "--config",
    "wrangler.jsonc",
    "--env",
    "preview",
    "--format",
    "json",
    "--sampling-rate",
    "1",
  ],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
const save = () => {
  mkdirSync("docs/verification/s3-b", { recursive: true });
  writeFileSync(
    "docs/verification/s3-b/cloud-invocations.json",
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
};
const accept = (value) => {
  if (!value.event?.request?.url) return;
  let path;
  try {
    path = new URL(value.event.request.url).pathname;
  } catch {
    return;
  }
  path = path
    .replace(/(\/api\/admin\/(?:jobs|content|sources|admins))\/[^/]+/, "$1/:id")
    .replace(
      /(\/api\/agent\/(?:routes|actions|conversations))\/[^/]+/,
      "$1/:id",
    );
  records.push({
    at: value.eventTimestamp,
    path,
    method: value.event.request.method,
    outcome: value.outcome,
    status: value.event.response?.status ?? null,
    cpuTimeMs: typeof value.cpuTime === "number" ? value.cpuTime : null,
    wallTimeMs: typeof value.wallTime === "number" ? value.wallTime : null,
    exceptionCount: value.exceptions?.length || 0,
  });
  save();
};
child.stdout.on("data", (chunk) => {
  for (const char of chunk.toString()) {
    if (depth === 0) {
      if (char !== "{") continue;
      buffer = "{";
      depth = 1;
      quoted = false;
      escaped = false;
      continue;
    }
    buffer += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    if (depth === 0) {
      try {
        accept(JSON.parse(buffer));
      } catch {}
      buffer = "";
    }
    if (buffer.length > 2000000) {
      buffer = "";
      depth = 0;
      quoted = false;
    }
  }
});
// Errors are deliberately not printed: Wrangler can include request context.
let stderrSeen = false;
child.stderr.on("data", () => {
  stderrSeen = true;
});
const stop = () => {
  child.kill("SIGTERM");
  save();
};
const timer = setTimeout(stop, seconds * 1000);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  clearTimeout(timer);
  save();
  console.log(
    JSON.stringify({
      windowSeconds: seconds,
      records: records.length,
      code,
      stderrSeen,
      rawLogsStored: false,
    }),
  );
});
