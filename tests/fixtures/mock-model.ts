import type { z } from "zod";
import type {
  ModelClient,
  ModelReply,
  ModelRequest,
} from "@/domain/models/contracts";

// Scripted provider exists only in tests and is never selected by production configuration.
export class MockModelProvider implements ModelClient {
  requests: ModelRequest[] = [];
  constructor(
    private readonly replies: (
      ModelReply | Error | ((request: ModelRequest) => Promise<ModelReply>)
    )[],
    private readonly structured: unknown = {},
  ) {}
  async generateWithTools(request: ModelRequest) {
    this.requests.push(request);
    const next = this.replies.shift();
    if (!next) throw new Error("Mock script exhausted");
    if (next instanceof Error) throw next;
    const reply = typeof next === "function" ? await next(request) : next;
    if (reply.content) request.onText?.(reply.content);
    return reply;
  }
  async generateStructured<T>(
    _request: Omit<ModelRequest, "tools" | "onText" | "toolChoice">,
    schema: z.ZodType<T>,
  ) {
    return schema.parse(this.structured);
  }
}
