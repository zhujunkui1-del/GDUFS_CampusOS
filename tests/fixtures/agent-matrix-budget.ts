import { ApiError } from "@/lib/server/errors";

export function createMatrixTransport(limit: number, transport: typeof fetch) {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new Error("Set a positive matrix token limit");
  let reserved = 0;
  let calls = 0;
  let rejected = 0;
  const guarded: typeof fetch = async (url, init) => {
    if (typeof init?.body !== "string")
      throw new Error("Expected a serialized model request");
    const payload: { max_tokens?: number } = JSON.parse(init.body);
    const completion = payload.max_tokens;
    if (!completion || !Number.isSafeInteger(completion) || completion < 1)
      throw new Error("A provider-side output cap is required");
    // Reserve the full UTF-8 request size plus framing allowance and capped output.
    // Failed and timed-out calls keep their reservation because usage may be unknown.
    const allowance = Buffer.byteLength(init.body, "utf8") + 4096 + completion;
    if (reserved + allowance > limit) {
      rejected++;
      throw new ApiError("RUN_LIMIT_EXCEEDED", "隔离验收已达到模型预算上限。");
    }
    reserved += allowance;
    calls++;
    return transport(url, init);
  };
  return {
    transport: guarded,
    usage: () => ({ limit, reserved, calls, rejected }),
  };
}
