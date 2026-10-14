import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ModelRouter } from "./router";

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
  return new ModelRouter({
    apiKey: value("MODEL_API_KEY"),
    model: value("MODEL_NAME"),
    baseUrl: value("MODEL_BASE_URL"),
    capabilityReceipt: value("MODEL_CAPABILITIES_JSON"),
  });
}
