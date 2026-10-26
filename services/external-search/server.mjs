// Local read-only boundary around xiaohongshu-mcp. No arbitrary MCP proxy.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { xiaohongshuQuery } from "./query.mjs";
import { PublicNoteCache } from "./cache.mjs";
const dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  await fs.readFile(path.join(dir, "runtime/config.json"), "utf8"),
);
const Input = z
  .object({
    query: z.string().trim().min(2).max(300),
    limit: z.number().int().min(1).max(4).default(3),
  })
  .strict();
const digest = (s) => createHash("sha256").update(s).digest();
const allowed = digest("Bearer " + config.gatewayToken);
let running = 0;
const cache = new PublicNoteCache();
async function upstream(route, body, signal) {
  const r = await fetch(config.upstreamUrl + route, {
    method: body ? "POST" : "GET",
    redirect: "error",
    headers: {
      Authorization: "Bearer " + config.upstreamToken,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  if (!r.ok) throw Error("UPSTREAM_UNAVAILABLE");
  const reader = r.body.getReader();
  let length = 0,
    bytes = [];
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      length += p.value.length;
      if (length > 2000000) throw Error("UPSTREAM_LIMIT");
      bytes.push(p.value);
    }
    return JSON.parse(Buffer.concat(bytes).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
function item(feed, detail) {
  const card = feed.noteCard || {},
    note = detail?.note || detail?.data?.note || {};
  const title = String(note.title || card.displayTitle || "小红书笔记").slice(
      0,
      250,
    ),
    snippet = String(note.desc || "").slice(0, 700);
  const u = new URL("https://www.xiaohongshu.com/explore/" + feed.id);
  u.searchParams.set("xsec_token", feed.xsecToken);
  u.searchParams.set("xsec_source", "pc_search");
  const author =
    note.user?.nickname ||
    note.user?.nickName ||
    card.user?.nickname ||
    card.user?.nickName;
  const time = Number(note.time),
    date =
      Number.isFinite(time) && time > 0
        ? new Date(time > 1e12 ? time : time * 1000)
        : null;
  return {
    title,
    originalUrl: u.href,
    sourceName: ("小红书" + (author ? " · " + author : "")).slice(0, 160),
    platform: "xiaohongshu",
    authority: "student_experience",
    evidenceKind: snippet ? "page_excerpt" : "title_only",
    snippet: snippet || title,
    publishedAt:
      date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    retrievedAt: new Date().toISOString(),
    searchMode: "platform",
    canConfirmAdministrativeFacts: false,
  };
}
const server = http.createServer(async (req, res) => {
  const send = (code, status, items = [], metadata = {}) => {
    if (res.destroyed) return;
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ status, items, ...metadata }));
  };
  if (req.url === "/health" && req.method === "GET") return send(200, "ok");
  if (req.url !== "/v1/search" || req.method !== "POST")
    return send(404, "unavailable");
  if (
    !timingSafeEqual(allowed, digest(String(req.headers.authorization || "")))
  )
    return send(401, "unavailable");
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(27000),
  ]);
  let counted = false;
  try {
    let body = "",
      bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 8192) return send(413, "unavailable");
      body += chunk;
    }
    const input = Input.parse(JSON.parse(body));
    const keyword = xiaohongshuQuery(input.query) || input.query;
    const cached = cache.get(keyword, input.limit);
    if (cached)
      return send(200, "ok", cached, { cacheHit: true, queryUsed: keyword });
    if (running >= 2) return send(200, "busy");
    running++;
    counted = true;
    // The upstream search uses its dedicated authenticated browser session.
    // Reopening /explore for a separate login probe costs another 5 seconds.
    const found = await upstream("/api/v1/feeds/search", { keyword }, signal);
    if (!found.success || !Array.isArray(found.data?.feeds))
      return send(200, "unavailable");
    const feeds = found.data.feeds
      .filter(
        (f) => /^[a-zA-Z0-9_-]+$/.test(f.id || "") && f.xsecToken && f.noteCard,
      )
      .slice(0, input.limit);
    const items = await Promise.all(
      feeds.map(async (feed, index) => {
        let detail = null;
        if (index < 2 && !signal.aborted) {
          try {
            const r = await upstream(
              "/api/v1/feeds/detail",
              {
                feed_id: feed.id,
                xsec_token: feed.xsecToken,
                load_all_comments: false,
              },
              signal,
            );
            if (r.success) detail = r.data?.data || r.data;
          } catch {
            /* Keep metadata honest when detail is unavailable. */
          }
        }
        return item(feed, detail);
      }),
    );
    cache.put(keyword, items);
    return send(200, items.length ? "ok" : "empty", items, {
      cacheHit: false,
      queryUsed: keyword,
    });
  } catch {
    return send(200, "unavailable");
  } finally {
    if (counted) running--;
  }
});
server.listen(config.port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      service: "campusos-external-search",
      host: "127.0.0.1",
      port: config.port,
      readOnly: true,
    }),
  ),
);
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => server.close(() => process.exit(0)));
