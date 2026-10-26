// Windows Wrangler tail can exit in native code. Use its documented trace-v1
// transport directly; save only numeric timings and route paths, never logs.
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(
  parse(await fs.readFile("wrangler.jsonc", "utf8")),
  account,
);
const seconds = Number(process.argv[2] || 90);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 180)
  throw Error("Bounded telemetry window required.");
const output =
  process.env.PREVIEW_TELEMETRY_OUTPUT ||
  "docs/verification/external-search/xhs-logged-in/per-api-cpu.json";
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const worker = process.env.PREVIEW_TELEMETRY_WORKER || "campusos-preview";
if (!["campusos-preview", "campusos-preview-cloud-search"].includes(worker))
  throw Error("Preview telemetry target required");
const endpoint =
  "https://api.cloudflare.com/client/v4/accounts/" +
  account +
  "/workers/scripts/" +
  worker +
  "/tails";
let tail, ws;
const records = [];
const shapes = new Set();
let connected = false,
  removed = false;
try {
  tail = await previewCloudflareJson(endpoint, token, { filters: [] });
  ws = new WebSocket(tail.url, "trace-v1");
  ws.binaryType = "arraybuffer";
  ws.addEventListener("open", () => {
    connected = true;
    ws.send(JSON.stringify({ debug: false }));
  });
  ws.addEventListener("error", () => {});
  ws.addEventListener("message", (event) => {
    try {
      const raw =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data);
      const value = JSON.parse(raw);
      shapes.add(Object.keys(value).sort().join(","));
      if (!value.event?.request?.url) return;
      const path = new URL(value.event.request.url).pathname.replace(
        /(\/api\/agent\/(?:actions|routes|conversations))\/[^/]+/,
        "$1/:id",
      );
      records.push({
        at: value.eventTimestamp,
        path,
        method: value.event.request.method,
        status: value.event.response?.status ?? null,
        outcome: value.outcome,
        cpuTimeMs: typeof value.cpuTime === "number" ? value.cpuTime : null,
        wallTimeMs: typeof value.wallTime === "number" ? value.wallTime : null,
        exceptionCount: value.exceptions?.length || 0,
      });
    } catch {
      /* Raw frames, headers and log messages are deliberately discarded. */
    }
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
} finally {
  ws?.close();
  if (tail?.id) {
    try {
      const r = await fetch(endpoint + "/" + encodeURIComponent(tail.id), {
        method: "DELETE",
        redirect: "manual",
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(15000),
      });
      removed = r.ok;
      await r.body?.cancel();
    } catch {}
  }
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        windowSeconds: seconds,
        worker,
        connected,
        tailRemoved: removed,
        rawLogsStored: false,
        frameShapes: [...shapes].slice(0, 5),
        records,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      connected,
      tailRemoved: removed,
      records: records.length,
    }),
  );
}
