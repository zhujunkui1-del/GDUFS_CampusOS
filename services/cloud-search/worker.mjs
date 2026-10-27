import { Container } from "@cloudflare/containers";
import { RelayInputSchema } from "../../src/domain/retrieval/relay";
import { redbookSearch, redbookSession } from "./redbook.mjs";
export { ManagedXhs } from "./managed-xhs.mjs";
const json = (status, data) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export class SearchContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";
  enableInternet = true;
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = { SERVICE_TOKEN: env.SERVICE_TOKEN };
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/maintenance/restart") {
      await this.stop();
      return json(200, { restarted: true });
    }
    return super.fetch(request);
  }
}
async function smallText(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 8192)
    throw Error("BODY_LIMIT");
  const reader = request.body?.getReader();
  if (!reader) return "{}";
  let n = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      n += p.value.byteLength;
      if (n > 8192) throw Error("BODY_LIMIT");
      text += decoder.decode(p.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}
const worker = {
  async fetch(request, env) {
    if (!env.SERVICE_TOKEN) return json(503, { status: "not_configured" });
    const digest = async (value) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      );
    const a = await digest(request.headers.get("Authorization") || ""),
      b = await digest("Bearer " + env.SERVICE_TOKEN);
    let different = 0;
    for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
    if (different) return json(401, { status: "unavailable" });
    const path = new URL(request.url).pathname;
    if (
      request.method !== "POST" ||
      ![
        "/v1/search",
        "/v1/session/status",
        "/v1/session/poll",
        "/v1/session/login",
        "/v1/session/verify",
        "/maintenance/restart",
        "/maintenance/managed-restart",
        "/maintenance/managed-probe",
      ].includes(path)
    )
      return json(404, { status: "unavailable" });
    let text;
    try {
      text = await smallText(request);
    } catch {
      return json(413, { status: "unavailable" });
    }
    let input;
    try {
      input = JSON.parse(text);
      if (path === "/v1/search") input = RelayInputSchema.parse(input);
    } catch {
      return json(400, { status: "unavailable" });
    }
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(input),
    });
    if (path === "/v1/search" && input.kind === "xiaohongshu")
      return redbookSearch(env, input);
    if (path.startsWith("/v1/session/")) return redbookSession(env, forwarded);
    if (
      path.startsWith("/v1/session/") ||
      path === "/maintenance/managed-restart" ||
      path === "/maintenance/managed-probe" ||
      input.kind === "xiaohongshu"
    ) {
      if (!env.PROFILE_KEY) return json(503, { status: "not_configured" });
      return env.MANAGED_XHS.getByName("campusos-preview-xhs-v2").fetch(
        forwarded,
      );
    }
    return env.SEARCH_CONTAINER.getByName("campusos-preview-source").fetch(
      forwarded,
    );
  },
};
export default worker;
