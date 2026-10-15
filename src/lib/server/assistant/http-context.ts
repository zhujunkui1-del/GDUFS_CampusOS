import { assistantBindings } from "./database";
import { AssistantStore } from "./store";
import { SharedRouteStore } from "./routes";
import { ApiError } from "../errors";
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
  const store = new AssistantStore(bindings.db);
  const identity = await store.identity(request);
  return {
    ...bindings,
    store,
    identity,
    routes: new SharedRouteStore(bindings.db, bindings.signingSecret),
    ip:
      bindings.environment === "local"
        ? "local-preview"
        : request.headers.get("CF-Connecting-IP") || "unknown-edge",
  };
}
export async function readJson(request: Request, maxBytes = 98304) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_ARGUMENT", "请求为空。");
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
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
