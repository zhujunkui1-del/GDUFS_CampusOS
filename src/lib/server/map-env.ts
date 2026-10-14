import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readServerEnv } from "./env";

export type MapRateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};
export function mapRuntime() {
  let bindings: Record<string, unknown> = {};
  try {
    bindings = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    /* Node development has no Worker bindings. */
  }
  // A broken model configuration must not invalidate independent public map services.
  const values: Record<string, string | undefined> = {};
  for (const name of [
    "APP_ENV",
    "AMAP_WEB_KEY",
    "AMAP_SECURITY_JS_CODE",
    "AMAP_WEBSERVICE_KEY",
  ]) {
    values[name] = process.env[name];
    if (typeof bindings[name] === "string")
      values[name] = bindings[name] as string;
  }
  return {
    env: readServerEnv(values),
    limiter: bindings.MAP_RATE_LIMITER as MapRateLimiter | undefined,
  };
}
