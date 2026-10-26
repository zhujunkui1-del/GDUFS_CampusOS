// Internet search runs in Node on Cloudflare. Xiaohongshu uses the managed browser DO.
import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  RelayInputSchema,
  RelayResultSchema,
} from "../../src/domain/retrieval/relay";
import { searchWeb } from "../../src/lib/server/external-search/providers";
const digest = (value) => createHash("sha256").update(value).digest();
if (!process.env.SERVICE_TOKEN) throw Error("Cloud search secret missing");
const expected = digest("Bearer " + process.env.SERVICE_TOKEN);
let running = 0;
http
  .createServer(async (req, res) => {
    const json = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    if (req.url === "/health")
      return json(200, { ready: true, provider: "cloud-web-search" });
    if (
      !timingSafeEqual(
        expected,
        digest(String(req.headers.authorization || "")),
      )
    )
      return json(401, { status: "unavailable" });
    if (req.url !== "/v1/search" || req.method !== "POST")
      return json(404, { status: "unavailable" });
    if (running >= 2) return json(503, { status: "busy" });
    running++;
    const started = performance.now();
    try {
      let bytes = 0;
      const chunks = [];
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 8192) return json(413, { status: "unavailable" });
        chunks.push(part);
      }
      const input = RelayInputSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      if (input.kind !== "web") return json(400, { status: "unavailable" });
      const data = await searchWeb(
        input.query,
        {
          ...input.policy,
          active: true,
          useXiaohongshu: false,
          needsDeadline: false,
          explicit: false,
        },
        input.limit,
        AbortSignal.timeout(27000),
        fetch,
        input.onlyXhs,
      );
      return json(
        200,
        RelayResultSchema.parse({ ...data, provider: "exa_web_cloud" }),
      );
    } catch {
      return json(200, {
        provider: "exa_web_cloud",
        status: "unavailable",
        items: [],
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      running--;
    }
  })
  .listen(8080, "0.0.0.0");
