import type { z } from "zod";

export type ModelTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
export type ModelToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ModelToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ModelRequest = {
  messages: readonly ModelMessage[];
  tools: readonly ModelTool[];
  maxTokens: number;
  signal: AbortSignal;
  onText?: (text: string) => void;
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
};
export type ModelReply = {
  content: string;
  toolCalls: ModelToolCall[];
  finishReason: "stop" | "tool_calls";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedPromptTokens?: number;
  };
};

export interface ModelClient {
  generateWithTools(request: ModelRequest): Promise<ModelReply>;
  generateStructured<T>(
    request: Omit<ModelRequest, "tools" | "onText" | "toolChoice">,
    schema: z.ZodType<T>,
  ): Promise<T>;
}
export type ModelProviderId =
  | "gdufs"
  | "deepseek"
  | "stepfun"
  | "openai"
  | "anthropic"
  | "gemini";
export type ModelSnapshot = {
  source: "platform" | "personal";
  provider: ModelProviderId;
  model: string;
  policyVersion: string;
  testedAt: string;
  capabilities: {
    toolCalling: true;
    jsonObject: true;
    strictJsonSchema: false;
  };
};
