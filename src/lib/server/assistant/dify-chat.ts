import { ApiError } from "../errors";

const DIFY_CHAT_MESSAGES_URL = "https://dify.gdufs.edu.cn/v1/chat-messages";

export type DifyChatEvent = {
  event: string;
  answer?: string;
  conversation_id?: string;
  task_id?: string;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
  message?: string;
  code?: string;
  status?: string;
};

function parseEvent(frame: string): DifyChatEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new ApiError("UPSTREAM_ERROR", "深度思考返回格式异常。");
  }
  if (!parsed || typeof parsed !== "object")
    throw new ApiError("UPSTREAM_ERROR", "深度思考返回格式异常。");
  const value = parsed as Record<string, unknown>;
  if (typeof value.event !== "string") return null;
  return value as DifyChatEvent;
}

export async function* difyChatEvents(args: {
  apiKey: string;
  query: string;
  evidence: string;
  user: string;
  conversationId?: string;
  signal: AbortSignal;
}) {
  const response = await fetch(DIFY_CHAT_MESSAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      inputs: {},
      query: `用户原问题：\n${args.query}\n\n[[CAMPUSOS_D1_EVIDENCE_BEGIN]]\n${args.evidence}\n[[CAMPUSOS_D1_EVIDENCE_END]]\n\n请直接回答用户原问题。`,
      response_mode: "streaming",
      user: args.user,
      ...(args.conversationId ? { conversation_id: args.conversationId } : {}),
    }),
    signal: AbortSignal.any([args.signal, AbortSignal.timeout(90000)]),
    cache: "no-store",
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new ApiError(
      "UPSTREAM_ERROR",
      "Dify API 返回了重定向，未继续发送凭据。",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401)
      throw new ApiError("SERVICE_UNAVAILABLE", "深度思考 API 密钥无效。");
    if (response.status === 404)
      throw new ApiError("SERVICE_UNAVAILABLE", "Dify Chatflow 尚未发布。");
    throw new ApiError("UPSTREAM_ERROR", "深度思考暂不可用，请稍后重试。", true);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json")) {
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError("UPSTREAM_ERROR", "Dify API 返回的 JSON 无法解析。");
    }
    if (!value || typeof value !== "object")
      throw new ApiError("UPSTREAM_ERROR", "Dify API 返回格式异常。");
    const result = value as Record<string, unknown>;
    if (typeof result.answer !== "string" || !result.answer.trim())
      throw new ApiError("UPSTREAM_ERROR", "Dify API 未返回最终答复。");
    yield {
      event: "message",
      answer: result.answer,
      ...(typeof result.conversation_id === "string"
        ? { conversation_id: result.conversation_id }
        : {}),
      ...(typeof result.task_id === "string" ? { task_id: result.task_id } : {}),
      ...(result.metadata && typeof result.metadata === "object"
        ? { metadata: result.metadata as Record<string, unknown> }
        : {}),
    };
    return;
  }
  if (!contentType.includes("text/event-stream")) {
    await response.body?.cancel().catch(() => {});
    const safeContentType = contentType.split(";")[0].trim();
    throw new ApiError(
      "UPSTREAM_ERROR",
      `Dify API 返回了非流式响应（HTTP ${response.status}，${safeContentType || "Content-Type 缺失"}）。`,
      true,
    );
  }
  if (!response.body)
    throw new ApiError("UPSTREAM_ERROR", "深度思考没有返回内容。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      args.signal.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separator.length);
        const event = parseEvent(frame);
        if (event) yield event;
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const event = parseEvent(buffer);
      if (event) yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function stopDifyChat(apiKey: string, taskId: string, user: string) {
  await fetch(`${DIFY_CHAT_MESSAGES_URL}/${encodeURIComponent(taskId)}/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user }),
    signal: AbortSignal.timeout(2500),
    cache: "no-store",
  }).catch(() => {});
}
