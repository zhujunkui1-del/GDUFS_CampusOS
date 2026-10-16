// Low-frequency real HTTPS seam; never calls a paid model or changes map data.
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import assert from "node:assert/strict";
const base =
  process.env.CPU_BASE_URL || "https://campusos-preview.zhujunkui1.workers.dev";
if (
  ![
    "https://campusos-preview.zhujunkui1.workers.dev",
    "http://127.0.0.1:8787",
  ].includes(base)
)
  throw Error("Only the isolated preview or explicit local workerd is allowed");
const realCloud = base.startsWith("https:");
const dir = process.env.CPU_CAPTURE_DIR || "docs/verification/s2-e-cpu/before";
mkdirSync(dir, { recursive: true });
let cookie = "";
const records = [];
const s7 = "osm-way-312536955",
  library = "osm-way-307250998";
const cases = [
  ["page", "/map"],
  ["health", "/api/health"],
  ["status", "/api/agent/status"],
  ["session", "/api/agent/session"],
  ["search", "/api/map/skills/search_places", { query: "南苑7栋" }],
  ["details", "/api/map/skills/get_place_details", { placeId: s7 }],
  [
    "nearby",
    "/api/map/skills/find_nearby_places",
    { origin: { type: "place", placeId: s7 }, category: "canteen" },
  ],
  [
    "route",
    "/api/map/skills/plan_route",
    {
      start: { type: "place", placeId: s7 },
      endPlaceId: library,
      mode: "walking",
    },
  ],
  [
    "map-intent",
    "/api/map/skills/control_map",
    { actions: [{ type: "SET_VIEW_MODE", mode: "3d" }] },
  ],
];
for (let round = 0; round < 6; round++) {
  for (const [name, path, input] of cases) {
    const at = Date.now(),
      started = performance.now();
    const r = await fetch(base + path, {
      method: input ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      ...(input ? { body: JSON.stringify({ input }) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const raw = await r.text();
    const record = {
      at,
      name,
      path,
      round,
      status: r.status,
      clientWallMs: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(raw),
      colo: r.headers.get("cf-ray")?.split("-").at(-1),
      cache: r.headers.get("cf-cache-status"),
    };
    records.push(record);
    writeFileSync(
      `${dir}/requests.json`,
      JSON.stringify({ realCloud, records }, null, 2) + "\n",
    );
    console.log(JSON.stringify(record));
    assert.equal(r.status, 200, `${name}: ${raw.slice(0, 180)}`);
    if (input) assert.equal(JSON.parse(raw).ok, true);
    await setTimeout(750);
  }
}
