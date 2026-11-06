import { z } from "zod";
import type { ModelClient, ModelSnapshot } from "@/domain/models/contracts";
import { ApiError } from "../errors";
import {
  DeepseekModelClient,
  GDUFS_POLICY_VERSION,
  MODEL_POLICY_VERSION,
  approvedDeepseekEndpoint,
  approvedGdufsEndpoint,
  approvedStepEndpoint,
  STEP_POLICY_VERSION,
  type ProviderId,
} from "./deepseek";

export type DefaultModelConfig = {
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  capabilityReceipt?: string;
  maxOutputTokens?: number;
  providerManagedOutput?: boolean;
};
export const policyVersionFor = (provider: ProviderId | undefined) =>
  provider === "gdufs"
    ? GDUFS_POLICY_VERSION
    : provider === "stepfun"
      ? STEP_POLICY_VERSION
      : MODEL_POLICY_VERSION;
export const CapabilityReceiptSchema = z
  .object({
    provider: z.enum(["deepseek", "stepfun", "gdufs"]),
    model: z.string().max(100),
    policyVersion: z.enum([
      MODEL_POLICY_VERSION,
      STEP_POLICY_VERSION,
      GDUFS_POLICY_VERSION,
    ]),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    testedAt: z.iso.datetime(),
    toolCalling: z.literal(true),
    jsonObject: z.literal(true),
    strictJsonSchema: z.literal(false),
  })
  .strict();
export type CapabilityReceipt = z.infer<typeof CapabilityReceiptSchema>;
export async function configurationFingerprint(config: DefaultModelConfig) {
  const endpoint =
    config.provider === "gdufs"
      ? approvedGdufsEndpoint(
          config.baseUrl || "https://modelsq.gdufs.edu.cn/v1-openai",
        )
      : config.provider === "stepfun"
        ? approvedStepEndpoint(
            config.baseUrl || "https://api.stepfun.com/step_plan/v1",
          )
        : approvedDeepseekEndpoint(
            config.baseUrl || "https://api.deepseek.com",
          );
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      policyVersionFor(config.provider),
      endpoint,
      config.model,
      config.apiKey,
    ]),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Only registered providers can be constructed. No user URL/config ID reaches this factory.
export class ProviderRegistry {
  create(provider: ProviderId, config: DefaultModelConfig): ModelClient {
    if (!["deepseek", "stepfun", "gdufs"].includes(provider))
      throw new ApiError("MODEL_SELECTION_REQUIRED", "供应商未配置。");
    return new DeepseekModelClient(
      config.model || "",
      config.apiKey || "",
      config.baseUrl,
      fetch,
      config.providerManagedOutput ? 60000 : 15000,
      provider,
      config.maxOutputTokens,
      config.providerManagedOutput,
    );
  }
}
export class ModelRouter {
  #config: DefaultModelConfig;
  constructor(
    config: DefaultModelConfig,
    private readonly providers = new ProviderRegistry(),
    private readonly now = () => Date.now(),
  ) {
    this.#config = { ...config };
  }
  async resolve(): Promise<{ client: ModelClient; snapshot: ModelSnapshot }> {
    if (!this.#config.apiKey || !this.#config.model)
      throw new ApiError("MODEL_SELECTION_REQUIRED", "默认模型尚未配置。");
    let receipt: CapabilityReceipt;
    try {
      receipt = CapabilityReceiptSchema.parse(
        JSON.parse(this.#config.capabilityReceipt || ""),
      );
    } catch {
      throw new ApiError("MODEL_TEST_REQUIRED", "默认模型需要完成能力验证。");
    }
    // Platform credentials are operator-managed, not short-lived BYOK grants.
    // Revalidate on configuration/policy changes, not by taking chat offline daily.
    const age = this.now() - Date.parse(receipt.testedAt);
    if (
      age < 0 ||
      receipt.model !== this.#config.model ||
      receipt.provider !== (this.#config.provider || "deepseek") ||
      receipt.policyVersion !== policyVersionFor(this.#config.provider) ||
      receipt.fingerprint !== (await configurationFingerprint(this.#config))
    )
      throw new ApiError(
        "MODEL_TEST_REQUIRED",
        "默认模型配置已变化，需要重新验证。",
      );
    return {
      client: this.providers.create(receipt.provider, { ...this.#config }),
      snapshot: {
        source: "platform",
        provider: receipt.provider,
        model: receipt.model,
        policyVersion: receipt.policyVersion,
        testedAt: receipt.testedAt,
        capabilities: {
          toolCalling: true,
          jsonObject: true,
          strictJsonSchema: false,
        },
      },
    };
  }
  async status() {
    try {
      const { snapshot } = await this.resolve();
      return { ready: true as const, model: snapshot };
    } catch (error) {
      return {
        ready: false as const,
        code:
          error instanceof ApiError ? error.code : "MODEL_SERVICE_UNAVAILABLE",
      };
    }
  }
}
