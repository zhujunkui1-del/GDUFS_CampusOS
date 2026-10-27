import { RelayResultSchema } from "../../src/domain/retrieval/relay";
import { SourceSessionResultSchema } from "../../src/domain/console/dashboard";
import { xiaohongshuQuery } from "../external-search/query.mjs";

const json = (data) =>
  Response.json(data, { headers: { "Cache-Control": "no-store" } });
async function call(env, path, body) {
  if (!env.REDBOOK_SEARCH || !env.REDBOOK_TOKEN) throw Error("NOT_CONFIGURED");
  const response = await env.REDBOOK_SEARCH.fetch(
    new Request("https://redbook.internal" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.REDBOOK_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    }),
  );
  if (response.status === 503) return { status: "busy" };
  if (!response.ok) throw Error("PROVIDER_UNAVAILABLE");
  return response.json();
}
function session(data) {
  const state =
    data.authenticated === true && data.status === "ok"
      ? "logged_in"
      : data.status === "login_required"
        ? "login_required"
        : data.status === "verification_required"
          ? "verification_required"
          : data.status === "identity_unconfirmed"
            ? "unknown"
            : "unavailable";
  return SourceSessionResultSchema.parse({
    state,
    checkedAt: Date.now(),
    qr: null,
    qrExpiresAt: null,
  });
}
export async function redbookSearch(env, input) {
  const start = performance.now();
  let data;
  try {
    data = await call(env, "/probe", {
      query: xiaohongshuQuery(input.query) || input.query,
      platform: "xhs",
      limit: input.limit,
      ...(input.policy.recent ? { sort: "time_descending" } : {}),
    });
  } catch {
    data = { status: "unavailable" };
  }
  const items =
    data.status === "ok"
      ? (data.items || []).slice(0, input.limit).map((i) => ({
          title: i.title,
          originalUrl: i.originalUrl,
          sourceName: i.sourceName,
          platform: "xiaohongshu",
          authority: "student_experience",
          evidenceKind:
            i.bodyAvailable && i.snippet ? "page_excerpt" : "title_only",
          snippet: i.bodyAvailable && i.snippet ? i.snippet : i.title,
          publishedAt: i.publishedAt ?? null,
          retrievedAt: new Date().toISOString(),
          searchMode: "platform",
          canConfirmAdministrativeFacts: false,
        }))
      : [];
  return json(
    RelayResultSchema.parse({
      provider: "xiaohongshu_redbook_cloud",
      status: ["ok", "empty", "login_required", "busy"].includes(data.status)
        ? data.status
        : "unavailable",
      items,
      durationMs: Math.round(performance.now() - start),
      cacheHit: false,
    }),
  );
}
export async function redbookSession(env, request) {
  const path = new URL(request.url).pathname;
  let current;
  try {
    current = session(await call(env, "/status", {}));
  } catch {
    current = session({});
  }
  if (path === "/v1/session/verify") {
    // The old Browser Run view belongs to the retired main account. Never reopen it.
    return Response.json(
      { status: "login_required" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Account changes use explicit owner-authorized import; no legacy-session recovery.
  return json(current);
}
