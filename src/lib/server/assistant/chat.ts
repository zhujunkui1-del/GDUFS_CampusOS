import { z } from "zod";
import {
  AgentChatRequestSchema,
  encodeAgentEvent,
  type AgentEvent,
} from "@/domain/agent/contracts";
import {
  AssistantCardSchema,
  type AssistantCard,
} from "@/domain/agent/assistant-contracts";
import {
  ControlMapOutputSchema,
  NearbyPlacesOutputSchema,
  PlaceDetailsOutputSchema,
  RouteOutputSchema,
  SearchPlacesOutputSchema,
} from "@/domain/maps/skill-contracts";
import type { MapAction } from "@/domain/maps/contracts";
import { AgentOrchestrator } from "../agent/orchestrator";
import { SkillRegistry } from "../agent/skill-registry";
import { CampusMapService, MAP_VERSIONS } from "../maps/campus-map-service";
import { createMapSkillRegistry } from "../maps/skills";
import { defaultModelRuntime } from "../models/runtime";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { assistantContext, readJson } from "./http-context";
import { meteredClient } from "./model-run";
import type { SkillResult } from "@/domain/skills/contracts";
import {
  explicitMapCommand,
  requiresPlaceLookup,
  isOriginQuestion,
} from "./intent";
import { requestsDeviceLocation } from "@/domain/agent/location-intent";
import { searchCampusPlaces } from "@/features/campus-map/data/campus";

function modelResult(name: string, result: SkillResult<unknown>) {
  if (!result.ok) return result;
  if (name === "plan_route") {
    const route = RouteOutputSchema.parse(result.data);
    return {
      ok: true,
      data: {
        routeId: route.routeId,
        start: { name: route.start.name, placeId: route.start.placeId },
        end: { name: route.end.name, placeId: route.end.placeId },
        distanceMeters: route.distanceMeters,
        estimatedMinutes: route.estimatedMinutes,
        usesTunnel: route.usesTunnel,
        steps: route.steps,
      },
    };
  }
  if (name === "find_nearby_places") {
    const nearby = NearbyPlacesOutputSchema.parse(result.data);
    return {
      ok: true,
      data: {
        origin: {
          name: nearby.origin.name,
          placeId: nearby.origin.placeId,
          source: nearby.origin.source,
        },
        distanceType: nearby.distanceType,
        matches: nearby.matches.map((place) => ({
          placeId: place.placeId,
          name: place.name,
          category: place.category,
          zone: place.zone,
          distanceMeters: place.distanceMeters,
        })),
      },
    };
  }
  if (name === "get_place_details") {
    const detail = PlaceDetailsOutputSchema.parse(result.data);
    return {
      ok: true,
      data: {
        place: detail.place,
        building: detail.building,
        openingStatus: detail.navigation.openingStatus,
      },
    };
  }
  return result;
}
const explain: Record<string, string> = {
  NOT_FOUND: "未找到该地点或路线，请换个名称。",
  LOCATION_REQUIRED: "请授权定位或输入起点。",
  CANCELLED: "已停止回复。",
  RATE_LIMITED: "请求较多或额度已用完，请稍后重试。",
  MODEL_TEST_REQUIRED: "AI 暂不可用，请稍后重试。",
  MODEL_SELECTION_REQUIRED: "AI 暂不可用，请稍后重试。",
};

