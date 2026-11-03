"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { z } from "zod";
import { requestConversationId } from "@/domain/agent/conversation-key";
import { useCampusMap } from "@/features/campus-map/components/campus-map-provider";
import { requestOneTimeLocation } from "@/features/campus-map/components/use-map-location";
import {
  AssistantArtifactSchema,
  AssistantHistorySchema,
  type AssistantCard,
  type StoredMessage,
  ConversationListSchema,
  type ConversationSummary,
} from "@/domain/agent/assistant-contracts";
import { MapActionSchema } from "@/domain/maps/contracts";
import { RouteOutputSchema } from "@/domain/maps/skill-contracts";
import { readAgentStream } from "./sse";
import {
  navigationIntent,
  pendingNavigationMessages,
} from "@/domain/agent/navigation-intent";
import { locationCaptureTime } from "@/domain/agent/location-grant";
import {
  blankConversation,
  conversationTitle,
  afterConversationDelete,
  acceptsConversationResult,
  restoredSearchPreference,
  type ConversationView,
} from "./conversation-state";
class AssistantRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function jsonApi(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  method?: string,
) {
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      "X-CampusOS-Conversation-Protocol": "3",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok || !value.ok)
    throw new AssistantRequestError(
      value.error?.message || "服务暂不可用，请重试。",
      response.status,
    );
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
  const [view, setView] = useState<ConversationView>(blankConversation);
  const { messages, id: conversationId } = view;
  const viewRef = useRef(view);
  const conversationRef = useRef(conversationId);
  const setMessages = (
    update: StoredMessage[] | ((prior: StoredMessage[]) => StoredMessage[]),
  ) =>
    setView((prior) => {
      const next =
        typeof update === "function" ? update(prior.messages) : update;
      return {
        ...prior,
        messages: next,
        title:
          prior.messages.length === 0
            ? conversationTitle(next.find((m) => m.role === "user")?.text || "")
            : prior.title,
      };
    });
  const setConversationId = (id: string | undefined) => {
    conversationRef.current = id;
    setView((prior) => ({ ...prior, id }));
  };
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [savingSearch, setSavingSearch] = useState(false);
  const searchWrite = useRef(false);
  const initialized = useRef(false),
    scope = useRef("");
  const generation = useRef(0);
  const sessionKind = useRef("");
  const [connected, setConnected] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listBusy, setListBusy] = useState(false),
    [historyError, setHistoryError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<number | null>(null),
    [olderBusy, setOlderBusy] = useState(false);
  const latestSequence = useRef(0),
    olderWork = useRef<AbortController | null>(null);
  const chosen = useRef(false),
    selectionBoundary = useRef(0),
    semanticPlace = useRef<string | null>(null);
  const cardWork = useRef<AbortController | null>(null),
    historyWork = useRef<AbortController | null>(null),
    listWork = useRef<AbortController | null>(null);
  const cancellation = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<{
    controller: AbortController;
    requestId: string;
  } | null>(null);
  const tickets = useRef(new Map<string, string>());
  const knownRoutes = useRef(new Map<string, number>());
  // Ownership of the visible map only, never a conversation capability or tool
  // context. Keep this across New Chat so a later identity switch can clear it.
  const displayedRouteOwner = useRef<{
    routeId: string;
    scopeKey: string;
  } | null>(null);
  const prepareRef = useRef(prepareMap);
  const failureRef = useRef(onFailure);
  useEffect(() => {
    mapRef.current = map;
    pathRef.current = pathname;
    conversationRef.current = conversationId;
    viewRef.current = view;
    prepareRef.current = prepareMap;
    failureRef.current = onFailure;
  }, [map, pathname, conversationId, view, prepareMap, onFailure]);
  const invalidate = useCallback(() => {
    ++generation.current;
    historyWork.current?.abort();
    olderWork.current?.abort();
    olderWork.current = null;
    setOlderBusy(false);
    cardWork.current?.abort();
    const active = pending.current;
    pending.current = null;
    if (active) {
      active.controller.abort();
      const stop = jsonApi(
        "/api/agent/cancel",
        {
          requestId: active.requestId,
        },
        AbortSignal.timeout(5000),
      ).catch(() => {});
      cancellation.current = Promise.all([cancellation.current, stop]);
    }
    setBusy(false);
    setStatus("");
    setLoadingConversation(false);
    return generation.current;
  }, []);
  const resetSemantics = useCallback(() => {
    tickets.current.clear();
    knownRoutes.current.clear();
    semanticPlace.current = null;
    selectionBoundary.current = mapRef.current.getAssistantSelection().revision;
  }, []);
  const acceptHistory = useCallback(
    (
      history: z.infer<typeof AssistantHistorySchema>,
      mode: "replace" | "merge" | "prepend" = "replace",
    ) => {
      if (mode !== "merge") setOlderCursor(history.olderCursor ?? null);
      latestSequence.current =
        mode === "replace"
          ? (history.latestSequence ?? 0)
          : Math.max(latestSequence.current, history.latestSequence ?? 0);
      if (conversationRef.current !== history.conversationId)
        tickets.current.clear();
      if (mode === "replace") knownRoutes.current.clear();
      semanticPlace.current = history.selectedPlaceId;
      for (const message of history.messages)
        for (const card of message.cards)
          if (card.kind === "route")
            knownRoutes.current.set(card.routeId, Date.parse(card.expiresAt));
      try {
        sessionStorage.setItem(
          "campusos:conversation:" + scope.current,
          history.conversationId,
        );
      } catch {}
      conversationRef.current = history.conversationId;
      setView((prior) => ({
        id: history.conversationId,
        ...restoredSearchPreference(prior, history, searchWrite.current),
        messages:
          mode === "replace" || prior.id !== history.conversationId
            ? history.messages
            : [
                ...new Map(
                  [...prior.messages, ...history.messages].map((m) => [
                    m.id,
                    m,
                  ]),
                ).values(),
              ].sort(
                (a, b) =>
                  (a.sequence ?? Number.MAX_SAFE_INTEGER) -
                  (b.sequence ?? Number.MAX_SAFE_INTEGER),
              ),
        title:
          history.title ||
          conversationTitle(
            history.messages.find((m) => m.role === "user")?.text || "",
          ) ||
          "新对话",
      }));
    },
    [],
  );
  const boot = useCallback(async () => {
    const started = generation.current;
    let restoreError = "";
    try {
      const session = (await jsonApi("/api/agent/session")) as Session;
      if (started !== generation.current) return;
      if (scope.current && scope.current !== session.scopeKey) {
        invalidate();
        if (
          mapRef.current.route &&
          (knownRoutes.current.has(mapRef.current.route.id) ||
            (displayedRouteOwner.current?.routeId === mapRef.current.route.id &&
              displayedRouteOwner.current.scopeKey === scope.current))
        )
          mapRef.current.stopNavigation();
        displayedRouteOwner.current = null;
        resetSemantics();
        chosen.current = false;
        listWork.current?.abort();
        setListBusy(false);
        conversationRef.current = undefined;
        setView(blankConversation());
        setConversations([]);
      }
      scope.current = session.scopeKey;
      sessionKind.current = session.kind;
      const readyGeneration = generation.current;
      if (!pending.current && !historyWork.current) {
        if (!chosen.current) {
          let saved: string | null = null;
          try {
            saved = sessionStorage.getItem(
              "campusos:conversation:" + session.scopeKey,
            );
          } catch {}
          if (
            saved &&
            saved !==
              (session.history as { conversationId?: string } | null)
                ?.conversationId
          ) {
            try {
              session.history = await jsonApi(
                `/api/agent/conversations/${saved}`,
              );
            } catch {
              try {
                sessionStorage.removeItem(
                  "campusos:conversation:" + session.scopeKey,
                );
              } catch {}
            }
            if (readyGeneration !== generation.current) return;
          }
          if (session.history)
            acceptHistory(AssistantHistorySchema.parse(session.history));
          else {
            conversationRef.current = undefined;
            setView(blankConversation());
          }
          chosen.current = true;
        } else if (conversationRef.current) {
          const cid = conversationRef.current,
            rev = generation.current;
          try {
            const history = AssistantHistorySchema.parse(
              await jsonApi(
                `/api/agent/conversations/${cid}?after=${latestSequence.current}`,
              ),
            );
            if (rev === generation.current && cid === conversationRef.current)
              acceptHistory(history, "merge");
          } catch (cause) {
            if (rev === generation.current) {
              if (
                cause instanceof AssistantRequestError &&
                cause.status === 404
              ) {
                resetSemantics();
                conversationRef.current = undefined;
                setView(blankConversation());
              }
              restoreError = "对话暂不可用，请稍后重试。";
            }
          }
        }
      }
      if (readyGeneration !== generation.current) return;
      setReady(session.model.ready);
      setError(
        session.model.ready ? restoreError : "AI 暂不可用，请稍后重试。",
      );
      initialized.current = true;
      setConnected(true);
    } catch (cause) {
      if (started !== generation.current) return;
      setReady(false);
      setError(cause instanceof Error ? cause.message : "连接失败，请重试。");
    }
  }, [invalidate, resetSemantics, acceptHistory]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void boot(), 0);
    return () => clearTimeout(timer);
  }, [open, boot]);
  useEffect(() => {
    const focus = () => {
      if (open && initialized.current && !pending.current) void boot();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [boot, open]);
  useEffect(() => {
    const identityChanged = () => {
      // Switch the visible scope in both directions without claiming guest history.
      invalidate();
      if (displayedRouteOwner.current) mapRef.current.stopNavigation();
      displayedRouteOwner.current = null;
      resetSemantics();
      chosen.current = false;
      listWork.current?.abort();
      setListBusy(false);
      conversationRef.current = undefined;
      setView(blankConversation());
      setConversations([]);
      setNextCursor(null);
      initialized.current = false;
      setConnected(false);
      if (open) void boot();
    };
    window.addEventListener("campusos:identity-changed", identityChanged);
    return () =>
      window.removeEventListener("campusos:identity-changed", identityChanged);
  }, [boot, invalidate, open, resetSemantics]);
  const cancel = useCallback(() => {
    invalidate();
    setError("已停止回复。");
  }, [invalidate]);
  const newConversation = () => {
    try {
      sessionStorage.removeItem("campusos:conversation:" + scope.current);
    } catch {}
    invalidate();
    resetSemantics();
    chosen.current = true;
    conversationRef.current = undefined;
    setView(blankConversation());
    setOlderCursor(null);
    latestSequence.current = 0;
    setError("");
  };
  const loadConversations = async (more = false) => {
    listWork.current?.abort();
    const controller = new AbortController();
    listWork.current = controller;
    const owner = scope.current;
    setListBusy(true);
    setHistoryError("");
    try {
      const list = ConversationListSchema.parse(
        await jsonApi(
          `/api/agent/conversations${more && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ""}`,
          undefined,
          controller.signal,
        ),
      );
      if (controller.signal.aborted || owner !== scope.current) return;
      setConversations((prior) =>
        more
          ? [
              ...prior.filter(
                (p) => !list.conversations.some((n) => n.id === p.id),
              ),
              ...list.conversations,
            ]
          : list.conversations,
      );
      setNextCursor(list.nextCursor);
    } catch {
      if (!controller.signal.aborted)
        setHistoryError("无法加载历史对话，请重试。");
    } finally {
      if (listWork.current === controller) {
        listWork.current = null;
        setListBusy(false);
      }
    }
  };
  const openConversation = async (id: string) => {
    const prior = viewRef.current,
      rev = invalidate();
    resetSemantics();
    chosen.current = true;
    const controller = new AbortController();
    historyWork.current = controller;
    conversationRef.current = id;
    setView({ id, title: "对话", messages: [] });
    setLoadingConversation(true);
    setError("");
    try {
      await cancellation.current;
      const history = AssistantHistorySchema.parse(
        await jsonApi(
          `/api/agent/conversations/${id}`,
          undefined,
          controller.signal,
        ),
      );
      if (
        acceptsConversationResult(
          rev,
          generation.current,
          controller.signal.aborted,
        )
      )
        acceptHistory(history);
    } catch {
      if (
        acceptsConversationResult(
          rev,
          generation.current,
          controller.signal.aborted,
        )
      ) {
        conversationRef.current = prior.id;
        setView(prior);
        setError("无法打开对话，请重试。");
      }
    } finally {
      if (rev === generation.current) {
        historyWork.current = null;
        setLoadingConversation(false);
      }
    }
  };
  const loadEarlier = async () => {
    const cid = conversationRef.current,
      cursor = olderCursor,
      revision = generation.current;
    if (!cid || !cursor || olderWork.current) return;
    const controller = new AbortController();
    setHistoryError("");
    olderWork.current = controller;
    setOlderBusy(true);
    try {
      const history = AssistantHistorySchema.parse(
        await jsonApi(
          `/api/agent/conversations/${cid}?before=${cursor}`,
          undefined,
          controller.signal,
        ),
      );
      if (
        cid === conversationRef.current &&
        revision === generation.current &&
        !controller.signal.aborted
      )
        acceptHistory(history, "prepend");
    } catch {
      if (!controller.signal.aborted)
        setHistoryError("无法加载更早消息，请重试。");
    } finally {
      if (olderWork.current === controller) {
        olderWork.current = null;
        setOlderBusy(false);
      }
    }
  };
  useEffect(() => {
    if (!open) return;
    let syncing = false;
    const sync = async () => {
      const cid = conversationRef.current,
        revision = generation.current;
      if (
        syncing ||
        document.hidden ||
        pending.current ||
        historyWork.current ||
        olderWork.current ||
        !cid ||
        sessionKind.current !== "user"
      )
        return;
      syncing = true;
      try {
        const history = AssistantHistorySchema.parse(
          await jsonApi(
            `/api/agent/conversations/${cid}?after=${latestSequence.current}`,
          ),
        );
        if (
          cid === conversationRef.current &&
          revision === generation.current &&
          !pending.current
        )
          acceptHistory(history, "merge");
      } catch (cause) {
        if (cause instanceof AssistantRequestError && cause.status === 404)
          void boot();
      } finally {
        syncing = false;
      }
    };
    const timer = setInterval(() => void sync(), 15000);
    return () => clearInterval(timer);
  }, [open, acceptHistory, boot]);
  const deleteConversation = async (id: string) => {
    const current = conversationRef.current === id;
    if (current) invalidate();
    const owner = scope.current;
    await jsonApi(
      `/api/agent/conversations/${id}`,
      undefined,
      undefined,
      "DELETE",
    );
    if (owner !== scope.current) return;
    setConversations((prior) => prior.filter((p) => p.id !== id));
    if (conversationRef.current === id) {
      invalidate();
      resetSemantics();
      conversationRef.current = undefined;
      chosen.current = true;
      setView((prior) => afterConversationDelete(prior, id));
      setError("");
    }
  };
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
    signal.throwIfAborted();
    await prepareRef.current();
    await frames();
  };
  const selectedContext = () => {
    const manual = mapRef.current.getAssistantSelection();
    return manual.revision > selectionBoundary.current
      ? manual.placeId
      : semanticPlace.current;
  };
  const showCard = async (card: AssistantCard, navigate = false) => {
    if (card.kind === "source" || card.kind === "external_source") return;
    if (pending.current) cancel();
    setError("");
    cardWork.current?.abort();
    const controller = new AbortController();
    cardWork.current = controller;
    const signal = controller.signal,
      revision = generation.current,
      cid = conversationRef.current;
    const expected = mapRef.current.getInteractionVersion();
    try {
      await toMap(signal);
      if (
        !acceptsConversationResult(
          revision,
          generation.current,
          signal.aborted,
        ) ||
        expected !== mapRef.current.getInteractionVersion()
      )
        return;
      if (card.kind === "place") {
        mapRef.current.executeAction({
          type: "FOCUS_PLACE",
          placeId: card.place.placeId,
        });
        semanticPlace.current = card.place.placeId;
        selectionBoundary.current =
          mapRef.current.getAssistantSelection().revision;
      } else {
        const route = RouteOutputSchema.parse(
          await jsonApi(
            `/api/agent/routes/${card.routeId}`,
            {
              ticket: tickets.current.get(card.routeId),
              conversationId: cid,
            },
            signal,
          ),
        );
        if (
          !acceptsConversationResult(
            revision,
            generation.current,
            signal.aborted,
          ) ||
          expected !== mapRef.current.getInteractionVersion()
        )
          return;
        mapRef.current.installRoute(route);
        displayedRouteOwner.current = {
          routeId: route.routeId,
          scopeKey: scope.current,
        };
        mapRef.current.executeAction({
          type: "SHOW_ROUTE",
          routeId: route.routeId,
        });
        semanticPlace.current = route.start.placeId;
        selectionBoundary.current =
          mapRef.current.getAssistantSelection().revision;
        await frames();
        if (
          navigate &&
          acceptsConversationResult(
            revision,
            generation.current,
            signal.aborted,
          )
        )
          mapRef.current.beginNavigation();
      }
    } catch (cause) {
      if (
        acceptsConversationResult(revision, generation.current, signal.aborted)
      )
        setError(cause instanceof Error ? cause.message : "地图操作失败。");
    }
  };
  const send = async (text: string) => {
    const searchSnapshot = viewRef.current.smartSearch ?? false;
    if (pending.current || loadingConversation || !text.trim() || !ready)
      return;
    const controller = new AbortController(),
      requestId = crypto.randomUUID(),
      revision = ++generation.current;
    pending.current = { controller, requestId };
    setBusy(true);
    setError("");
    setStatus("正在查询");
    let cid = conversationRef.current;
    const messageScope =
      cid || (await requestConversationId(scope.current, requestId));
    if (revision !== generation.current || controller.signal.aborted) return;
    const assistantId = `${messageScope}:${requestId}:assistant`;
    let artifact: z.infer<typeof AssistantArtifactSchema> | undefined;
    let terminalError = "";
    let expectedMapVersion = mapRef.current.getInteractionVersion();
    const userMessage: StoredMessage = {
      id: `${messageScope}:${requestId}:user`,
      role: "user",
      text,
      cards: [],
    };
    setMessages((previous) => [
      ...previous,
      userMessage,
      { id: assistantId, role: "assistant" as const, text: "", cards: [] },
    ]);

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
            conversationId: z.string().uuid().optional(),
            actions: z.array(MapActionSchema),
            routes: z.array(RouteOutputSchema),
          })
          .strict()
          .parse(
            await jsonApi(
              `/api/agent/actions/${packet.id}/claim`,
              {
                tickets: value.routes.map((item) => item.ticket),
                conversationId: cid,
              },
              controller.signal,
            ),
          );
        if (revision !== generation.current || controller.signal.aborted)
          return;
        if (
          claimed.conversationId &&
          claimed.conversationId !== conversationRef.current
        )
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
            displayedRouteOwner.current = {
              routeId: route.routeId,
              scopeKey: scope.current,
            };
            semanticPlace.current = route.start.placeId;
          }
          if (
            action.type === "FOCUS_PLACE" ||
            action.type === "SHOW_PLACE_DETAILS"
          )
            semanticPlace.current = action.placeId;
          mapRef.current.executeAction(action);
          if (action.type === "CLEAR_ROUTE") displayedRouteOwner.current = null;
          selectionBoundary.current =
            mapRef.current.getAssistantSelection().revision;
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
      await cancellation.current;
      if (
        !acceptsConversationResult(
          revision,
          generation.current,
          controller.signal.aborted,
        )
      )
        return;
      let locationGrant: unknown;
      if (
        navigationIntent(
          text,
          selectedContext(),
          false,
          pendingNavigationMessages(messages),
        ).needsLocation
      ) {
        setStatus("等待定位");
        try {
          const challenge = z
            .object({
              challenge: z.string(),
              serverTime: z.number().int().positive(),
            })
            .passthrough()
            .parse(
              await jsonApi(
                "/api/agent/location/challenge",
                {},
                controller.signal,
              ),
            );
          const receivedAt = performance.now();
          const position = await requestOneTimeLocation(controller.signal);
          locationGrant = {
            challenge: challenge.challenge,
            coordinate: position.coordinate,
            accuracyMeters: position.accuracy,
            capturedAt: locationCaptureTime(
              challenge.serverTime,
              performance.now() - receivedAt,
              Date.now() - position.timestamp,
            ),
          };
        } catch {
          if (
            acceptsConversationResult(
              revision,
              generation.current,
              controller.signal.aborted,
            )
          )
            setStatus("无法获取定位，请输入起点");
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
          smartSearch: searchSnapshot,
          mapContext: {
            selectedPlaceId: selectedContext() || undefined,
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
              ).slice(0, 200000),
            }));
          }
          if (event.type === "tool.started")
            setStatus(toolLabels[String(event.payload.name)] || "正在查询");
          if (event.type === "artifact.ready") {
            if (event.payload.started) {
              cid = z.string().uuid().parse(event.payload.conversationId);
              chosen.current = true;
              setConversationId(cid);
              try {
                sessionStorage.setItem(
                  "campusos:conversation:" + scope.current,
                  cid,
                );
              } catch {}
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
        // A response can be lost after the server committed. Read it back without
        // re-running the model, tools or historical map actions.
        try {
          const saved = AssistantHistorySchema.parse(
            await jsonApi(`/api/agent/conversations/${cid || messageScope}`),
          );
          if (revision === generation.current) acceptHistory(saved, "merge");
        } catch {
          /* Preserve the original network/model error when nothing was saved. */
        }
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
    smartSearch: view.smartSearch ?? false,
    savingSearch,
    setSmartSearch: async (enabled: boolean) => {
      if (searchWrite.current) return;
      const id = conversationRef.current,
        revision = generation.current;
      const previous = viewRef.current.smartSearch ?? false;
      setView((prior) => ({ ...prior, smartSearch: enabled }));
      if (!id) return;
      searchWrite.current = true;
      setSavingSearch(true);
      try {
        const saved = z
          .object({
            smartSearch: z.boolean(),
            smartSearchVersion: z.number().int().nonnegative().optional(),
          })
          .parse(
            await jsonApi(
              `/api/agent/conversations/${id}`,
              { smartSearch: enabled },
              undefined,
              "PATCH",
            ),
          );
        if (revision === generation.current && id === conversationRef.current)
          setView((prior) => ({ ...prior, ...saved }));
      } catch {
        if (revision === generation.current && id === conversationRef.current) {
          setView((prior) => ({ ...prior, smartSearch: previous }));
          setError("搜索设置未保存，请重试。");
        }
      } finally {
        searchWrite.current = false;
        setSavingSearch(false);
      }
    },
    conversationId,
    title: view.title,
    connected,
    loadingConversation,
    olderCursor,
    olderBusy,
    loadEarlier,
    conversations,
    nextCursor,
    listBusy,
    historyError,
    newConversation,
    openConversation,
    deleteConversation,
    loadConversations,
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
      invalidate();
      setError("");
      mapRef.current.stopNavigation();
      displayedRouteOwner.current = null;
    },
  };
}
