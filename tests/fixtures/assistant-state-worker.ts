import { z } from "zod";
import { AssistantStore } from "@/lib/server/assistant/store";
import { SharedRouteStore } from "@/lib/server/assistant/routes";
import {
  CampusMapService,
  MAP_VERSIONS,
} from "@/lib/server/maps/campus-map-service";
import {
  primaryDatabase,
  type SqlDatabase,
} from "@/lib/server/assistant/database";
// Isolated test worker only. No model, credentials, production API route, or arbitrary SQL endpoint.
const worker = {
  async fetch(
    request: Request,
    env: { DB: SqlDatabase; AGENT_SIGNING_SECRET: string },
  ) {
    const store = new AssistantStore(primaryDatabase(env.DB));
    const identity = await store.identity(request);
    const routeStore = new SharedRouteStore(
      primaryDatabase(env.DB),
      env.AGENT_SIGNING_SECRET,
    );
    const body =
      request.method === "POST"
        ? ((await request.json()) as Record<string, string>)
        : {};
    const path = new URL(request.url).pathname;
    try {
      let data: unknown;
      if (path === "/session") {
        const latest = await store.latest(identity);
        const conversation = latest
          ? await store.conversation(identity, latest.id)
          : await store.conversation(identity);
        if (!latest)
          await store.append(
            conversation,
            "user",
            "isolated shared-session fixture",
          );
        data = { conversationId: conversation.id };
      } else if (path === "/new") {
        const c = await store.conversation(identity);
        await store.append(
          c,
          "user",
          z.string().min(1).max(48).parse(body.title),
        );
        data = { conversationId: c.id };
      } else if (path === "/list") data = await store.list(identity);
      else if (path === "/history")
        data = await store.history(
          identity,
          z.string().uuid().parse(body.conversationId),
        );
      else if (path === "/delete")
        data = await store.deleteConversation(
          identity,
          z.string().uuid().parse(body.conversationId),
        );
      else if (path === "/reserve") {
        const conversation = await store.conversation(
          identity,
          z.string().uuid().parse(body.conversationId),
        );
        data = {
          runId: await store.reserve(
            identity,
            conversation,
            z.string().uuid().parse(body.requestId),
            "isolated-fixture-ip",
          ),
        };
      } else if (path === "/finish") {
        await store.finish(
          identity,
          z.string().uuid().parse(body.runId),
          "completed",
          {},
          1,
        );
        data = { finished: true };
      } else if (path === "/route") {
        if (body.conversationId)
          await store.conversation(
            identity,
            z.string().uuid().parse(body.conversationId),
          );
        data = await new CampusMapService(
          body.conversationId
            ? routeStore.forConversation(body.conversationId)
            : routeStore,
        ).plan(
          {
            start: { type: "place", placeId: "osm-way-312536955" },
            endPlaceId: "osm-way-307250998",
            mode: "walking",
          },
          {
            requestId: crypto.randomUUID(),
            sessionId: identity.owner,
            user: identity.user,
            permissions: [],
            campusId: "gdufs_university_town",
          },
        );
      } else if (path === "/restore") {
        data = await (
          body.conversationId
            ? routeStore.forConversation(
                z.string().uuid().parse(body.conversationId),
              )
            : routeStore
        ).get(
          identity.owner,
          z.string().uuid().parse(body.routeId),
          MAP_VERSIONS,
        );
      } else return new Response("Not found", { status: 404 });
      return Response.json(
        { ok: true, data },
        { headers: { "Set-Cookie": identity.cookie } },
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code:
            error instanceof Error && "code" in error
              ? error.code
              : "TEST_ERROR",
        },
        { status: 409 },
      );
    }
  },
};
export default worker;
