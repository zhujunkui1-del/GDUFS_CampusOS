"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { z } from "zod";
import { useCampusMap } from "@/features/campus-map/components/campus-map-provider";
import { requestOneTimeLocation } from "@/features/campus-map/components/use-map-location";
import {
  AssistantArtifactSchema,
  AssistantHistorySchema,
  type AssistantCard,
  type StoredMessage,
} from "@/domain/agent/assistant-contracts";
import { MapActionSchema } from "@/domain/maps/contracts";
import { RouteOutputSchema } from "@/domain/maps/skill-contracts";
import { readAgentStream } from "./sse";
import { requestsDeviceLocation } from "@/domain/agent/location-intent";

async function jsonApi(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok || !value.ok)
    throw new Error(value.error?.message || "服务暂不可用，请重试。");
  return value.data as unknown;
}
async function frames() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
async function waitFor(
  check: () => boolean,
  signal: AbortSignal,
  timeout = 10000,
) {
  const start = performance.now();
  while (!check()) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (performance.now() - start > timeout)
      throw new Error("地图操作未完成，请重试。");
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
const toolLabels: Record<string, string> = {
  search_places: "查找地点",
  get_place_details: "读取地点",
  find_nearby_places: "查找附近设施",
  plan_route: "规划步行路线",
  control_map: "准备地图",
};
type Session = {
  scopeKey: string;
  kind: string;
  history: unknown;
  model: { ready: boolean };
};

export function useAssistant(
  open: boolean,
  prepareMap: () => Promise<void>,
  onFailure: () => void,
) {
  const map = useCampusMap();
  const mapRef = useRef(map);
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const conversationRef = useRef(conversationId);
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const initialized = useRef(false),
    scope = useRef("");
  const generation = useRef(0);
  const pending = useRef<{
    controller: AbortController;
    requestId: string;
  } | null>(null);
  const tickets = useRef(new Map<string, string>());
  const knownRoutes = useRef(new Map<string, number>());
  const prepareRef = useRef(prepareMap);
  const failureRef = useRef(onFailure);
  useEffect(() => {
    mapRef.current = map;
    pathRef.current = pathname;
    conversationRef.current = conversationId;
    prepareRef.current = prepareMap;
    failureRef.current = onFailure;
  }, [map, pathname, conversationId, prepareMap, onFailure]);
  const boot = useCallback(async () => {
    try {
      const session = (await jsonApi("/api/agent/session")) as Session;
      if (scope.current && scope.current !== session.scopeKey) {
        pending.current?.controller.abort();
        generation.current++;
        tickets.current.clear();
        if (
          mapRef.current.route &&
          knownRoutes.current.has(mapRef.current.route.id)
        )
          mapRef.current.stopNavigation();
        knownRoutes.current.clear();
        setMessages([]);
        setConversationId(undefined);
      }
      scope.current = session.scopeKey;
      if (!pending.current) {
        if (session.history) {
          const history = AssistantHistorySchema.parse(session.history);
          for (const message of history.messages)
            for (const card of message.cards)
              if (card.kind === "route")
                knownRoutes.current.set(
                  card.routeId,
                  Date.parse(card.expiresAt),
                );
          setMessages(history.messages);
          setConversationId(history.conversationId);
        } else {
          setMessages([]);
          setConversationId(undefined);
        }
      }
      setReady(session.model.ready);
      setError(session.model.ready ? "" : "AI 暂不可用，请稍后重试。");
      initialized.current = true;
    } catch (cause) {
      setReady(false);
      setError(cause instanceof Error ? cause.message : "连接失败，请重试。");
    }
  }, []);
  useEffect(() => {
    if (open && !initialized.current) void boot();
  }, [open, boot]);
  useEffect(() => {
    const focus = () => {
      if (initialized.current && !pending.current) void boot();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [boot]);
  const cancel = useCallback(() => {
    const active = pending.current;
    generation.current++;
    pending.current = null;
    if (active) {
      active.controller.abort();
      void jsonApi("/api/agent/cancel", { requestId: active.requestId }).catch(
        () => {},
      );
    }
    setBusy(false);
    setStatus("");
    setError("已停止回复。");
  }, []);
  useEffect(() => {
    if (map.navigating && pending.current) cancel();
  }, [map.navigating, cancel]);
  useEffect(
    () => () => {
      pending.current?.controller.abort();
    },
    [],
  );
  const toMap = async (signal: AbortSignal) => {
    if (pathRef.current !== "/map") router.push("/map");
    await waitFor(
      () =>
        mapRef.current.status === "ready" &&
        document.querySelector<HTMLElement>('[data-testid="campus-map"]')?.style
          .visibility !== "hidden",
      signal,
    );
    await prepareRef.current();
    await frames();
  };
  const showCard = async (card: AssistantCard, navigate = false) => {
    if (pending.current) cancel();
    setError("");
    const signal = new AbortController().signal;
    try {
      await toMap(signal);
      if (card.kind === "place")
        mapRef.current.executeAction({
          type: "FOCUS_PLACE",
          placeId: card.place.placeId,
        });
      else {
        const route = RouteOutputSchema.parse(
          await jsonApi(`/api/agent/routes/${card.routeId}`, {
            ticket: tickets.current.get(card.routeId),
          }),
        );
        mapRef.current.installRoute(route);
        mapRef.current.executeAction({
          type: "SHOW_ROUTE",
          routeId: route.routeId,
        });
        await frames();
        if (navigate) mapRef.current.beginNavigation();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "地图操作失败。");
    }
  };
  const send = async (text: string) => {
    if (pending.current || !text.trim() || !ready) return;
    const controller = new AbortController(),
      requestId = crypto.randomUUID(),
      revision = ++generation.current;
    pending.current = { controller, requestId };
    setBusy(true);
    setError("");
    setStatus("正在查询");
    const assistantId = crypto.randomUUID();
    let cid = conversationRef.current;
    let artifact: z.infer<typeof AssistantArtifactSchema> | undefined;
    let terminalError = "";
    let expectedMapVersion = mapRef.current.getInteractionVersion();
    const userMessage: StoredMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      cards: [],
    };
    setMessages((previous) =>
      [
        ...previous,
        userMessage,
        { id: assistantId, role: "assistant" as const, text: "", cards: [] },
      ].slice(-20),
    );
    const update = (fn: (message: StoredMessage) => StoredMessage) =>
      setMessages((previous) =>
        previous.map((message) =>
          message.id === assistantId ? fn(message) : message,
        ),
      );
    let actionWork: Promise<void> | undefined;
    let actionError = "";
    const applyArtifact = async (
      value: z.infer<typeof AssistantArtifactSchema>,
    ) => {
      if (!value.packet) return;
      setStatus("正在调整地图");
      const packet = value.packet;
      let ok = false,
        resultMessage = "地图操作失败。";
      try {
        const claimed = z
          .object({
            id: z.string().uuid(),
            actions: z.array(MapActionSchema),
            routes: z.array(RouteOutputSchema),
          })
          .strict()
          .parse(
            await jsonApi(
              `/api/agent/actions/${packet.id}/claim`,
              { tickets: value.routes.map((item) => item.ticket) },
              controller.signal,
            ),
          );
        if (revision !== generation.current || controller.signal.aborted)
          return;
        if (mapRef.current.getInteractionVersion() !== expectedMapVersion)
          throw new Error("地图操作已被新的选择中断。");
        await toMap(controller.signal);
        for (const action of claimed.actions) {
          if (
            revision !== generation.current ||
            controller.signal.aborted ||
            mapRef.current.getInteractionVersion() !== expectedMapVersion
          )
            throw new Error("地图操作已中断。");
          if (action.type === "SHOW_ROUTE") {
            const route = claimed.routes.find(
              (route) => route.routeId === action.routeId,
            );
            if (!route) throw new Error("路线已失效，请重新规划。");
            mapRef.current.installRoute(route);
          }
          mapRef.current.executeAction(action);
          expectedMapVersion = mapRef.current.getInteractionVersion();
          if (action.type === "FOCUS_PLACE" || action.type === "SHOW_ROUTE") {
            // The existing map controller schedules its fit on the next frame.
            await frames();
            await waitFor(
              () =>
                document.querySelector<HTMLElement>(
                  '[data-testid="campus-map"]',
                )?.dataset.cameraMoving === "false",
              controller.signal,
            );
            if (mapRef.current.getInteractionVersion() !== expectedMapVersion)
              throw new Error("地图操作已被新的选择中断。");
          }
          if (action.type === "SET_VIEW_MODE") {
            await waitFor(() => {
              if (mapRef.current.getInteractionVersion() !== expectedMapVersion)
                throw new Error("地图操作已被新的选择中断。");
              const mapElement = document.querySelector<HTMLElement>(
                '[data-testid="campus-map"]',
              );
              if (mapElement?.dataset.modelState === "error")
                throw new Error("3D暂不可用，请切回2D或2.5D。");
              return (
                mapRef.current.mode === action.mode &&
                (action.mode !== "3d" ||
                  mapElement?.dataset.modelState === "ready")
              );
            }, controller.signal);
            await frames();
            await waitFor(
              () =>
                document.querySelector<HTMLElement>(
                  '[data-testid="campus-map"]',
                )?.dataset.cameraMoving === "false",
              controller.signal,
            );
            if (mapRef.current.getInteractionVersion() !== expectedMapVersion)
              throw new Error("地图操作已被新的选择中断。");
          }
        }
        ok = true;
        await frames();
        resultMessage = claimed.actions.some(
          (action) => action.type === "CLEAR_ROUTE",
        )
          ? "路线已清除"
          : "地图已更新";
      } finally {
        if (revision === generation.current && !controller.signal.aborted)
          await jsonApi(`/api/agent/actions/${packet.id}/receipt`, {
            ok,
            message: resultMessage,
            mode: mapRef.current.mode,
          }).catch(() => {});
      }
    };
    try {
      let locationGrant: unknown;
      if (requestsDeviceLocation(text)) {
        setStatus("等待定位");
        try {
          const challenge = z
            .object({ challenge: z.string() })
            .passthrough()
            .parse(
              await jsonApi(
                "/api/agent/location/challenge",
                {},
                controller.signal,
              ),
            ).challenge;
          const position = await requestOneTimeLocation(controller.signal);
          locationGrant = {
            challenge,
            coordinate: position.coordinate,
            accuracyMeters: position.accuracy,
            capturedAt: Math.round(position.timestamp),
          };
        } catch {
          setStatus("定位未获授权，将询问起点");
        }
      }
      if (controller.signal.aborted) return;
      const current = mapRef.current;
      const activeRoute =
        current.route &&
        (knownRoutes.current.get(current.route.id) || 0) > Date.now()
          ? current.route
          : null;
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: cid,
          clientRequestId: requestId,
          message: text,
          mapContext: {
            selectedPlaceId: current.selected?.id || current.assistantPlace?.id,
            activeRouteId: activeRoute?.id || null,
            routeTicket: activeRoute
              ? tickets.current.get(activeRoute.id)
              : undefined,
            mode: current.mode,
          },
          ...(locationGrant ? { locationGrant } : {}),
        }),
      });
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error?.message || "AI 暂不可用，请重试。");
      }
      await readAgentStream(
        response,
        (event) => {
          if (revision !== generation.current) return;
          if (event.type === "message.delta") {
            setStatus("");
            update((message) => ({
              ...message,
              text: (
                message.text + z.string().max(32768).parse(event.payload.text)
              ).slice(0, 4000),
            }));
          }
          if (event.type === "tool.started")
            setStatus(toolLabels[String(event.payload.name)] || "正在查询");
          if (event.type === "artifact.ready") {
            if (event.payload.started) {
              cid = z.string().uuid().parse(event.payload.conversationId);
              setConversationId(cid);
            } else {
              const payload = { ...event.payload };
              delete payload.conversationId;
              artifact = AssistantArtifactSchema.parse(payload);
              if (artifact.packet && !actionWork)
                actionWork = applyArtifact(artifact).catch((cause) => {
                  actionError =
                    cause instanceof Error ? cause.message : "地图操作失败。";
                });
              update((message) => ({ ...message, cards: artifact!.cards }));
              for (const item of artifact.routes) {
                tickets.current.set(item.route.routeId, item.ticket);
                knownRoutes.current.set(
                  item.route.routeId,
                  Date.parse(item.route.expiresAt),
                );
              }
            }
          }
          if (event.type === "run.failed") {
            const failure = z
              .object({ message: z.string() })
              .passthrough()
              .parse(event.payload.error);
            terminalError = failure.message;
            controller.abort();
          }
        },
        controller.signal,
      );
      if (revision !== generation.current || controller.signal.aborted) return;
      if (actionWork) await actionWork;
      if (actionError) throw new Error(actionError);
      if (terminalError) throw new Error(terminalError);
      setStatus("");
    } catch (cause) {
      if (
        revision === generation.current &&
        (!controller.signal.aborted || terminalError)
      ) {
        controller.abort();
        void jsonApi("/api/agent/cancel", { requestId }).catch(() => {});
        const message =
          terminalError ||
          (cause instanceof z.ZodError || cause instanceof SyntaxError
            ? "回复格式异常，请重试。"
            : cause instanceof Error
              ? cause instanceof TypeError
                ? "连接已中断，请重试。"
                : cause.message
              : "连接失败，请重试。");
        setError(message);
        failureRef.current();
        update((item) => ({
          ...item,
          text: message,
          error: message,
        }));
      }
    } finally {
      if (revision === generation.current) {
        pending.current = null;
        setBusy(false);
        setStatus("");
      }
    }
  };
  return {
    messages,
    busy,
    ready,
    status,
    error,
    send,
    cancel,
    retry: boot,
    showCard,
    activeRouteId: map.route?.id || null,
    clearRoute: () => {
      if (pending.current) cancel();
      setError("");
      mapRef.current.stopNavigation();
    },
  };
}
