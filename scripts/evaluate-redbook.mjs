// Isolated, read-only feasibility probe. Never registered as an Agent tool.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const targets = {
  xhs: {
    host: "edith.xiaohongshu.com",
    domain: "xiaohongshu.com",
    home: "https://www.xiaohongshu.com",
  },
  rednote: {
    host: "webapi.rednote.com",
    domain: "rednote.com",
    home: "https://www.rednote.com",
  },
};
const allowed = new Set([
  "GET /api/sns/web/v2/user/me",
  "POST /api/sns/web/v1/search/notes",
  "POST /api/sns/web/v1/feed",
]);
export function noteSourceKey(value) {
  try {
    const url = new URL(value),
      host = url.hostname.replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["xiaohongshu.com", "rednote.com"].includes(host)
    )
      return null;
    const match = url.pathname.match(
      /^\/(?:explore|discovery\/item)\/([a-zA-Z0-9_-]{1,64})\/?$/,
    );
    return match ? host + ":" + match[1] : null;
  } catch {
    return null;
  }
}
// Delivery receipts keep proof metadata, not a permanent corpus of social posts.
export function publicEvaluationReceipt(value) {
  if (Array.isArray(value)) return value.map(publicEvaluationReceipt);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      ["snippet", "answer", "renderedAnswer", "quote"].includes(key) &&
      typeof item === "string"
    ) {
      out[key + "Chars"] = item.length;
      out[key + "Sha256"] = createHash("sha256").update(item).digest("hex");
    } else out[key] = publicEvaluationReceipt(item);
  }
  return out;
}
function errorShape(error) {
  return {
    type: typeof error?.name === "string" ? error.name.slice(0, 64) : "Error",
    ...(typeof error?.code === "number" ? { code: error.code } : {}),
    ...(Number.isInteger(error?.status) ? { httpStatus: error.status } : {}),
  };
}
async function installedClient(cookies, platform) {
  let entry;
  try {
    entry = pathToFileURL(
      createRequire(import.meta.url).resolve("@lucasygu/redbook"),
    );
  } catch {
    entry = new URL(
      "../.map-tools/xhs-provider-eval/node_modules/@lucasygu/redbook/dist/lib/client.js",
      import.meta.url,
    );
  }
  const root = new URL("../../", entry);
  const pkg = JSON.parse(
    await fs.readFile(new URL("package.json", root), "utf8"),
  );
  if (pkg.version !== "0.8.2") throw Error("SDK_VERSION_MISMATCH");
  const { XhsClient } = await import(entry.href);
  const { PLATFORMS } = await import(
    new URL("dist/lib/platform.js", root).href
  );
  return new XhsClient(cookies, PLATFORMS[platform]);
}
export async function evaluateRedbook({
  state,
  platform = "xhs",
  query = "广外 南校 一饭",
  allowGuestSearch = false,
  makeClient = installedClient,
  transport = globalThis.fetch,
}) {
  const target = targets[platform];
  if (
    !target ||
    typeof query !== "string" ||
    query.length < 2 ||
    query.length > 300
  )
    throw Error("EVALUATION_INPUT");
  if (!Array.isArray(state?.cookies) || state.cookies.length > 150)
    throw Error("SESSION_FORMAT");
  const cookies = Object.fromEntries(
    state.cookies
      .filter(
        (c) =>
          [target.domain, "." + target.domain, target.host].includes(
            c.domain,
          ) &&
          typeof c.name === "string" &&
          typeof c.value === "string" &&
          !/[\r\n;]/.test(c.name + c.value) &&
          (!c.expires || c.expires < 0 || c.expires * 1000 > Date.now()),
      )
      .map((c) => [c.name, c.value]),
  );
  if (!cookies.a1 || !cookies.web_session || !cookies.webId)
    throw Error("SESSION_INCOMPLETE");
  const trace = [],
    started = performance.now(),
    original = globalThis.fetch;
  const result = {
    at: new Date().toISOString(),
    runtime: process.version,
    os: process.platform,
    sdk: "@lucasygu/redbook@0.8.2",
    platform,
    query,
    authenticated: false,
    searchVerified: false,
    bodyVerified: false,
    status: "not_tested",
    items:
      /** @type {Array<{title:string,originalUrl:string,bodyAvailable:boolean,snippet?:string,sourceName?:string,publishedAt?:string|null}>} */ ([]),
    trace,
  };
  // One probe per process. Capture counts and codes, never headers, identity or raw bodies.
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url),
      method = init.method || "GET";
    if (
      url.protocol !== "https:" ||
      url.hostname !== target.host ||
      !allowed.has(method + " " + url.pathname) ||
      trace.length >= 8
    )
      throw Error("EVALUATION_SCOPE");
    const entry = { host: url.hostname, path: url.pathname, method },
      before = performance.now();
    trace.push(entry);
    try {
      const r = await transport(input, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      entry.httpStatus = r.status;
      try {
        const body = await r.clone().json();
        entry.code = body.code;
        entry.success = body.success;
        if (url.pathname.endsWith("/user/me")) entry.guest = body.data?.guest;
      } catch {
        /* Non-JSON is a real failure, not invented content. */
      }
      return r;
    } catch (error) {
      entry.error = errorShape(error);
      throw error;
    } finally {
      entry.durationMs = Math.round(performance.now() - before);
    }
  };
  try {
    const client = await makeClient(cookies, platform),
      me = await client.getSelfInfo();
    result.authenticated = me?.guest === false && !!(me.user_id || me.userId);
    result.identity = result.authenticated
      ? "authenticated"
      : me?.guest === true
        ? "guest"
        : "unconfirmed";
    if (!result.authenticated && !(allowGuestSearch && me?.guest === true)) {
      result.status =
        me?.guest === true ? "login_required" : "identity_unconfirmed";
      return result;
    }
    result.guestSearchAttempted = !result.authenticated;
    const data = await client.searchNotes(query, 1, 20);
    result.searchPayloadShape = {
      array: Array.isArray(data),
      keys: Object.keys(data || {}).slice(0, 20),
      arrays: Object.entries(data || {})
        .filter(([, v]) => Array.isArray(v))
        .map(([key, value]) => ({
          key,
          length: value.length,
          firstKeys: Object.keys(value[0] || {}).slice(0, 20),
        })),
    };
    const notes = (data?.items || data?.feeds || [])
      .filter(
        (n) => /^[\w-]{1,64}$/.test(n.id || "") && (n.note_card || n.noteCard),
      )
      .slice(0, 3);
    for (const [index, note] of notes.entries()) {
      const card = note.note_card || note.noteCard,
        token = note.xsec_token || note.xsecToken;
      const url = new URL(
        "/explore/" + encodeURIComponent(note.id),
        target.home,
      );
      if (token) {
        url.searchParams.set("xsec_token", token);
        url.searchParams.set("xsec_source", "pc_search");
      }
      const item = {
        title: String(
          card.display_title || card.displayTitle || card.title || "小红书笔记",
        ).slice(0, 250),
        originalUrl: url.href,
        bodyAvailable: false,
        sourceName: (
          "小红书" + (card.user?.nickname ? " · " + card.user.nickname : "")
        ).slice(0, 160),
        publishedAt: null,
      };
      if (index < 2 && token) {
        try {
          const detail = await client.getNoteById(note.id, token, "pc_search"),
            body =
              detail?.items?.[0]?.note_card || detail?.items?.[0]?.noteCard;
          item.bodyAvailable =
            typeof body?.desc === "string" && body.desc.trim().length > 0;
          if (item.bodyAvailable) item.snippet = body.desc.slice(0, 500);
          const time = Number(body?.time);
          if (Number.isFinite(time) && time > 0) {
            const date = new Date(time > 1e12 ? time : time * 1000);
            if (Number.isFinite(date.getTime()))
              item.publishedAt = date.toISOString();
          }
        } catch (error) {
          item.detailError = errorShape(error);
        }
      }
      result.items.push(item);
    }
    result.searchVerified = result.items.length > 0;
    result.bodyVerified = result.items.some((i) => i.bodyAvailable);
    result.status = result.searchVerified ? "ok" : "empty";
  } catch (error) {
    result.error = errorShape(error);
    result.status =
      error?.name === "NeedVerifyError"
        ? "verification_required"
        : [-100, -101].includes(error?.code)
          ? "login_required"
          : error?.code === -104
            ? "search_permission_denied"
            : "unavailable";
  } finally {
    globalThis.fetch = original;
    result.httpRequests = trace.length;
    result.requestCounts = {
      authentication: trace.filter((t) => t.path.endsWith("/user/me")).length,
      search: trace.filter((t) => t.path.endsWith("/search/notes")).length,
      noteDetail: trace.filter((t) => t.path.endsWith("/feed")).length,
    };
    result.durationMs = Math.round(performance.now() - started);
  }
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file =
    process.argv[2] || ".map-tools/xhs-provider-eval/local-session.json";
  const bytes = await fs.readFile(file);
  if (bytes.length > 1048576) throw Error("SESSION_LIMIT");
  const state = JSON.parse(bytes.toString("utf8"));
  const result = await evaluateRedbook({
    state,
    platform: process.argv[3] || state.authenticatedPlatform || "xhs",
    query: process.argv[4] || "广外 南校 一饭",
    allowGuestSearch: process.argv[5] === "--public-guest-search",
  });
  console.log(JSON.stringify(publicEvaluationReceipt(result), null, 2));
  process.exitCode = result.searchVerified && result.bodyVerified ? 0 : 2;
}
