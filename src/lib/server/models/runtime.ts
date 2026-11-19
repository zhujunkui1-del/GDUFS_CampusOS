import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ModelRouter } from "./router";
import { modelPriorityOrder, PriorityModelRouter } from "./priority";

export function defaultModelRuntime(
  options: { providerManagedOutput?: boolean } = {},
) {
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
  const maxOutputTokens =
    value("MODEL_MAX_OUTPUT_TOKENS") === "2048" ? 2048 : 1024;
  const providerManagedOutput = options.providerManagedOutput === true;
  const deepseek = new ModelRouter({
    providerManagedOutput,
    maxOutputTokens,
    apiKey: value("MODEL_API_KEY"),
    model: value("MODEL_NAME"),
    baseUrl: value("MODEL_BASE_URL"),
    capabilityReceipt: value("MODEL_CAPABILITIES_JSON"),
  });
  const step = value("PRIMARY_MODEL_API_KEY")
    ? new ModelRouter({
        provider: "stepfun",
        providerManagedOutput,
        maxOutputTokens,
        apiKey: value("PRIMARY_MODEL_API_KEY"),
        model: value("PRIMARY_MODEL_NAME"),
        baseUrl: value("PRIMARY_MODEL_BASE_URL"),
        capabilityReceipt: value("PRIMARY_MODEL_CAPABILITIES_JSON"),
      })
    : null;
  // The campus gateway is reachable only from the campus network, so it is
  // built whenever a key exists but is not part of the default chain.
  const gdufs = value("GDUFS_MODEL_API_KEY")
    ? new ModelRouter({
        provider: "gdufs",
        providerManagedOutput,
        maxOutputTokens,
        apiKey: value("GDUFS_MODEL_API_KEY"),
        model: value("GDUFS_MODEL_NAME"),
        baseUrl: value("GDUFS_MODEL_BASE_URL"),
        capabilityReceipt: value("GDUFS_MODEL_CAPABILITIES_JSON"),
      })
    : null;
  // The owner sets the order per environment. DeepSeek is the default primary
  // model and StepFun the backup; MODEL_PRIORITY=stepfun restores the previous
  // Step-first order without touching code. The campus gateway is only
  // reachable from the campus network, so it never joins the default chain: it
  // leads only when the operator selects it explicitly with
  // MODEL_PRIORITY=gdufs. A gateway that cannot be reached would otherwise
  // swallow the fallback that reaches the next provider.
  const tiers: ModelRouter[] = [];
  for (const tier of modelPriorityOrder(value("MODEL_PRIORITY"))) {
    const router =
      tier === "gdufs" ? gdufs : tier === "stepfun" ? step : deepseek;
    if (router) tiers.push(router);
  }
  return tiers.length === 1
    ? tiers[0]
    : new PriorityModelRouter(tiers[0], tiers.slice(1));
}
