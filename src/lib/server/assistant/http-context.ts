import { assistantBindings } from "./database";
import { AssistantStore } from "./store";
import { SharedRouteStore } from "./routes";
import { ApiError } from "../errors";
import { databaseTimings } from "./timings";
import { trustedClientIp } from "../request-ip";
export function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  const target = new URL(request.url);
  const source = origin ? new URL(origin) : null;
  // OpenNext's local adapter rewrites 127.0.0.1 to localhost. Only equal-port loopback aliases are equivalent.
  const loopback = (host: string) =>
    ["127.0.0.1", "localhost", "[::1]"].includes(host);
  const localAlias =
    source &&
    loopback(source.hostname) &&
    loopback(target.hostname) &&
    source.port === target.port &&
    source.protocol === target.protocol;
  if (
    request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (source && source.origin !== target.origin && !localAlias)
  )
    throw new ApiError("FORBIDDEN", "请求来源不受支持。");
}
export async function assistantContext(request: Request) {
  sameOrigin(request);
  const bindings = assistantBindings();
  const timing = databaseTimings(bindings.db);
  const store = new AssistantStore(
    timing.db,
    undefined,
    bindings.openValidation,
  );
  const identity = await store.identity(request);
  return {
    ...bindings,
    db: timing.db,
    databaseTiming: timing.snapshot,
    store,
    identity,
    routes: new SharedRouteStore(timing.db, bindings.signingSecret),
    ip:
      bindings.environment === "local"
        ? "local-preview"
        : trustedClientIp(request, bindings.gatewayProxySecret) ||
          "unknown-edge",
  };
}
export async function readJson(
  request: Request,
  maxBytes = 98304,
  allowEmpty = false,
) {
  const reader = request.body?.getReader();
  if (!reader) {
    if (allowEmpty) return undefined;
    throw new ApiError("INVALID_ARGUMENT", "请求为空。");
  }
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError("TIMEOUT", "请求接收超时。", true));
      void reader.cancel().catch(() => {});
    }, 5000);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes)
        throw new ApiError("INVALID_ARGUMENT", "请求过长。");
      text += decoder.decode(part.value, { stream: true });
    }
    const body = text + decoder.decode();
    if (allowEmpty && !body.trim()) return undefined;
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
