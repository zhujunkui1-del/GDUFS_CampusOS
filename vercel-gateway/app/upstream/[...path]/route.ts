import { proxyTo, upstreamUrl } from "@/lib/proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function handler(request: Request) {
  const incoming = new URL(request.url);
  const pathname = incoming.pathname.replace(/^\/upstream/, "");
  return proxyTo(request, upstreamUrl(pathname, incoming.search));
}

export {
  handler as GET,
  handler as HEAD,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
};
