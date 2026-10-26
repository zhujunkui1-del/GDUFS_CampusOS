import { z } from "zod";
import { assistantBindings } from "../assistant/database";
import { readJson } from "../assistant/http-context";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { RelayFinishSchema } from "@/domain/retrieval/relay";
import { claimRelay, finishRelay } from "./relay";
async function authenticate(request: Request) {
  const ctx = assistantBindings(),
    key = ctx.externalSearch.gatewayToken;
  if (
    ctx.environment !== "preview" ||
    ctx.externalSearch.transport !== "d1-relay" ||
    !key ||
    key.length < 32
  )
    throw new ApiError("SERVICE_UNAVAILABLE", "搜索执行器尚未配置。");
  const incoming = request.headers.get("Authorization") || "";
  if (incoming.length > 512)
    throw new ApiError("UNAUTHORIZED", "执行器认证失败。");
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const a = await digest(incoming),
    b = await digest("Bearer " + key);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  if (different) throw new ApiError("UNAUTHORIZED", "执行器认证失败。");
  return ctx;
}
export const relayClaimPost = withApi(async (request) => {
  const ctx = await authenticate(request);
  const input = z
    .object({
      runnerId: z.string().uuid(),
      waitMs: z.number().int().min(0).max(20000).default(20000),
    })
    .strict()
    .parse(await readJson(request, 1024));
  return claimRelay(ctx.db, input.runnerId, input.waitMs, request.signal);
});
export const relayFinishPost = withApi(async (request) => {
  const ctx = await authenticate(request);
  const input = RelayFinishSchema.parse(await readJson(request, 24576));
  return finishRelay(ctx.db, input.id, input.runnerId, input.result);
});
