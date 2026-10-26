import fs from "node:fs/promises";
const config = JSON.parse(
  await fs.readFile("services/external-search/runtime/config.json", "utf8"),
);
const attempts = [];
async function search() {
  const start = performance.now();
  const r = await fetch("http://127.0.0.1:" + config.port + "/v1/search", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.gatewayToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "广外 大学城 食堂", limit: 3 }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  const proof = {
    at: new Date().toISOString(),
    http: r.status,
    durationMs: Math.round(performance.now() - start),
    data,
  };
  attempts.push(proof);
  return proof;
}
let cold = await search();
if (cold.data.status !== "ok") cold = await search();
const warm = cold.data.status === "ok" ? await search() : null;
const report = {
  at: new Date().toISOString(),
  scope: "local-only; actual public snippets; all attempts retained",
  attempts,
};
await fs.writeFile(
  "docs/verification/external-search/xhs-logged-in/cache-proof.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    coldStatus: cold.data.status,
    coldMs: cold.durationMs,
    warmStatus: warm?.data.status,
    warmMs: warm?.durationMs,
    cacheHit: warm?.data.cacheHit,
    count: warm?.data.items?.length,
  }),
);
if (
  !warm?.data.cacheHit ||
  !warm.data.items.some((i) => i.evidenceKind === "page_excerpt")
)
  process.exitCode = 1;
