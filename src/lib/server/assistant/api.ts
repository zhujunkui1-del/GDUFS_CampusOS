import { z } from "zod";
import { withApi } from "../http";
import { assistantContext, readJson } from "./http-context";
import { tokenHash } from "./crypto";
import { defaultModelRuntime } from "../models/runtime";
import { CampusMapService, MAP_VERSIONS } from "../maps/campus-map-service";
import type { MapAction } from "@/domain/maps/contracts";
type Context = Awaited<ReturnType<typeof assistantContext>>;
function api(
  handler: (request: Request, context: Context) => Promise<unknown>,
) {
  return async (request: Request) => {
    let cookie: string | undefined;
    const response = await withApi(async (req) => {
      const context = await assistantContext(req);
      cookie = context.identity.cookie;
      return handler(req, context);
    })(request);
    if (cookie) response.headers.set("Set-Cookie", cookie);
    return response;
  };
}
export const sessionGet = api(async (_request, context) => {
  const latest = await context.store.latest(context.identity);
  return {
    scopeKey: (
      await tokenHash(context.identity.owner + context.signingSecret)
    ).slice(0, 24),
    kind: context.identity.user ? "user" : "guest",
    history: latest
      ? await context.store.history(context.identity, latest.id)
      : null,
    model: await defaultModelRuntime().status(),
  };
});
export const historyGet = api(async (request, context) => {
  const id = z
    .string()
    .uuid()
    .parse(new URL(request.url).pathname.split("/").at(-1));
  return context.store.history(context.identity, id);
});
export const challengePost = api(async (_request, context) => ({
  challenge: await context.store.locationChallenge(context.identity),
  expiresInSeconds: 30,
}));
export const cancelPost = api(async (request, context) => {
  const body = z
    .object({ requestId: z.string().uuid() })
    .strict()
    .parse(await readJson(request));
  await context.store.cancel(context.identity, body.requestId);
  return { cancelled: true };
});
export const routePost = api(async (request, context) => {
  const id = z
    .string()
    .uuid()
    .parse(new URL(request.url).pathname.split("/").at(-1));
  const body = z
    .object({ ticket: z.string().max(60000).optional() })
    .strict()
    .parse(await readJson(request));
  if (body.ticket)
    await context.routes.hydrate(context.identity.owner, body.ticket);
  return context.routes.get(context.identity.owner, id, MAP_VERSIONS);
});
export const claimPost = api(async (request, context) => {
  const id = z
    .string()
    .uuid()
    .parse(new URL(request.url).pathname.split("/").at(-2));
  const body = z
    .object({ tickets: z.array(z.string().max(60000)).max(4).optional() })
    .strict()
    .parse(await readJson(request));
  for (const ticket of body.tickets || [])
    await context.routes.hydrate(context.identity.owner, ticket);
  const packet = await context.store.claim(context.identity, id);
  const service = new CampusMapService(context.routes);
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
        context.routes.get(
          context.identity.owner,
          action.routeId,
          MAP_VERSIONS,
        ),
      ),
  );
  return { id, actions: packet.actions, routes };
});
export const receiptPost = api(async (request, context) => {
  const id = z
    .string()
    .uuid()
    .parse(new URL(request.url).pathname.split("/").at(-2));
  const body = z
    .object({
      ok: z.boolean(),
      message: z.string().max(100),
      mode: z.enum(["2d", "2.5d", "3d"]).optional(),
    })
    .strict()
    .parse(await readJson(request));
  await context.store.receipt(
    context.identity,
    id,
    body.ok,
    body.message,
    body.mode,
  );
  return { saved: true };
});
