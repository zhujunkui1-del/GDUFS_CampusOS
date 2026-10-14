import { z } from "zod";
import type { ModelClient, ModelSnapshot } from "@/domain/models/contracts";
import { ApiError } from "../errors";
import {
  DeepseekModelClient,
  MODEL_POLICY_VERSION,
  approvedDeepseekEndpoint,
} from "./deepseek";

export type DefaultModelConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  capabilityReceipt?: string;
};
export const CapabilityReceiptSchema = z
  .object({
    provider: z.literal("deepseek"),
    model: z.string().max(100),
    policyVersion: z.literal(MODEL_POLICY_VERSION),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    testedAt: z.iso.datetime(),
    toolCalling: z.literal(true),
    jsonObject: z.literal(true),
    strictJsonSchema: z.literal(false),
  })
  .strict();
export type CapabilityReceipt = z.infer<typeof CapabilityReceiptSchema>;
export async function configurationFingerprint(config: DefaultModelConfig) {
  const endpoint = approvedDeepseekEndpoint(
    config.baseUrl || "https://api.deepseek.com",
  );
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      MODEL_POLICY_VERSION,
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
  create(provider: "deepseek", config: DefaultModelConfig): ModelClient {
    if (provider !== "deepseek")
      throw new ApiError("MODEL_SELECTION_REQUIRED", "供应商未配置。");
    return new DeepseekModelClient(
      config.model || "",
      config.apiKey || "",
      config.baseUrl,
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
    const age = this.now() - Date.parse(receipt.testedAt);
    if (
      age < 0 ||
      age > 24 * 60 * 60 * 1000 ||
      receipt.model !== this.#config.model ||
      receipt.fingerprint !== (await configurationFingerprint(this.#config))
    )
      throw new ApiError(
        "MODEL_TEST_REQUIRED",
        "默认模型配置已变化或验证已过期。",
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
