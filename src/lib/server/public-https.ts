const PUBLIC_HOSTS = new Set([
  "gdufs.zhiyuapp.site",
  "gdufs.ccwu.cc",
  "campusos.zhiyuapp.site",
  "campusos-preview.zhujunkui1.workers.dev",
]);

/** Upgrade public navigation before client APIs require a secure browser context. */
export function publicHttpsRedirect(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (
    url.protocol !== "http:" ||
    !PUBLIC_HOSTS.has(url.hostname) ||
    !["GET", "HEAD"].includes(request.method) ||
    url.pathname.startsWith("/api/")
  )
    return;
  url.protocol = "https:";
  url.port = "";
  return new Response(null, {
    status: 308,
    headers: { Location: url.href, "Cache-Control": "no-store" },
  });
}
