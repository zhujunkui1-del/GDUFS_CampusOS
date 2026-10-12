import { ApiError } from "./errors";
import { mapRuntime } from "./map-env";

const endpoints = new Set([
  "v3/assistant/coordinate/convert",
  "v3/place/text",
  "v3/place/around",
  "v3/place/polygon",
  "v3/place/detail",
  "v3/direction/walking",
  "v3/assistant/inputtips",
  "v3/log/init",
]);
const buckets = new Map<string, { count: number; expires: number }>();
export function buildAMapTarget(
  request: Request,
  path: string[],
  webKey: string,
  securityCode: string,
) {
  const local = new URL(request.url);
  const endpoint = path.join("/");
  if (!endpoints.has(endpoint))
    throw new ApiError("NOT_FOUND", "该地图服务不受支持。");
  if (local.search.length > 8000 || local.searchParams.get("key") !== webKey)
    throw new ApiError("INVALID_ARGUMENT", "地图请求参数不正确。");
  const callback = local.searchParams.get("callback");
  if (callback && !/^[\w$.]{1,100}$/.test(callback))
    throw new ApiError("INVALID_ARGUMENT", "地图回调参数不正确。");
  const target = new URL(`https://restapi.amap.com/${endpoint}`);
  const allowed = new Set([
    "key",
    "callback",
    "output",
    "platform",
    "s",
    "logversion",
    "appname",
    "sdkversion",
    "keywords",
    "city",
    "citylimit",
    "types",
    "offset",
    "page",
    "extensions",
    "location",
    "radius",
    "sortrule",
    "polygon",
    "id",
    "origin",
    "destination",
    "coordsys",
    "locations",
    "strategy",
    "batch",
    "eventId",
    "product",
    "t",
    "csid",
    "resolution",
    "mob",
    "vt",
    "dpr",
    "scale",
    "label",
    "value",
  ]);
  for (const [name, value] of local.searchParams) {
    if (allowed.has(name)) target.searchParams.set(name, value);
  }
  target.searchParams.set("jscode", securityCode);
  return target;
}
export async function proxyAMap(request: Request, path: string[]) {
  const { env, limiter } = mapRuntime();
  if (!env.AMAP_WEB_KEY || !env.AMAP_SECURITY_JS_CODE)
    throw new ApiError("SERVICE_UNAVAILABLE", "地图服务尚未配置。");
  const incoming = new URL(request.url);
  const referer = request.headers.get("referer");
  // Next's internal rewrite can use localhost in request.url; Host retains the public authority.
  const publicHost = request.headers.get("host") || incoming.host;
  if (referer && new URL(referer).host !== publicHost)
    throw new ApiError("FORBIDDEN", "地图服务只允许本站使用。");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError("FORBIDDEN", "地图服务只允许本站使用。");
  const target = buildAMapTarget(
    request,
    path,
    env.AMAP_WEB_KEY,
    env.AMAP_SECURITY_JS_CODE,
  );
  const caller =
    env.APP_ENV === "local" ? "local" : request.headers.get("cf-connecting-ip");
  if (env.APP_ENV !== "local" && (!limiter || !caller))
    throw new ApiError("SERVICE_UNAVAILABLE", "地图限流服务尚未配置。");
  if (limiter) {
    const result = await limiter.limit({ key: `map:${caller}` });
    if (!result.success)
      throw new ApiError("RATE_LIMITED", "地图查询过于频繁，请稍后再试。");
  } else {
    const now = Date.now();
    const bucket = buckets.get("local");
    if (!bucket || bucket.expires < now)
      buckets.set("local", { count: 1, expires: now + 60000 });
    else if (++bucket.count > 180)
      throw new ApiError("RATE_LIMITED", "地图查询过于频繁，请稍后再试。");
  }
  try {
    const response = await fetch(target.toString(), {
      signal: AbortSignal.timeout(12000),
      // Workers supports manual/follow; reject 3xx below instead of following it.
      redirect: "manual",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok)
      throw new ApiError("UPSTREAM_ERROR", "高德地图服务暂时不可用。", true);
    const body = await response.text();
    if (body.length > 1_000_000 || body.includes(env.AMAP_SECURITY_JS_CODE))
      throw new ApiError("UPSTREAM_ERROR", "地图响应未通过校验。");
    return new Response(body, {
      headers: {
        "Content-Type": incoming.searchParams.has("callback")
          ? "application/javascript; charset=utf-8"
          : "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : "";
    const diagnostic = message
      .replaceAll(env.AMAP_WEB_KEY, "[credential]")
      .replaceAll(env.AMAP_SECURITY_JS_CODE, "[credential]")
      .replace(/https?:\/\/\S+/g, "[upstream-url]")
      .slice(0, 160);
    console.info(
      JSON.stringify({
        event: "map.upstream.failure",
        kind: error instanceof Error ? error.name : "unknown",
        reason: message.includes("cache")
          ? "cache_option"
          : message.includes("certificate") ||
              message.includes("SSL") ||
              message.includes("TLS")
            ? "tls"
            : message.includes("DNS")
              ? "dns"
              : message.includes("aborted")
                ? "timeout"
                : "network",
        diagnostic,
      }),
    );
    throw new ApiError(
      "UPSTREAM_ERROR",
      "无法连接高德地图服务，请稍后重试。",
      true,
    );
  }
}
