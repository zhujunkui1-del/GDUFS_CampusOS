import type { ModelClient } from "@/domain/models/contracts";
import { EVIDENCE_VERDICT_TOOL } from "./evidence-check";
export type WorkflowRecord = {
  node: string;
  span: string;
  phase?: "evidence_check";
  state: "running" | "success" | "skipped" | "error" | "unconfirmed";
  at: string;
  elapsedMs: number;
  durationMs?: number;
  data: unknown;
};
export class WorkflowTrace {
  records: WorkflowRecord[] = [];
  private sink?: (record: WorkflowRecord) => void;
  private sequence = 0;
  constructor(
    readonly enabled: boolean,
    private startAt = performance.now(),
  ) {}
  attach(sink: (record: WorkflowRecord) => void) {
    this.sink = sink;
    for (const record of this.records) sink(record);
  }
  get attached() {
    return !!this.sink;
  }
  start(node: string, input: unknown = {}, phase?: WorkflowRecord["phase"]) {
    const started = performance.now(),
      span = node + ":" + ++this.sequence;
    const send = (state: WorkflowRecord["state"], data: unknown) => {
      if (!this.enabled) return;
      const record: WorkflowRecord = {
        node,
        span,
        ...(phase ? { phase } : {}),
        state,
        at: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - this.startAt),
        ...(state !== "running"
          ? { durationMs: Math.round(performance.now() - started) }
          : {}),
        data,
      };
      this.records.push(record);
      this.sink?.(record);
    };
    send("running", input);
    return (data: unknown = {}, state: WorkflowRecord["state"] = "success") =>
      send(state, data);
  }
}
export function observeWorkflowModel(
  client: ModelClient,
  trace: WorkflowTrace,
  model: string,
): ModelClient {
  if (!trace.enabled) return client;
  return {
    async generateWithTools(request) {
      // The evidence checker records the parsed verdict and its own deadline.
      if (request.tools[0] === EVIDENCE_VERDICT_TOOL)
        return client.generateWithTools(request);
      const finish = trace.start("model", {
        model,
        phase: request.tools.length ? "回答或工具选择" : "回答生成",
        tools: request.tools.map((tool) => tool.function.name),
      });
      try {
        const result = await client.generateWithTools(request);
        finish({
          finishReason: result.finishReason,
          toolCalls: result.toolCalls.map((call) => call.function.name),
          characters: result.content.length,
          usage: result.usage,
        });
        return result;
      } catch (error) {
        finish({ status: "模型请求失败" }, "error");
        throw error;
      }
    },
    async generateStructured(request, schema) {
      const finish = trace.start("model", { model, phase: "结构化问题理解" });
      try {
        const result = await client.generateStructured(request, schema);
        finish({ format: "structured" });
        return result;
      } catch (error) {
        finish({ status: "结构化请求失败" }, "error");
        throw error;
      }
    },
  };
}
