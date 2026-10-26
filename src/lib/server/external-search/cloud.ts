import {
  RelayInputSchema,
  RelayResultSchema,
  type RelayInput,
} from "@/domain/retrieval/relay";
import {
  SourceSessionResultSchema,
  CloudVerificationSchema,
} from "@/domain/console/dashboard";
import { ApiError } from "../errors";
export type CloudSearchBinding = { fetch(request: Request): Promise<Response> };
async function call(
  binding: CloudSearchBinding | undefined,
  token: string | undefined,
  path: string,
  input: unknown,
  signal?: AbortSignal,
) {
  if (!binding || !token)
    throw new ApiError("SERVICE_UNAVAILABLE", "云端搜索服务尚未配置。");
  const r = await binding.fetch(
    new Request("https://cloud-search.internal" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    }),
  );
  if (!r.ok) {
    await r.body?.cancel();
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      r.status === 503
        ? "云端搜索服务正在启动或繁忙，请稍后重试。"
        : "云端搜索服务暂不可用。",
      true,
    );
  }
  const reader = r.body?.getReader();
  if (!reader)
    throw new ApiError("SERVICE_UNAVAILABLE", "云端搜索未返回结果。");
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      bytes += p.value.byteLength;
      if (bytes > 190000)
        throw new ApiError("SERVICE_UNAVAILABLE", "云端搜索响应过大。");
      text += decoder.decode(p.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function createCloudSearch(
  binding: CloudSearchBinding | undefined,
  token: string | undefined,
) {
  return async (input: RelayInput, signal?: AbortSignal) => {
    const started = performance.now();
    try {
      return RelayResultSchema.parse(
        await call(
          binding,
          token,
          "/v1/search",
          RelayInputSchema.parse(input),
          signal,
        ),
      );
    } catch {
      return {
        provider: "cloud-container",
        status: "unavailable" as const,
        items: [],
        durationMs: Math.round(performance.now() - started),
      };
    }
  };
}
export async function cloudSourceSession(
  binding: CloudSearchBinding | undefined,
  token: string | undefined,
  action: "status" | "login" | "poll",
  signal?: AbortSignal,
) {
  return {
    ...SourceSessionResultSchema.parse(
      await call(binding, token, "/v1/session/" + action, {}, signal),
    ),
    location: "cloud" as const,
  };
}
export async function cloudVerification(
  binding: CloudSearchBinding | undefined,
  token: string | undefined,
  signal?: AbortSignal,
) {
  return CloudVerificationSchema.parse(
    await call(binding, token, "/v1/session/verify", {}, signal),
  );
}
