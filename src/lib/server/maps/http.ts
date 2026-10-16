import { z } from "zod";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { mapRuntime } from "../map-env";
import { ToolExecutor } from "../agent/tool-executor";
import { mapSkillRegistry } from "./runtime";
import { assistantContext, sameOrigin } from "../assistant/http-context";
import { CampusMapService } from "./campus-map-service";
import { createMapSkillRegistry } from "./skills";
import { PlaceIdSchema } from "@/domain/maps/skill-contracts";
const skillNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const envelopeSchema = z
  .object({ input: z.unknown(), selectedPlaceId: PlaceIdSchema.optional() })
  .strict();

async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_ARGUMENT", "请求为空。");
  const decoder = new TextDecoder();
  let value = "",
    bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError("TIMEOUT", "请求接收超时。", true));
      void reader.cancel().catch(() => {});
    }, 5000);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), stopped]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16384) throw new ApiError("INVALID_ARGUMENT", "请求过长。");
      value += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(value + decoder.decode()) as unknown;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function executeMapSkillHttp(request: Request) {
  let cookie: string | undefined;
  const response = await withApi(async (req, apiContext) => {
    sameOrigin(req);
    const limiter = mapRuntime().limiter;
    if (
      limiter &&
      !(
        await limiter.limit({
          key: "skills:" + (req.headers.get("CF-Connecting-IP") || "local"),
        })
      ).success
    )
      throw new ApiError("RATE_LIMITED", "地图请求过于频繁。", true);
    const name = skillNameSchema.parse(
      new URL(req.url).pathname.split("/").at(-1),
    );
    if (!mapSkillRegistry.get(name))
      throw new ApiError("NOT_FOUND", "此工具未开放。");
    const envelope = envelopeSchema.parse(await body(req));
    if (envelope.input === undefined)
      throw new ApiError("INVALID_ARGUMENT", "缺少工具参数。");
    const session = await assistantContext(req);
    cookie = session.identity.cookie;
    const service = new CampusMapService(session.routes);
    const registry = createMapSkillRegistry(service);
    const context = {
      sessionId: session.identity.owner,
      user: session.identity.user,
      campusId: "gdufs_university_town" as const,
      permissions: [],
      signal: req.signal,
      requestId: apiContext.requestId,
      map: envelope.selectedPlaceId
        ? { selectedPlaceId: envelope.selectedPlaceId }
        : undefined,
    };
    if (envelope.selectedPlaceId) {
      service.place(envelope.selectedPlaceId);
    }
    const result = await new ToolExecutor(registry).execute(
      {
        id: crypto.randomUUID(),
        type: "function",
        function: { name, arguments: JSON.stringify(envelope.input) },
      },
      context,
    );
    if (!result.ok)
      throw new ApiError(
        result.error.code,
        result.error.message,
        result.error.retryable,
      );
    return result;
  })(request);
  if (cookie) response.headers.set("Set-Cookie", cookie);
  return response;
}
