import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
await fs.mkdir("test-results", { recursive: true });
await fs.mkdir("docs/verification/s2-c", { recursive: true });
const scriptPath = path.resolve("test-results/assistant-state-worker.mjs");
await build({
  entryPoints: ["tests/fixtures/assistant-state-worker.ts"],
  outfile: scriptPath,
  bundle: true,
  format: "esm",
  platform: "browser",
  logLevel: "silent",
});
const persist = path.resolve("test-results/isolated-d1-" + crypto.randomUUID());
const workers = ["a", "b"].map((name) => ({
  name,
  scriptPath,
  modules: true,
  compatibilityDate: "2026-10-12",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "shared-isolated-assistant" },
  bindings: { AGENT_SIGNING_SECRET: "isolated-test-only-signing-secret" },
}));
const options = convertV4MiniflareOptions({
  workers,
  resourcePersistencePath: persist,
});
let mf = new Miniflare(options);
const queries = [];
for (const file of (await fs.readdir("migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  let buffer = "";
  for (const line of (await fs.readFile("migrations/" + file, "utf8")).split(
    /\r?\n/,
  )) {
    if (!line.trim() || line.trim().startsWith("--")) continue;
    buffer += line + "\n";
    const trigger = /^CREATE TRIGGER/i.test(buffer.trim());
    if (
      line.trim().endsWith(";") &&
      (!trigger ||
        line.trim() === "END;" ||
        /^BEGIN\b.*\bEND;$/.test(line.trim()))
    ) {
      queries.push(buffer);
      buffer = "";
    }
  }
  assert.equal(buffer.trim(), "");
}
try {
  const db = await mf.getD1Database("DB", "a");
  await db.batch(queries.map((sql) => db.prepare(sql)));
  let a = await mf.getWorker("a"),
    b = await mf.getWorker("b");
  async function call(worker, endpoint, cookie, body) {
    const r = await worker.fetch("http://isolated.local" + endpoint, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookie || "", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const first = await call(a, "/session");
  const cookie = first.cookie,
    conversationId = first.body.data.conversationId;
  assert.equal(
    (await call(b, "/session", cookie)).body.data.conversationId,
    conversationId,
  );
  const attempts = await Promise.all([
    call(a, "/reserve", cookie, {
      conversationId,
      requestId: crypto.randomUUID(),
    }),
    call(b, "/reserve", cookie, {
      conversationId,
      requestId: crypto.randomUUID(),
    }),
  ]);
  assert.equal(attempts.filter((r) => r.status === 200).length, 1);
  assert.equal(
    attempts.find((r) => r.status !== 200).body.code,
    "RATE_LIMITED",
  );
  await call(b, "/finish", cookie, {
    runId: attempts.find((r) => r.status === 200).body.data.runId,
  });
  const planned = await call(a, "/route", cookie, {});
  assert.equal(planned.status, 200);
  const routeId = planned.body.data.routeId;
  assert.equal((await call(b, "/restore", cookie, { routeId })).status, 200);
  const stranger = await call(b, "/session");
  assert.equal(
    (await call(a, "/restore", stranger.cookie, { routeId })).body.code,
    "NOT_FOUND",
  );
  for (let i = 0; i < 19; i++) {
    const r = await call(i % 2 ? a : b, "/reserve", cookie, {
      conversationId,
      requestId: crypto.randomUUID(),
    });
    assert.equal(r.status, 200);
    await call(b, "/finish", cookie, { runId: r.body.data.runId });
  }
  assert.equal(
    (
      await call(a, "/reserve", cookie, {
        conversationId,
        requestId: crypto.randomUUID(),
      })
    ).body.code,
    "RATE_LIMITED",
  );
  await mf.dispose();
  mf = new Miniflare(options);
  a = await mf.getWorker("a");
  b = await mf.getWorker("b");
  assert.equal(
    (await call(a, "/session", cookie)).body.data.conversationId,
    conversationId,
  );
  assert.equal((await call(b, "/restore", cookie, { routeId })).status, 200);
  await fs.writeFile(
    "docs/verification/s2-c/shared-workers.json",
    JSON.stringify(
      {
        actualWorkerdIsolates: 2,
        managedSharedD1Emulator: true,
        isolatedDatabase: true,
        modelCalls: 0,
        sharedSessionRestored: true,
        concurrentRunsAccepted: 1,
        concurrentRunsRejectedByQuota: 1,
        sharedRouteRestored: true,
        crossGuestRouteRejected: true,
        shared20PerHourQuotaEnforced: true,
        runtimeRestartVerified: true,
        productionMultiRegionDeployment: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS two independent workerd isolates: shared quotas, identities, routes and runtime restart",
  );
} finally {
  await mf.dispose();
}
