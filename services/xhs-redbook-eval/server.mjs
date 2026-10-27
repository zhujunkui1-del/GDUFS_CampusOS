import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { evaluateRedbook } from "./build/evaluate-redbook.mjs";
if (!process.env.SERVICE_TOKEN) throw Error("Missing evaluation secret");
const hash = (s) => createHash("sha256").update(s).digest(),
  expected = hash("Bearer " + process.env.SERVICE_TOKEN);
let running = false;
http
  .createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    if (req.url === "/health") return json(200, { ready: true });
    if (
      !timingSafeEqual(expected, hash(String(req.headers.authorization || "")))
    )
      return json(401, { error: "unauthorized" });
    if (req.method !== "POST" || req.url !== "/probe")
      return json(404, { error: "not_found" });
    if (running) return json(503, { error: "busy" });
    running = true;
    try {
      let bytes = 0;
      const chunks = [];
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 131072) return json(413, { error: "limit" });
        chunks.push(part);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      return json(
        200,
        await evaluateRedbook({
          state: data.state,
          platform: data.platform,
          query: data.query,
        }),
      );
    } catch (error) {
      return json(200, {
        status: "unavailable",
        errorType: error?.name || "Error",
        searchVerified: false,
        bodyVerified: false,
        items: [],
      });
    } finally {
      running = false;
    }
  })
  .listen(8080, "0.0.0.0");
