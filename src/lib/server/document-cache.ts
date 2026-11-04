/** Revalidate document shells; only content-addressed static assets are immutable. */
export function revalidateDocument(response: Response) {
  if (!response.headers.get("content-type")?.includes("text/html"))
    return response;
  if (
    /\b(?:private|no-store)\b/i.test(
      response.headers.get("cache-control") || "",
    )
  )
    return response;
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
  copy.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  return copy;
}
