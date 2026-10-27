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
    if (
      request.method !== "POST" ||
      !["/probe", "/status", "/session/import", "/restart"].includes(path)
    )
      return json(404, { error: "not_found" });
    const stub = env.EVALUATOR.getByName("single-private-evaluation");
    if (path === "/restart")
      return stub.fetch(
        new Request("http://eval.internal/restart", { method: "POST" }),
      );
    const cap = path === "/session/import" ? 131072 : 2048;
    if (Number(request.headers.get("Content-Length") || 0) > cap)
      return json(413, { error: "limit" });
    let text = "",
      size = 0;
    const reader = request.body?.getReader(),
      decoder = new TextDecoder();
    if (reader)
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > cap) return json(413, { error: "limit" });
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
      }
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      return json(400, { error: "input" });
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return json(400, { error: "input" });
    if (
      path === "/probe" &&
      (typeof input.query !== "string" ||
        input.query.length < 2 ||
        input.query.length > 300 ||
        !["xhs", "rednote"].includes(input.platform) ||
        (input.limit !== undefined &&
          (!Number.isInteger(input.limit) ||
            input.limit < 1 ||
            input.limit > 4)) ||
        Object.keys(input).some(
          (k) => !["query", "platform", "limit"].includes(k),
        ))
    )
      return json(400, { error: "input" });
    if (path === "/status" && Object.keys(input).length)
      return json(400, { error: "input" });
    if (
      path === "/session/import" &&
      (Object.keys(input).some((k) => k !== "state") ||
        !Array.isArray(input.state?.cookies) ||
        input.state.cookies.length > 150)
    )
      return json(400, { error: "input" });
    if (
      !/^evaluation\/redbook-20261027-[a-f0-9]{8}\.enc$/.test(
        env.SESSION_OBJECT,
      )
    )
      return json(503, { error: "session_config" });
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from(env.SESSION_KEY, "base64"),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    let plain;
    if (path === "/session/import") {
      const state = {
        cookies: input.state.cookies.filter((c) =>
          [
            "xiaohongshu.com",
            ".xiaohongshu.com",
            "edith.xiaohongshu.com",
          ].includes(c.domain),
        ),
        authenticatedPlatform: "xhs",
        capturedAt: new Date().toISOString(),
      };
      plain = new TextEncoder().encode(JSON.stringify(state));
    } else {
      const object = await env.SESSIONS.get(env.SESSION_OBJECT);
      if (!object) return json(503, { error: "session_missing" });
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.length < 29 || bytes.length > 131072)
        return json(503, { error: "session_format" });
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
    }
    const response = await stub.fetch(
      new Request(
        "http://eval.internal/" + (path === "/probe" ? "probe" : "status"),
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env.SERVICE_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(path === "/probe" ? input : { platform: "xhs" }),
            state: JSON.parse(new TextDecoder().decode(plain)),
          }),
        },
      ),
    );
    const data = await response.json();
    if (path === "/session/import") {
      // A browser login never replaces a working snapshot until the HTTP source confirms it.
      if (data.authenticated === true && data.status === "ok") {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: new TextEncoder().encode(
              "campusos:xhs-provider-evaluation:v1",
            ),
          },
          key,
          plain,
        );
        const bytes = new Uint8Array(12 + cipher.byteLength);
        bytes.set(iv);
        bytes.set(new Uint8Array(cipher), 12);
        await env.SESSIONS.put(env.SESSION_OBJECT, bytes);
      }
      return json(response.status, {
        ...data,
        imported: data.authenticated === true && data.status === "ok",
      });
    }
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
