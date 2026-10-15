import { AgentEventSchema, type AgentEvent } from "@/domain/agent/contracts";
export async function readAgentStream(
  response: Response,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
) {
  if (
    !response.body ||
    !response.headers.get("Content-Type")?.includes("text/event-stream")
  )
    throw new Error("AI 连接异常，请重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "",
    bytes = 0,
    terminal = false,
    runId = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1048576) throw new Error("回复过长，请缩短问题。");
      pending += decoder.decode(chunk.value, { stream: true });
      let index: number;
      while ((index = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, index);
        pending = pending.slice(index + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = AgentEventSchema.parse(JSON.parse(data));
        if (runId && runId !== event.runId)
          throw new Error("回复会话不匹配，请重试。");
        runId = event.runId;
        if (event.type === "run.completed" || event.type === "run.failed")
          terminal = true;
        onEvent(event);
      }
    }
    if (!terminal) throw new Error("连接已中断，请重试。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
