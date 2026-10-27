import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ModelRouter } from "./router";
import { PriorityModelRouter } from "./priority";

export function defaultModelRuntime() {
  let bindings: Record<string, unknown> = {};
  try {
    bindings = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    /* Node dev */
  }
  const value = (name: string) =>
    typeof bindings[name] === "string"
      ? (bindings[name] as string)
      : process.env[name];
  const deepseek = new ModelRouter({
    maxOutputTokens: value("MODEL_MAX_OUTPUT_TOKENS") === "2048" ? 2048 : 1024,
    apiKey: value("MODEL_API_KEY"),
    model: value("MODEL_NAME"),
    baseUrl: value("MODEL_BASE_URL"),
    capabilityReceipt: value("MODEL_CAPABILITIES_JSON"),
  });
  if (!value("PRIMARY_MODEL_API_KEY")) return deepseek;
  return new PriorityModelRouter(
    new ModelRouter({
      provider: "stepfun",
      maxOutputTokens:
        value("MODEL_MAX_OUTPUT_TOKENS") === "2048" ? 2048 : 1024,
      apiKey: value("PRIMARY_MODEL_API_KEY"),
      model: value("PRIMARY_MODEL_NAME"),
      baseUrl: value("PRIMARY_MODEL_BASE_URL"),
      capabilityReceipt: value("PRIMARY_MODEL_CAPABILITIES_JSON"),
    }),
    deepseek,
  );
}
