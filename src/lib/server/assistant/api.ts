import { z } from "zod";
import { withApi } from "../http";
import { assistantContext, readJson } from "./http-context";
import { tokenHash } from "./crypto";
import { defaultModelRuntime } from "../models/runtime";
import { CampusMapService, MAP_VERSIONS } from "../maps/campus-map-service";
import type { MapAction } from "@/domain/maps/contracts";
import { mapRuntime } from "../map-env";
import { ApiError } from "../errors";
import { historyForClient } from "@/domain/agent/assistant-contracts";
type Context = Awaited<ReturnType<typeof assistantContext>>;
const idSchema = z.string().uuid();
const emptyBodySchema = z.object({}).strict();
const listSchema = z
  .object({
    cursor: z.string().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  })
  .strict();
const cancelSchema = z.object({ requestId: idSchema }).strict();
const routeSchema = z
  .object({
    ticket: z.string().max(60000).optional(),
    conversationId: idSchema.optional(),
  })
  .strict();
const claimSchema = z
  .object({
    tickets: z.array(z.string().max(60000)).max(4).optional(),
    conversationId: idSchema.optional(),
  })
  .strict();
const receiptSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().max(100),
    mode: z.enum(["2d", "2.5d", "3d"]).optional(),
  })
  .strict();
function api(
  handler: (request: Request, context: Context) => Promise<unknown>,
  limited = false,
) {
  return async (request: Request) => {
    let cookie: string | undefined;
    let databaseTiming: Context["databaseTiming"] | undefined;
    const response = await withApi(async (req) => {
      const context = await assistantContext(req);
      databaseTiming = context.databaseTiming;
      cookie = context.identity.cookie;
      const limiter = limited ? mapRuntime().limiter : undefined;
      if (
        limiter &&
        !(
          await limiter.limit({
            key: "conversations:" + context.identity.owner,
          })
        ).success
      )
        throw new ApiError(
          "RATE_LIMITED",
          "对话操作较频繁，请稍后重试。",
          true,
        );
      return handler(req, context);
    })(request);
    if (cookie) response.headers.set("Set-Cookie", cookie);
    if (databaseTiming)
      response.headers.set(
        "Server-Timing",
        `d1;dur=${databaseTiming().durationMs}`,
      );
    return response;
  };
}
export const sessionGet = api(async (request, context) => {
  const latest = await context.store.latest(context.identity);
  return {
    scopeKey: (
      await tokenHash(context.identity.owner + context.signingSecret)
    ).slice(0, 24),
    kind: context.identity.user ? "user" : "guest",
    history: latest
      ? historyForClient(
          await context.store.history(context.identity, latest.id),
          ["1", "2", "3"].includes(
            request.headers.get("X-CampusOS-Conversation-Protocol") || "",
          ),
          ["2", "3"].includes(
            request.headers.get("X-CampusOS-Conversation-Protocol") || "",
          ),
          request.headers.get("X-CampusOS-Conversation-Protocol") === "3",
        )
      : null,
    model: await defaultModelRuntime().status(),
  };
});
export const historyGet = api(async (request, context) => {
  const id = idSchema.parse(new URL(request.url).pathname.split("/").at(-1));
  return historyForClient(
    await context.store.history(
      context.identity,
      id,
      z
        .object({
          before: z.coerce.number().int().positive().optional(),
          after: z.coerce.number().int().nonnegative().optional(),
        })
        .strict()
        .parse(Object.fromEntries(new URL(request.url).searchParams)),
    ),
    ["1", "2", "3"].includes(
      request.headers.get("X-CampusOS-Conversation-Protocol") || "",
    ),
    ["2", "3"].includes(
      request.headers.get("X-CampusOS-Conversation-Protocol") || "",
    ),
    request.headers.get("X-CampusOS-Conversation-Protocol") === "3",
  );
}, true);
export const conversationsGet = api(async (request, context) => {
  const query = listSchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  return context.store.list(context.identity, query.cursor, query.limit);
}, true);
export const conversationPatch = api(async (request, context) => {
  const id = idSchema.parse(new URL(request.url).pathname.split("/").at(-1));
  const body = z
    .object({ smartSearch: z.boolean() })
    .strict()
    .parse(await readJson(request));
  await context.store.setSmartSearch(context.identity, id, body.smartSearch);
  return context.store.searchPreference(context.identity, id);
}, true);
export const conversationDelete = api(async (request, context) => {
  const body = await readJson(request, 1024, true);
  if (body !== undefined) emptyBodySchema.parse(body);
  const id = idSchema.parse(new URL(request.url).pathname.split("/").at(-1));
  return context.store.deleteConversation(context.identity, id);
}, true);
export const challengePost = api(async (_request, context) => ({
  challenge: await context.store.locationChallenge(context.identity),
  serverTime: context.store.now(),
  expiresInSeconds: 30,
}));
export const cancelPost = api(async (request, context) => {
  const body = cancelSchema.parse(await readJson(request));
  await context.store.cancel(context.identity, body.requestId);
  return { cancelled: true };
});
export const routePost = api(async (request, context) => {
  const id = idSchema.parse(new URL(request.url).pathname.split("/").at(-1));
  const body = routeSchema.parse(await readJson(request));
  if (body.conversationId)
    await context.store.conversation(context.identity, body.conversationId);
  const routes = body.conversationId
    ? context.routes.forConversation(body.conversationId)
    : context.routes;
  if (body.ticket) await routes.hydrate(context.identity.owner, body.ticket);
  return routes.get(context.identity.owner, id, MAP_VERSIONS);
});
export const claimPost = api(async (request, context) => {
  const id = idSchema.parse(new URL(request.url).pathname.split("/").at(-2));
  const body = claimSchema.parse(await readJson(request));
  const packet = await context.store.claim(
    context.identity,
    id,
    body.conversationId,
  );
  await context.store.conversation(context.identity, packet.conversationId);
  if (body.conversationId && body.conversationId !== packet.conversationId)
    throw new ApiError("FORBIDDEN", "地图操作不属于当前对话。");
  const scopedRoutes = context.routes.forConversation(packet.conversationId);
  for (const ticket of body.tickets || [])
    await scopedRoutes.hydrate(context.identity.owner, ticket);
  const service = new CampusMapService(scopedRoutes);
  await service.control(
    { actions: packet.actions },
    {
      requestId: crypto.randomUUID(),
      sessionId: context.identity.owner,
      user: context.identity.user,
      permissions: [],
      campusId: "gdufs_university_town",
    },
  );
  const routes = await Promise.all(
    packet.actions
      .filter(
        (action): action is Extract<MapAction, { type: "SHOW_ROUTE" }> =>
          action.type === "SHOW_ROUTE",
      )
      .map((action) =>
        scopedRoutes.get(context.identity.owner, action.routeId, MAP_VERSIONS),
      ),
  );
  return {
    id,
    ...(body.conversationId ? { conversationId: packet.conversationId } : {}),
    actions: packet.actions,
    routes,
  };
});
export const receiptPost = api(async (request, context) => {
  const id = idSchema.parse(new URL(request.url).pathname.split("/").at(-2));
  const body = receiptSchema.parse(await readJson(request));
  await context.store.receipt(
    context.identity,
    id,
    body.ok,
    body.message,
    body.mode,
  );
  return { saved: true };
});