export async function chatResponse(request: Request) {
  let response: Response | undefined;
  const fallback = await withApi(async (req, apiContext) => {
    const input = AgentChatRequestSchema.parse(await readJson(req));
    const ctx = await assistantContext(req);
    await ctx.store.cleanup();
    const conversation = await ctx.store.conversation(
      ctx.identity,
      input.conversationId,
    );
    const service = new CampusMapService(ctx.routes);
    let selected =
      input.mapContext?.selectedPlaceId || conversation.selected_place_id;
    if (selected) service.place(selected);
    if (input.mapContext?.routeTicket)
      await ctx.routes.hydrate(
        ctx.identity.owner,
        input.mapContext.routeTicket,
      );
    const activeRoute =
      input.mapContext?.activeRouteId || conversation.active_route_id;
    if (
      input.mapContext?.activeRouteId &&
      !/清除|清空|取消.*路线/.test(input.message)
    )
      await ctx.routes.get(
        ctx.identity.owner,
        input.mapContext.activeRouteId,
        MAP_VERSIONS,
      );
    const location = input.locationGrant
      ? await ctx.store.consumeLocation(ctx.identity, input.locationGrant)
      : undefined;
    const needsLocation = requestsDeviceLocation(input.message);
    const resolved = await defaultModelRuntime().resolve();
    const requestId = input.clientRequestId || crypto.randomUUID();
    const runId = await ctx.store.reserve(
      ctx.identity,
      conversation,
      requestId,
      ctx.ip,
    );
    const history = await ctx.store.history(ctx.identity, conversation.id);
    const previous = history.messages
      .map((message) => ({ role: message.role, content: message.text }))
      .slice(-10);
    while (JSON.stringify(previous).length > 16000) previous.shift();
    await ctx.store.append(conversation, "user", input.message);
    const abort = new AbortController();
    const streamSignal = AbortSignal.any([request.signal, abort.signal]);
    const normalizedQuestion = input.message
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .toLowerCase();
    const namedPlaces = searchCampusPlaces("").filter((place) =>
      normalizedQuestion.includes(
        place.name.normalize("NFKC").replace(/\s+/g, "").toLowerCase(),
      ),
    );
    const routeQuestion =
      /从.+(?:去|到)|(?:去|到|导航).+|怎么走|怎么去|规划.*路线/.test(
        normalizedQuestion.replace(/找到|查到|定位到/g, "找"),
      );
    const startText = /从(.+?)(?:去|到)/.exec(normalizedQuestion)?.[1];
    const originIds =
      needsLocation && location
        ? ["device_location"]
        : startText && !/这里|这儿/.test(startText)
          ? namedPlaces
              .filter((place) => startText.includes(place.name.toLowerCase()))
              .map((place) => place.id)
          : selected
            ? [selected]
            : [];
    const destinations = namedPlaces.filter(
      (place) => !originIds.includes(place.id),
    );
    const originMissing =
      routeQuestion &&
      !originIds.length &&
      (!startText || /这里|这儿/.test(startText));
    const verifiedIds = new Set<string>([
      ...namedPlaces.map((place) => place.id),
      ...(selected ? [selected] : []),
      ...history.messages.flatMap((message) =>
        message.cards
          .filter((card) => card.kind === "place")
          .map((card) => card.place.placeId),
      ),
    ]);
    const verifiedEntities = [...verifiedIds].slice(0, 25).flatMap((id) => {
      try {
        const p = service.place(id);
        return [{ placeId: p.id, name: p.name }];
      } catch {
        return [];
      }
    });
    const needsOriginQuestion = (needsLocation && !location) || originMissing;
    let finalPhase = needsOriginQuestion;
    let nextRequiredTool: "control_map" | undefined;
    const requiredAction = explicitMapCommand(input.message);
    let beforeAnswer = async (): Promise<false | { mode: string | null }> =>
      false;
    const metered = meteredClient(
      resolved.client,
      resolved.snapshot,
      ctx.store,
      ctx.identity.owner,
      runId,
      () => finalPhase,
      () => beforeAnswer(),
      finalPhase
        ? undefined
        : requiredAction
          ? "control_map"
          : routeQuestion
            ? originIds.length && destinations.length === 1
              ? "plan_route"
              : "search_places"
            : requiresPlaceLookup(input.message)
              ? "search_places"
              : undefined,
      () => nextRequiredTool,
      requiredAction,
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let sequence = 0,
          closed = false;
        const emit = (
          type: AgentEvent["type"],
          payload: Record<string, unknown>,
        ) => {
          if (closed || abort.signal.aborted) return;
          controller.enqueue(
            new TextEncoder().encode(
              encodeAgentEvent({
                runId,
                eventId: runId + ":" + ++sequence,
                timestamp: new Date().toISOString(),
                type,
                payload,
              }),
            ),
          );
        };
        const cards = new Map<string, AssistantCard>();
        const routeArtifacts = new Map<
          string,
          z.infer<typeof RouteOutputSchema>
        >();
        const actions: MapAction[] = [];
        let published = false;
        let acknowledged = false;
        let acknowledgedMode: string | null = null;
        beforeAnswer = async () => {
          if (published)
            return acknowledged ? { mode: acknowledgedMode } : false;
          if (!actions.length) return false;
          if (
            requiredAction &&
            actions.some(
              (action) =>
                JSON.stringify(action) !== JSON.stringify(requiredAction),
            )
          )
            throw new ApiError(
              "INVALID_ARGUMENT",
              "地图操作与请求不符，请重试。",
            );
          published = true;
          if (actions.length > 8)
            throw new ApiError("RUN_LIMIT_EXCEEDED", "请分次执行地图操作。");
          const packet = await ctx.store.action(
            ctx.identity,
            conversation,
            runId,
            actions,
          );
          const routes = await Promise.all(
            [...routeArtifacts.values()].map(async (route) => ({
              route,
              ticket: await ctx.routes.ticket(ctx.identity.owner, route),
            })),
          );
          emit("artifact.ready", {
            conversationId: conversation.id,
            cards: [...cards.values()].slice(0, 30),
            packet,
            routes,
          });
          const started = Date.now();
          while (Date.now() - started < 15000) {
            streamSignal.throwIfAborted();
            await ctx.store.running(ctx.identity.owner, runId);
            const receipt = await ctx.store.execution(
              ctx.identity.owner,
              packet.id,
            );
            if (receipt) {
              if (!receipt.ok)
                throw new ApiError("UPSTREAM_ERROR", receipt.message);
              acknowledged = true;
              acknowledgedMode = receipt.mode || null;
              return { mode: acknowledgedMode };
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          throw new ApiError("TIMEOUT", "地图操作未完成，请重试。");
        };
        let text = "";
        let error: { code: string; message: string } | undefined;
        const onEvent = (event: AgentEvent) => {
          if (event.type === "message.delta") {
            text += String(event.payload.text);
            if (!needsOriginQuestion)
              emit(event.type, { text: event.payload.text });
          }
          if (event.type === "tool.started")
            emit(event.type, { name: event.payload.name });
          if (event.type === "tool.finished") {
            const result = event.payload.result as SkillResult<unknown>;
            const name = String(event.payload.name);
            emit(event.type, { name, ok: result.ok });
            if (!result.ok) return;
            if (name === "search_places") {
              const found = SearchPlacesOutputSchema.parse(result.data);
              for (const place of found.matches)
                cards.set(place.placeId, { kind: "place", place });
              if (!found.ambiguous && found.matches.length === 1) {
                selected = found.matches[0].placeId;
                if (!routeQuestion && /找|搜索|定位|在哪/.test(input.message))
                  nextRequiredTool = "control_map";
              }
            }
            if (name === "get_place_details") {
              const detail = PlaceDetailsOutputSchema.parse(result.data);
              cards.set(detail.place.placeId, {
                kind: "place",
                place: detail.place,
              });
            }
            if (name === "find_nearby_places") {
              const nearby = NearbyPlacesOutputSchema.parse(result.data);
              for (const { distanceMeters, ...place } of nearby.matches)
                cards.set(place.placeId, {
                  kind: "place",
                  place,
                  distanceMeters,
                });
              if (!/定位|路线|切换/.test(input.message)) finalPhase = true;
            }
            if (name === "plan_route") {
              nextRequiredTool = /不要显示|不用显示|不在地图/.test(
                input.message,
              )
                ? undefined
                : "control_map";
              const route = RouteOutputSchema.parse(result.data);
              routeArtifacts.set(route.routeId, route);
              selected = route.start.placeId;
              cards.set(route.routeId, {
                kind: "route",
                routeId: route.routeId,
                startName: route.start.name,
                endName: route.end.name,
                distanceMeters: route.distanceMeters,
                estimatedMinutes: route.estimatedMinutes,
                expiresAt: route.expiresAt,
                device: route.start.source === "authorized_device_location",
              });
            }
            if (name === "control_map") {
              nextRequiredTool = undefined;
              finalPhase = true;
              actions.push(
                ...ControlMapOutputSchema.parse(result.data).acceptedActions,
              );
            }
          }
          if (event.type === "run.failed")
            error = event.payload.error as { code: string; message: string };
        };
        emit("artifact.ready", {
          conversationId: conversation.id,
          requestId,
          started: true,
        });
        const ping = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
            } catch {
              abort.abort();
            }
          }
        }, 10000);
        const work = async () => {
          try {
            const selectedPlace =
              !needsOriginQuestion && selected ? service.place(selected) : null;
            const instructions = `只用简体中文，简洁回答。调用工具时不输出执行叙述或推理，最终只讲用户需要的名称、距离、时间；不讲工具名、版本、Schema、来源审核或意图状态。
查找唯一地点后必须调用control_map，生成FOCUS_PLACE及SHOW_PLACE_DETAILS。规划路线后必须调用control_map生成SHOW_ROUTE。切换模式/清路线必须调用control_map。动作是否成功以浏览器回执为准，不提前声称已切换或显示。不追加无必要的追问，只有缺起点或歧义时询问。
已验证当前地点：${selectedPlace ? selectedPlace.name + " (" + selectedPlace.id + ")" : "无"}。最近规划路线：${(!needsOriginQuestion && activeRoute) || "无"}。当前模式：${input.mapContext?.mode || "2d"}。
已验证实体数据：${JSON.stringify(needsOriginQuestion ? [] : verifiedEntities)}。这些ID来自当前固定校园资料及本会话已核对实体，可直接用于路线输入。不要凭空编写ID。${needsOriginQuestion ? "本轮没有有效起点，必须只用一句话询问用户从哪里出发。不复述旧路线，不生成距离或时间，不声称已经显示路线或完成操作。" : ""}
“这里/这栋/那栋”只引用上述已验证地点，不能猜测用户位置。${needsLocation ? "本轮明确请求设备位置；只能用device_location，无授权必须询问起点，不能改用历史地点。" : ""}`;
            const orchestrator = new AgentOrchestrator(
              {
                resolve: async () => ({
                  client: metered.client,
                  snapshot: resolved.snapshot,
                }),
              },
              (needsLocation && !location) || originMissing
                ? new SkillRegistry()
                : createMapSkillRegistry(service),
              undefined,
              { stopOnToolError: true, instructions, modelResult },
            );
            const result = await orchestrator.run({
              runId,
              message: input.message,
              history: needsOriginQuestion ? [] : previous,
              context: {
                requestId: apiContext.requestId,
                sessionId: ctx.identity.owner,
                user: ctx.identity.user,
                permissions: [],
                campusId: "gdufs_university_town",
                signal: streamSignal,
                map: {
                  selectedPlaceId: selectedPlace?.id,
                  authorizedLocation: location,
                  requiresDeviceOrigin: needsLocation,
                },
              },
              onEvent,
            });
            const metrics = metered.metrics();
            if (result.status !== "completed" || streamSignal.aborted) {
              const code = error?.code || "CANCELLED";
              const message =
                explain[code] || error?.message || "AI 暂不可用，请重试。";
              await ctx.store
                .finish(
                  ctx.identity,
                  runId,
                  "failed",
                  metrics,
                  metrics.chargedTokens,
                  code,
                )
                .catch(() => {});
              await ctx.store.append(conversation, "assistant", message);
              emit("run.failed", {
                error: { code, message },
                conversationId: conversation.id,
                metrics,
              });
              return;
            }
            if (needsOriginQuestion) {
              if (!isOriginQuestion(text))
                throw new ApiError(
                  "LOCATION_REQUIRED",
                  "请授权定位或输入起点。",
                );
              emit("message.delta", { text });
            }
            if (actions.length > 8)
              throw new ApiError(
                "RUN_LIMIT_EXCEEDED",
                "地图操作过多，请分次查询。",
              );
            await ctx.store.finish(
              ctx.identity,
              runId,
              "completed",
              metrics,
              metrics.chargedTokens,
            );
            const routeId =
              actions.find((action) => action.type === "SHOW_ROUTE")?.routeId ||
              conversation.active_route_id;
            const cleared = actions.some(
              (action) => action.type === "CLEAR_ROUTE",
            );
            const focus = actions.find(
              (action) => action.type === "FOCUS_PLACE",
            );
            if (focus?.type === "FOCUS_PLACE") selected = focus.placeId;
            await ctx.store.context(
              conversation,
              selected,
              cleared ? null : routeId,
            );
            const readyCards = z
              .array(AssistantCardSchema)
              .max(30)
              .parse([...cards.values()].slice(0, 30));
            await ctx.store.append(
              conversation,
              "assistant",
              text || "已完成查询。",
              readyCards,
            );
            const routes = await Promise.all(
              [...routeArtifacts.values()].map(async (route) => ({
                route,
                ticket: await ctx.routes.ticket(ctx.identity.owner, route),
              })),
            );
            emit("artifact.ready", {
              conversationId: conversation.id,
              cards: readyCards,
              routes,
            });
            emit("run.completed", {
              conversationId: conversation.id,
              requestId,
              metrics,
            });
          } catch (cause) {
            const controlled =
              cause instanceof ApiError
                ? cause
                : new ApiError(
                    "SERVICE_UNAVAILABLE",
                    "AI 暂不可用，请重试。",
                    true,
                  );
            const metrics = metered.metrics();
            await ctx.store
              .finish(
                ctx.identity,
                runId,
                "failed",
                metrics,
                metrics.chargedTokens,
                controlled.code,
              )
              .catch(() => {});
            emit("run.failed", {
              error: {
                code: controlled.code,
                message: explain[controlled.code] || controlled.message,
              },
              conversationId: conversation.id,
            });
          } finally {
            closed = true;
            clearInterval(ping);
            try {
              controller.close();
            } catch {}
          }
        };
        void work();
      },
      cancel() {
        abort.abort();
        void ctx.store.cancel(ctx.identity, requestId);
      },
    });
    response = new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "Set-Cookie": ctx.identity.cookie,
        "X-Request-Id": apiContext.requestId,
      },
    });
    return { started: true };
  })(request);
  return response || fallback;
}
