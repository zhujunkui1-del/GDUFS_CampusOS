import { z } from "zod";
import { AgentOrchestrator } from "../agent/orchestrator";
import { SkillRegistry } from "../agent/skill-registry";
import { ApiError } from "../errors";
import type { ModelClient, ModelRequest } from "@/domain/models/contracts";
import {
  DeepseekModelClient,
  MODEL_POLICY_VERSION,
  STEP_POLICY_VERSION,
} from "./deepseek";
import {
  configurationFingerprint,
  type CapabilityReceipt,
  type DefaultModelConfig,
} from "./router";

// Operational-only probe, never imported by an API route or the production Skill Registry.
export async function verifyDefaultModel(config: DefaultModelConfig) {
  const start = performance.now();
  const signal = AbortSignal.timeout(20000);
  const client = new DeepseekModelClient(
    config.model || "",
    config.apiKey || "",
    config.baseUrl,
    fetch,
    15000,
    config.provider || "deepseek",
  );
  let requests = 0;
  const nonce = crypto.randomUUID();
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const bounded = (request: ModelRequest): ModelRequest => {
    if (++requests > 3)
      throw new ApiError("MODEL_TEST_BUDGET_EXCEEDED", "模型验证超过预算。");
    return {
      ...request,
      signal: AbortSignal.any([signal, request.signal]),
      maxTokens: 256,
    };
  };
  const diagnosticClient: ModelClient = {
    generateWithTools: (request) =>
      client.generateWithTools({
        ...bounded(request),
        ...(requests === 1
          ? {
              toolChoice: {
                type: "function",
                function: { name: "campusos_diagnostic" },
              } as const,
            }
          : {}),
      }),
    generateStructured: (request, schema) =>
      client.generateStructured(bounded({ ...request, tools: [] }), schema),
  };
  const registry = new SkillRegistry().register("spatial-domain", {
    name: "campusos_diagnostic",
    version: "test-only-v1",
    description:
      "Return the exact supplied diagnostic nonce. No business data or side effects.",
    inputSchema: z.object({ nonce: z.literal(nonce) }).strict(),
    outputSchema: z.object({ nonce: z.literal(nonce) }).strict(),
    auth: "public",
    sideEffect: "none",
    requiresConfirmation: false,
    timeoutMs: 1000,
    execute: async (input) => ({ ok: true, data: input }),
  });
  const testedAt = new Date().toISOString();
  const orchestrator = new AgentOrchestrator(
    {
      resolve: async () => ({
        client: diagnosticClient,
        snapshot: {
          source: "platform",
          provider: config.provider || "deepseek",
          model: config.model!,
          policyVersion:
            config.provider === "stepfun"
              ? STEP_POLICY_VERSION
              : MODEL_POLICY_VERSION,
          testedAt,
          capabilities: {
            toolCalling: true,
            jsonObject: true,
            strictJsonSchema: false,
          },
        },
      }),
    },
    registry,
  );
  const run = await orchestrator.run({
    message: `Call campusos_diagnostic with nonce "${nonce}" exactly once. After the tool result, reply with exactly OK:${nonce}. This is an isolated connection test, not a campus lookup.`,
    context: {
      requestId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
      signal,
    },
    onEvent: (event) =>
      events.push({ type: event.type, payload: event.payload }),
  });
  const result = events.find((event) => event.type === "tool.finished")?.payload
    .result;
  const validated = z
    .object({
      ok: z.literal(true),
      data: z.object({ nonce: z.literal(nonce) }),
    })
    .safeParse(result);
  const text = events
    .filter((event) => event.type === "message.delta")
    .map((event) => event.payload.text)
    .join("");
  if (
    run.status !== "completed" ||
    run.toolCalls !== 1 ||
    requests !== 2 ||
    !validated.success ||
    !text.includes(`OK:${nonce}`)
  )
    throw new ApiError(
      "MODEL_TOOLS_UNSUPPORTED",
      "模型工具调用或结果回传未通过验证。",
    );
  await diagnosticClient.generateStructured(
    {
      messages: [
        {
          role: "user",
          content:
            'Return JSON matching this schema: {"status":"ready"}. No other keys.',
        },
      ],
      maxTokens: 256,
      signal,
    },
    z.object({ status: z.literal("ready") }).strict(),
  );
  const receipt: CapabilityReceipt = {
    provider: config.provider || "deepseek",
    model: config.model!,
    policyVersion:
      config.provider === "stepfun"
        ? STEP_POLICY_VERSION
        : MODEL_POLICY_VERSION,
    fingerprint: await configurationFingerprint(config),
    testedAt,
    toolCalling: true,
    jsonObject: true,
    strictJsonSchema: false,
  };
  return {
    receipt,
    evidence: {
      provider: config.provider || "deepseek",
      model: config.model,
      realApi: true,
      generation: "passed",
      toolCalling: "passed",
      toolResultFollowup: "passed",
      streaming: "passed",
      jsonObjectWithServerSchema: "passed",
      strictJsonSchema: "not_tested",
      requests,
      maxOutputTokensPerRequest: 256,
      durationMs: Math.round(performance.now() - start),
      testedAt,
      events: events.map((event) => ({
        type: event.type,
        ...(event.type === "tool.started" || event.type === "tool.finished"
          ? {
              name: event.payload.name,
              ...(event.type === "tool.finished"
                ? { ok: validated.success }
                : {}),
            }
          : {}),
      })),
      diagnosticToolOnly: true,
      businessSkillsTested: false,
    },
  };
}
