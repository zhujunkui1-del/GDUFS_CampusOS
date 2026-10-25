// Read existing Preview invocation telemetry; never save logs, headers or keys.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { previewCloudflareJson } from "./preview-network.mjs";
const seconds = Number(process.argv[2] || 60);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 180)
  throw Error("Use 10..180 seconds");
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const api =
  "https://api.cloudflare.com/client/v4/accounts/5328fbf5ef7ef40f7743723c2c192499/workers/scripts/campusos-preview/tails";
const tail = await previewCloudflareJson(api, token, { filters: [] });
const records = [];
const report = {
  startedAt: new Date().toISOString(),
  actualCloudTail: false,
  rawLogsStored: false,
  cleanup: false,
  records,
};
const save = () =>
  fs.writeFile(
    "docs/verification/s3-d/retrieval-invocations.json",
    JSON.stringify(report, null, 2),
  );
let ws;
try {
  ws = new WebSocket(tail.url, "trace-v1");
  ws.addEventListener("message", async (e) => {
    try {
      const text =
        typeof e.data === "string"
          ? e.data
          : e.data instanceof Blob
            ? await e.data.text()
            : new TextDecoder().decode(e.data);
      const v = JSON.parse(text),
        url = v.event?.request?.url;
      if (!url) return;
      const path = new URL(url).pathname;
      if (!["/api/content/search", "/api/agent/chat"].includes(path)) return;
      records.push({
        at: v.eventTimestamp,
        path,
        method: v.event.request.method,
        status: v.event.response?.status ?? null,
        outcome: v.outcome,
        cpuTimeMs: typeof v.cpuTime === "number" ? v.cpuTime : null,
        wallTimeMs: typeof v.wallTime === "number" ? v.wallTime : null,
        exceptionCount: v.exceptions?.length || 0,
      });
      report.actualCloudTail = true;
      await save();
    } catch {
      /* No raw event/exception text is persisted. */
    }
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(Error("Tail connection unavailable")),
      10000,
    );
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(t);
        ws.send(JSON.stringify({ debug: false }));
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(t);
        reject(Error("Tail connection unavailable"));
      },
      { once: true },
    );
  });
  console.log("Preview telemetry connected; credentials withheld.");
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
} catch {
  report.unavailable = "Trace connection unavailable; no raw errors stored";
} finally {
  ws?.close();
  try {
    const response = await fetch(api + "/" + tail.id, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(10000),
    });
    report.cleanup = response.ok;
  } catch {
    /* Session also expires server-side. */
  }
  if (!report.cleanup) report.cleanupTailId = tail.id;
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      records: records.length,
      cpuMeasured: records.some((r) => r.cpuTimeMs !== null),
      cleanup: report.cleanup,
      ...(!report.cleanup ? { cleanupTailId: tail.id } : {}),
    }),
  );
}
