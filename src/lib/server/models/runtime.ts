import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ModelRouter } from "./router";
import { PriorityModelRouter } from "./priority";

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
  // The owner can change the order for one environment without touching code.
  // The campus gateway is only reachable from the campus network, so it is
  // never part of the default chain: it joins only when the operator selects
  // it explicitly with MODEL_PRIORITY=gdufs. A gateway that cannot be reached
  // would otherwise swallow the quota fallback that used to reach deepseek.
  const ordered =
    value("MODEL_PRIORITY") === "gdufs"
      ? [gdufs, step, deepseek]
      : value("MODEL_PRIORITY") === "deepseek"
        ? [deepseek, step]
        : [step, deepseek];
  const tiers = ordered.filter(
    (tier): tier is ModelRouter => tier !== null,
  );
  return tiers.length === 1
    ? tiers[0]
    : new PriorityModelRouter(tiers[0], tiers.slice(1));
}
