const UPSTREAM =
  process.env.CAMPUSOS_UPSTREAM || "https://gdufs.ccwu.cc";

const UPSTREAM_ORIGIN = new URL(UPSTREAM).origin;

export function upstreamUrl(pathname: string, search = "") {
  return new URL(pathname + search, UPSTREAM);
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function copyResponseHeaders(upstream: Response) {
  const headers = new Headers();

  for (const [key, value] of upstream.headers) {
    const name = key.toLowerCase();
    if (name === "set-cookie") continue;
    if (name === "content-encoding" || name === "content-length") continue;
    if (name === "etag") continue;
    if (HOP_BY_HOP.has(name)) continue;
    headers.append(key, value);
  }

  // `Headers` collapses Set-Cookie; preserve every cookie on Node 20+.
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) headers.append("set-cookie", cookie);

  const location = headers.get("location");
  if (location?.startsWith(UPSTREAM_ORIGIN)) {
    headers.set(
      "location",
      new URL(location).pathname +
        new URL(location).search +
        new URL(location).hash,
    );
  }

  return headers;
}

function rewriteNextAssetPaths(body: string) {
  // Vercel reserves `/_next/*` for its own build output, so upstream chunks
  // must be served through our public `/upstream/_next/*` route.
  return body.replaceAll("/_next/", "/upstream/_next/");
}

export async function proxy(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  return proxyTo(request, upstreamUrl(incoming.pathname, incoming.search));
}

export async function proxyTo(
  request: Request,
  target: URL,
): Promise<Response> {
  const incoming = new URL(request.url);
  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", "https");

  const forwardedFor =
    request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin === incoming.origin && (site === "same-origin" || site === "none")) {
    // The Worker only knows its own upstream origin. Bridge same-origin browser
    // requests, but never rewrite cross-site requests (CSRF protection).
    headers.set("origin", UPSTREAM_ORIGIN);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const headersOut = copyResponseHeaders(upstream);
  const type = upstream.headers.get("content-type") || "";

  if (
    request.method !== "HEAD" &&
    /^(text\/html|text\/css|text\/javascript|text\/x-component|application\/javascript|application\/x-javascript)/i.test(
      type,
    )
  ) {
    const body = await upstream.text();
    if (body.length <= 8_000_000) {
      return new Response(rewriteNextAssetPaths(body), {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: headersOut,
      });
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: headersOut,
  });
}
