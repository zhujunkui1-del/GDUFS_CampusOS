import { Container } from "@cloudflare/containers";
import { Buffer } from "node:buffer";
export class RedbookEvaluation extends Container {
  defaultPort = 8080;
  sleepAfter = "1m";
  enableInternet = true;
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = { SERVICE_TOKEN: env.SERVICE_TOKEN };
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/restart") {
      await this.stop();
      return Response.json({ restarted: true });
    }
    return super.fetch(request);
  }
}
const json = (status, data) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const worker = {
  async fetch(request, env) {
    if (!env.SERVICE_TOKEN || !env.SESSION_KEY || !env.SESSION_OBJECT)
      return json(503, { error: "not_configured" });
    const digest = async (s) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
      );
    const a = await digest(request.headers.get("Authorization") || ""),
      b = await digest("Bearer " + env.SERVICE_TOKEN);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff) return json(401, { error: "unauthorized" });
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/probe", "/restart"].includes(path))
      return json(404, { error: "not_found" });
    const stub = env.EVALUATOR.getByName("single-private-evaluation");
    if (path === "/restart")
      return stub.fetch(
        new Request("http://eval.internal/restart", { method: "POST" }),
      );
    if (Number(request.headers.get("Content-Length") || 0) > 1024)
      return json(413, { error: "limit" });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 1024)
      return json(413, { error: "limit" });
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      return json(400, { error: "input" });
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return json(400, { error: "input" });
    if (
      typeof input.query !== "string" ||
      input.query.length < 2 ||
      input.query.length > 100 ||
      !["xhs", "rednote"].includes(input.platform) ||
      Object.keys(input).some((k) => !["query", "platform"].includes(k))
    )
      return json(400, { error: "input" });
    if (
      !/^evaluation\/redbook-20261027-[a-f0-9]{8}\.enc$/.test(
        env.SESSION_OBJECT,
      )
    )
      return json(503, { error: "session_config" });
    const object = await env.SESSIONS.get(env.SESSION_OBJECT);
    if (!object) return json(503, { error: "session_missing" });
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.length < 29 || bytes.length > 131072)
      return json(503, { error: "session_format" });
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from(env.SESSION_KEY, "base64"),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    let plain;
    try {
      plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes.slice(0, 12),
          additionalData: new TextEncoder().encode(
            "campusos:xhs-provider-evaluation:v1",
          ),
        },
        key,
        bytes.slice(12),
      );
    } catch {
      return json(503, { error: "session_integrity" });
    }
    const response = await stub.fetch(
      new Request("http://eval.internal/probe", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.SERVICE_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...input,
          state: JSON.parse(new TextDecoder().decode(plain)),
        }),
      }),
    );
    const data = await response.json();
    return json(response.status, {
      ...data,
      environment: "cloudflare-container",
      sessionDigest: Buffer.from(
        await crypto.subtle.digest("SHA-256", plain),
      ).toString("hex"),
    });
  },
};
export default worker;
