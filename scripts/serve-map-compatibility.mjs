// Isolated, map-only real-device harness. No account, AI, admin or private APIs.
import http from "node:http";
import { gzipSync } from "node:zlib";
import { appendFileSync, mkdirSync } from "node:fs";
const port = Number(process.env.MAP_TEST_PORT || 3037);
const upstream = process.env.MAP_TEST_UPSTREAM || "http://127.0.0.1:3036";
const output = ".map-tools/map-phone-results.jsonl";
mkdirSync(".map-tools", { recursive: true });
import { diagnostics } from "./map-device-probe.mjs";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://map-test.local");
  if (url.pathname === "/") {
    res.writeHead(307, { Location: "/map", "Cache-Control": "no-store" }).end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/__map_report") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 30000) {
        res.writeHead(413).end();
        return;
      }
    }
    try {
      const value = JSON.parse(body);
      if (!value.state || !Array.isArray(value.resources)) throw Error();
      appendFileSync(output, JSON.stringify(value) + "\n");
      res.writeHead(204, { "Cache-Control": "no-store" }).end();
      console.log(
        JSON.stringify({
          event: "phone-result",
          renderer: value.state.renderer,
          mode: value.state.mode,
          state: value.state.status,
        }),
      );
    } catch {
      res.writeHead(400).end();
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(403).end();
    return;
  }
  if (url.pathname === "/__map_probe.js") {
    res
      .writeHead(200, {
        "Content-Type": "text/javascript",
        "Cache-Control": "no-store",
      })
      .end(diagnostics);
    return;
  }
  if (url.pathname === "/api/auth/session") {
    res
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(
        JSON.stringify({
          ok: true,
          data: { user: null, enabled: true, emailAvailable: false },
        }),
      );
    return;
  }
  const allowed =
    url.pathname === "/map" ||
    /^\/(?:_next\/static|maps|models|vendor|fonts|images)\//.test(
      url.pathname,
    ) ||
    /^\/(?:favicon|icon|apple-icon)/.test(url.pathname);
  if (!allowed || /(?:^|\/)\.\.(?:\/|$)|%2e/i.test(req.url)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const target = new URL(url.pathname + url.search, upstream);
    const response = await fetch(target, {
      signal: AbortSignal.timeout(30000),
    });
    const headers = Object.fromEntries(
      [...response.headers].filter(
        ([key]) =>
          ![
            "set-cookie",
            "content-encoding",
            "content-length",
            "transfer-encoding",
          ].includes(key),
      ),
    );
    headers["Cache-Control"] =
      url.pathname === "/map"
        ? "no-store"
        : "public,max-age=31536000,immutable";
    let body = headers["content-type"]?.includes("text/html")
      ? Buffer.from(
          (await response.text()).replace(
            "<head>",
            '<head><script src="/__map_probe.js"></script>',
          ),
        )
      : Buffer.from(await response.arrayBuffer());
    if (
      body.length > 1024 &&
      req.headers["accept-encoding"]?.includes("gzip")
    ) {
      body = gzipSync(body);
      headers["Content-Encoding"] = "gzip";
      headers.Vary = "Accept-Encoding";
    }
    res.writeHead(response.status, headers).end(body);
  } catch {
    res.writeHead(502).end("Map test server unavailable");
  }
});
server.listen(port, "0.0.0.0", () =>
  console.log(`Map-only test listening on ${port}`),
);
