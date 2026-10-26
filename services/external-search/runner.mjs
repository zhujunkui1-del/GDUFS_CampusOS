// Outbound HTTPS transport for the existing local providers. No inbound tunnel.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../..");
const config = JSON.parse(
  await fs.readFile(path.join(dir, "runtime/config.json"), "utf8"),
);
const base = new URL(
  config.relayUrl || "https://campusos-preview.zhujunkui1.workers.dev",
);
if (base.origin !== "https://campusos-preview.zhujunkui1.workers.dev")
  throw Error("Only the existing Preview relay is enabled.");
const bundled = path.join(dir, "runtime/relay-providers.mjs");
await build({
  stdin: {
    contents:
      "export {searchWeb} from './src/lib/server/external-search/providers';export {RelayWorkSchema,RelayResultSchema} from './src/domain/retrieval/relay';export {SourceControlWorkSchema,SourceSessionResultSchema} from './src/domain/console/dashboard';",
    resolveDir: root,
    loader: "ts",
  },
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const {
  searchWeb,
  RelayWorkSchema,
  RelayResultSchema,
  SourceControlWorkSchema,
  SourceSessionResultSchema,
} = await import(pathToFileURL(bundled).href);
const stop = new AbortController(),
  runnerId = crypto.randomUUID();
const active = new Set();
for (const name of ["SIGINT", "SIGTERM"]) process.on(name, () => stop.abort());
const pause = (ms) =>
  new Promise((r) => {
    const finish = () => {
      clearTimeout(t);
      stop.signal.removeEventListener("abort", finish);
      r();
    };
    const t = setTimeout(finish, ms);
    stop.signal.addEventListener("abort", finish, { once: true });
  });
async function post(route, body, timeoutMs) {
  const response = await fetch(
    new URL("/api/agent/external-search/" + route, base),
    {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: "Bearer " + config.gatewayToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("HTTP_" + response.status);
  }
  const data = await response.json();
  if (!data.ok) throw Error("RELAY_UNAVAILABLE");
  return data.data;
}
async function execute(work, claimUsage) {
  const start = performance.now(),
    signal = AbortSignal.any([stop.signal, AbortSignal.timeout(28000)]);
  let result;
  try {
    if (work.input.kind === "xiaohongshu") {
      const r = await fetch("http://127.0.0.1:" + config.port + "/v1/search", {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + config.gatewayToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: work.input.query,
          limit: work.input.limit,
        }),
        signal,
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw Error("LOCAL_GATEWAY_UNAVAILABLE");
      }
      const data = await r.json();
      result = RelayResultSchema.parse({
        provider: data.provider || "xiaohongshu_mcp_local",
        status: data.status,
        items: data.items,
        ...(typeof data.cacheHit === "boolean"
          ? { cacheHit: data.cacheHit }
          : {}),
        durationMs: Math.round(performance.now() - start),
      });
    } else {
      const p = work.input.policy;
      result = RelayResultSchema.parse(
        await searchWeb(
          work.input.query,
          {
            ...p,
            active: true,
            useXiaohongshu: false,
            needsDeadline: false,
            explicit: false,
          },
          work.input.limit,
          signal,
          fetch,
          work.input.onlyXhs,
        ),
      );
    }
  } catch {
    result = {
      provider:
        work.input.kind === "web" ? "exa_web_local" : "xiaohongshu_mcp_local",
      status: "unavailable",
      items: [],
      durationMs: Math.round(performance.now() - start),
    };
  }
  if (stop.signal.aborted) return;
  let finished;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      finished = await post("finish", { id: work.id, runnerId, result }, 10000);
      break;
    } catch {
      if (attempt === 1) throw Error("RELAY_RESULT_NOT_ACCEPTED");
    }
  }
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      jobId: work.id,
      kind: work.input.kind,
      provider: result.provider,
      status: result.status,
      count: result.items.length,
      cacheHit: result.cacheHit ?? false,
      durationMs: Math.round(performance.now() - start),
      claimUsage,
      finishUsage: finished?.usage,
    }),
  );
}
async function sessionRequest(action) {
  const response = await fetch(
    `http://127.0.0.1:${config.port}/v1/session/${action}`,
    {
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer " + config.gatewayToken },
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(22000)]),
    },
  );
  if (!response.ok) throw Error("SESSION_UNAVAILABLE");
  const data = await response.json();
  return SourceSessionResultSchema.parse({
    state: data.state,
    checkedAt: Date.now(),
    qr: data.qr ?? null,
    qrExpiresAt: data.qrExpiresAt ?? null,
  });
}
let watching = false;
async function watchLogin(initial) {
  if (watching) return;
  watching = true;
  try {
    const end = Date.now() + 240000;
    while (!stop.signal.aborted && Date.now() < end) {
      await pause(5000);
      const next = await sessionRequest("poll");
      if (next.state !== initial) {
        await post("session-report", next, 10000);
        if (
          next.state === "logged_in" ||
          next.state === "verification_required"
        )
          return;
        initial = next.state;
      }
    }
  } catch {
    /* The next explicit check reports connectivity accurately. */
  } finally {
    watching = false;
  }
}
async function executeControl(work) {
  let result;
  try {
    result = await sessionRequest(work.control.action);
  } catch {
    result = {
      state: "unavailable",
      checkedAt: Date.now(),
      qr: null,
      qrExpiresAt: null,
    };
  }
  await post("control-finish", { id: work.id, runnerId, result }, 10000);
  console.log(
    JSON.stringify({
      kind: "session_control",
      action: work.control.action,
      state: result.state,
    }),
  );
  if (work.control.action === "login" && result.state !== "logged_in")
    void watchLogin(result.state);
}
console.log(
  JSON.stringify({
    service: "campusos-external-search-runner",
    transport: "outbound-https",
    concurrency: 2,
    preview: true,
  }),
);
while (!stop.signal.aborted) {
  if (active.size >= 2) {
    await Promise.race(active);
    continue;
  }
  try {
    const claimed = await post("claim", { runnerId, waitMs: 20000 }, 25000);
    if (!claimed.work) continue;
    const control = SourceControlWorkSchema.safeParse(claimed.work);
    const work = control.success
      ? control.data
      : RelayWorkSchema.parse(claimed.work);
    const task = (
      control.success
        ? executeControl(control.data)
        : execute(RelayWorkSchema.parse(work), claimed.usage)
    )
      .catch(() =>
        console.log(JSON.stringify({ jobId: work.id, status: "unavailable" })),
      )
      .finally(() => active.delete(task));
    active.add(task);
  } catch {
    if (!stop.signal.aborted) {
      console.log(
        JSON.stringify({
          service: "campusos-external-search-runner",
          status: "retrying",
        }),
      );
      await pause(5000);
    }
  }
}
await Promise.allSettled(active);
