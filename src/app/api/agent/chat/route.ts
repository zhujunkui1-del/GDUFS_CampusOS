import { AgentChatRequestSchema } from "@/domain/agent/contracts";
import { ApiError } from "@/lib/server/errors";
import { withApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const POST = withApi(async (request) => {
  if (Number(request.headers.get("Content-Length") || 0) > 8192)
    throw new ApiError("INVALID_ARGUMENT", "消息过长。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_ARGUMENT", "消息为空。");
  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError("TIMEOUT", "消息接收超时。", true));
      void reader.cancel().catch(() => {});
    }, 5000);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) throw new ApiError("INVALID_ARGUMENT", "消息过长。");
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  AgentChatRequestSchema.parse(JSON.parse(body));
  // S2-B/C must provide real business skills, owned context and shared quotas before enabling paid public chat.
  throw new ApiError("SERVICE_UNAVAILABLE", "AI 地图服务正在接入。");
});
