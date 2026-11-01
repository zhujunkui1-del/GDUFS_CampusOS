import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { withApi } from "@/lib/server/http";
import { ApiError } from "@/lib/server/errors";
import { readJson } from "@/lib/server/assistant/http-context";
import { primaryDatabase, type SqlDatabase } from "@/lib/server/assistant/database";
import { authLimit, assertAccountOrigin } from "@/lib/server/account/security";
import { testPersonalConnection } from "@/lib/server/models/personal-client";
import { MODEL_PROVIDER_IDS } from "@/domain/models/providers";

const Input = z
  .object({
    provider: z.string().refine((v) => MODEL_PROVIDER_IDS.includes(v as never)),
    baseUrl: z.string().trim().min(1).max(500),
    model: z.string().trim().min(1).max(120),
    apiKey: z.string().trim().min(1).max(4096),
  })
  .strict();

export const dynamic = "force-dynamic";

/**
 * Guest connection tests are deliberately one-shot: no credential is stored
 * server-side, and the browser keeps the form only in component state.
 */
export async function POST(request: Request) {
  return withApi(async () => {
    const { env } = getCloudflareContext();
    const values = env as unknown as Record<string, unknown>;
    if (!values.DB)
      throw new ApiError("SERVICE_UNAVAILABLE", "账号服务暂不可用。", true);
    assertAccountOrigin(request, new URL(request.url).origin);
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    await authLimit(
      primaryDatabase(values.DB as SqlDatabase),
      "guest_model_test:ip",
      ip,
      10,
      3600000,
    );
    return testPersonalConnection(Input.parse(await readJson(request, 8192)));
  })(request);
}
