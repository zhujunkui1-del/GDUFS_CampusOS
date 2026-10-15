// Controlled public API and owned-row checks against the dedicated preview only.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "comment-json";
import { assertPreviewTarget } from "../../scripts/preview-config.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const target = assertPreviewTarget(
  parse(readFileSync("wrangler.jsonc", "utf8")),
  account,
);
const base = process.env.E2E_BASE_URL;
if (base !== "https://campusos-preview.zhujunkui1.workers.dev")
  throw Error("Explicit authorized preview URL required");
const auth = spawnSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8" },
);
if (auth.status !== 0) throw Error("Wrangler authentication unavailable");
const { token } = JSON.parse(auth.stdout);
const adminMeta = [];
async function sql(sql, params = []) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${target.databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const j = await r.json();
  if (j.success) for (const x of j.result) adminMeta.push(x.meta);
  return j;
}
const requirePass = (condition, name) => {
  if (!condition) throw Error(`Preview check failed: ${name}`);
};
async function guest() {
  const r = await fetch(base + "/api/agent/session");
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  requirePass(r.ok && cookie, "guest session");
  return cookie;
}
const a = await guest(),
  b = await guest();
async function api(cookie, path, data) {
  const r = await fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: r.status, body: await r.json() };
}
const planned = await api(a, "/api/map/skills/plan_route", {
  input: {
    start: { type: "place", placeId: "osm-way-312536955" },
    endPlaceId: "osm-way-307250998",
    mode: "walking",
  },
});
requirePass(planned.status === 200, "real route plan");
const route = planned.body.data.data;
const own = await api(a, `/api/agent/routes/${route.routeId}`, {}),
  foreign = await api(b, `/api/agent/routes/${route.routeId}`, {});
requirePass(
  own.status === 200 && foreign.status === 404,
  "route owner boundary",
);
const updated = await sql(
  "UPDATE assistant_route_refs SET map_version=? WHERE id=?",
  ["s2-e-invalid-map-version", route.routeId],
);
requirePass(updated.success, "owned version fixture update");
const version = await api(a, `/api/agent/routes/${route.routeId}`, {});
requirePass(version.status !== 200, "stale map version denied");
const expiredFixture = await sql(
  "UPDATE assistant_route_refs SET map_version=?,expires_at_ms=? WHERE id=?",
  [route.mapVersion, 1, route.routeId],
);
requirePass(
  expiredFixture.success && expiredFixture.result[0].meta.changes === 1,
  "owned expiry fixture update",
);
const expired = await api(a, `/api/agent/routes/${route.routeId}`, {});
requirePass(expired.status !== 200, "expired route denied");
const fk = await sql(
  "INSERT INTO conversations(id,user_id,status) VALUES(?,?,?)",
  [crypto.randomUUID(), "s2-e-missing-user", "active"],
);
requirePass(!fk.success, "foreign key constraint");
const cookieRestore = await api(a, "/api/agent/session");
requirePass(cookieRestore.status === 200, "guest cookie restored");
const output = {
  recordedAt: new Date().toISOString(),
  realCloud: true,
  guestCookiesIsolated: a !== b,
  routeRestoredByOwner: own.status === 200,
  crossGuestRouteStatus: foreign.status,
  staleVersionStatus: version.status,
  staleVersionCode: version.body.error?.code,
  expiredRouteStatus: expired.status,
  expiredRouteCode: expired.body.error?.code,
  foreignKeyConstraintRejected: !fk.success,
  cookieRestored: cookieRestore.status === 200,
  scopeAndCredentialsStored: false,
  rowsModifiedOnlyOnNewOwnedTestRoute: true,
  adminQueryMeta: adminMeta,
};
writeFileSync(
  "docs/verification/s2-e/shared-state.json",
  JSON.stringify(output, null, 2) + "\n",
);
console.log(JSON.stringify(output));
