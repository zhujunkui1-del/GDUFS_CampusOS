"use client";

import { Drawer } from "@base-ui/react/drawer";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ConversationSummary } from "@/domain/agent/assistant-contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type UIEvent,
} from "react";
import { useAssistant } from "../use-assistant";
import { AssistantSources } from "./assistant-sources";
import { AssistantMessageText } from "./assistant-message-text";
import { precedingQuestion } from "@/lib/assistant-output";
import {
  ArrowUp,
  Maximize2,
  Minimize2,
  Square,
  Sparkles,
  X,
  History,
  SquarePen,
  ArrowLeft,
  Trash2,
} from "lucide-react";

const SNAP_POINTS = [0.62, 1];
const historyDate = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Shanghai",
});

function isKeyboardInteraction(event: { type: string; detail?: number }) {
  return (
    event.type.startsWith("key") ||
    (event.type === "click" && event.detail === 0)
  );
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function AssistantPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const compact = useMediaQuery(
    "(max-width: 760px), (max-width: 1024px) and (max-height: 500px)",
  );
  const shortViewport = useMediaQuery("(max-height: 600px)");
  const [snapPoint, setSnapPoint] = useState<Drawer.Root.SnapPoint | null>(
    0.62,
  );
  const [instant, setInstant] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const effectiveSnapPoint = compact && shortViewport ? 1 : snapPoint;
  const expanded = effectiveSnapPoint === 1;
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState("");
  const messageInput = useRef<HTMLTextAreaElement>(null),
    newButton = useRef<HTMLButtonElement>(null),
    historyButton = useRef<HTMLButtonElement>(null),
    cancelDelete = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // Only follow new output while the reader is already at the bottom, and never
  // let a re-render, focus change or history refresh move the reader.
  const stickToBottom = useRef(true);
  const messageCount = useRef(0);
  const lastScroll = useRef(0);
  const pointerScroll = useRef<{ top: number; user: boolean } | null>(null);
  const trackScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    lastScroll.current = element.scrollTop;
  };
  const markUserScroll = () => {
    if (pointerScroll.current) pointerScroll.current.user = true;
  };
  const prepareMap = useCallback(async () => {
    if (!compact) return;
    onOpenChange(false);
    let prior = -1,
      stable = 0;
    const start = performance.now();
    while (performance.now() - start < 700 && stable < 3) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const top =
        document.querySelector(".assistant-frame")?.getBoundingClientRect()
          .top ?? 0;
      stable = Math.abs(prior - top) < 0.5 ? stable + 1 : 0;
      prior = top;
    }
  }, [compact, onOpenChange]);
  const showFailure = useCallback(() => onOpenChange(true), [onOpenChange]);
  const chat = useAssistant(open, prepareMap, showFailure);
  const focusComposer = () => {
    if (!window.matchMedia("(pointer: coarse)").matches)
      requestAnimationFrame(() =>
        messageInput.current?.focus({ preventScroll: true }),
      );
  };
  const newChat = () => {
    chat.newConversation();
    setInput("");
    setHistoryOpen(false);
    focusComposer();
  };
  const remove = async () => {
    if (!deleteTarget || deleting) return;
    const current = deleteTarget.id === chat.conversationId;
    setDeleting(true);
    setDeleteError("");
    try {
      await chat.deleteConversation(deleteTarget.id);
      setDeleteTarget(null);
      if (current) {
        setInput("");
        setHistoryOpen(false);
      }
    } catch {
      setDeleteError("删除失败，请重试。");
    } finally {
      setDeleting(false);
    }
  };
  const activeConversation = useRef(chat.conversationId);
  useEffect(() => {
    if (activeConversation.current === chat.conversationId) return;
    activeConversation.current = chat.conversationId;
    messageCount.current = 0;
    lastScroll.current = 0;
    stickToBottom.current = true;
  }, [chat.conversationId]);
  useEffect(() => {
    const element = document.querySelector<HTMLElement>(".assistant-body");
    if (!element) return;
    const grew = chat.messages.length > messageCount.current;
    messageCount.current = chat.messages.length;
    if (grew && stickToBottom.current) element.scrollTop = element.scrollHeight;
    else if (!grew) element.scrollTop = lastScroll.current;
  }, [chat.messages]);
  const submit = () => {
    if (!input.trim() || chat.busy || !chat.ready) return;
    const text = input.trim();
    if (compact) document.getElementById("assistant-message")?.blur();
    stickToBottom.current = true;
    setInput("");
    void chat.send(text);
  };

  return (
    <Drawer.Root
      key={compact ? "compact" : "regular"}
      open={open}
      onOpenChange={(next, details) => {
        setInstant(
          details.reason === "escape-key" ||
            isKeyboardInteraction(details.event),
        );
        if (next) setSnapPoint(shortViewport ? 1 : 0.62);
        onOpenChange(next);
      }}
      modal={false}
      disablePointerDismissal
      swipeDirection={compact ? "down" : "right"}
      snapPoints={compact ? (shortViewport ? [1] : SNAP_POINTS) : undefined}
      snapPoint={effectiveSnapPoint}
      onSnapPointChange={(point, details) => {
        setInstant(isKeyboardInteraction(details.event));
        setSnapPoint(point);
      }}
    >
      <Drawer.Trigger
        ref={launcher}
        id="assistant-launcher"
        className="assistant-launcher glass-surface"
        aria-label="打开校园助理"
        data-busy={chat.busy ? "true" : "false"}
        aria-busy={chat.busy}
      >
        <Sparkles size={19} strokeWidth={1.65} />
        <span>问 AI</span>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.VirtualKeyboardProvider>
          <Drawer.Viewport className="assistant-viewport">
            <Drawer.Popup
              id="campus-assistant"
              className={`assistant-panel ${expanded ? "drawer-full" : ""}`}
              data-instant={instant ? "" : undefined}
              initialFocus={closeButton}
              finalFocus={launcher}
            >
              <div
                className="assistant-frame"
                style={{
                  height:
                    compact && !expanded
                      ? `${Number(effectiveSnapPoint || 0.62) * 100}%`
                      : "100%",
                }}
              >
                <div
                  className="drawer-drag-region"
                  data-testid="drawer-grabber"
                  aria-hidden="true"
                >
                  <span />
                </div>
                <div className="assistant-heading">
                  <div className="assistant-title">
                    <button
                      ref={historyButton}
                      className="icon-button"
                      title={historyOpen ? "返回对话" : "历史对话"}
                      aria-label={historyOpen ? "返回对话" : "历史对话"}
                      disabled={!chat.connected}
                      onClick={() => {
                        setHistoryOpen(!historyOpen);
                        if (!historyOpen) void chat.loadConversations();
                      }}
                    >
                      {historyOpen ? (
                        <ArrowLeft size={18} />
                      ) : (
                        <History size={18} />
                      )}
                    </button>
                    <Drawer.Title title={chat.title}>
                      {historyOpen
                        ? "历史对话"
                        : chat.title === "新对话"
                          ? "校园助理"
                          : chat.title}
                    </Drawer.Title>
                  </div>
                  <div className="assistant-actions">
                    <button
                      ref={newButton}
                      className="icon-button"
                      title="新对话"
                      aria-label="新对话"
                      disabled={!chat.connected}
                      onClick={newChat}
                    >
                      <SquarePen size={18} />
                    </button>
                    <button
                      className="icon-button drawer-size-toggle"
                      onClick={(event) => {
                        setInstant(event.detail === 0);
                        setSnapPoint(expanded ? 0.62 : 1);
                      }}
                      aria-label={expanded ? "恢复半屏助理" : "展开全屏助理"}
                    >
                      {expanded ? (
                        <Minimize2 size={17} />
                      ) : (
                        <Maximize2 size={17} />
                      )}
                    </button>
                    <Drawer.Close
                      ref={closeButton}
                      className="icon-button"
                      aria-label="收起校园助理"
                    >
                      <X size={19} strokeWidth={1.6} />
                    </Drawer.Close>
                  </div>
                </div>
                <Drawer.Content
                  className="assistant-body assistant-chat"
                  data-base-ui-swipe-ignore
                  onScroll={trackScroll}
                  onWheel={markUserScroll}
                  onTouchMove={markUserScroll}
                  onPointerDown={(event) => {
                    if (
                      (event.target as HTMLElement).closest(
                        ".assistant-composer",
                      )
                    ) {
                      pointerScroll.current = null;
                      return;
                    }
                    pointerScroll.current = {
                      top: event.currentTarget.scrollTop,
                      user: false,
                    };
                  }}
                  onPointerUp={(event) => {
                    const guard = pointerScroll.current;
                    pointerScroll.current = null;
                    const element = event.currentTarget;
                    if (!guard || guard.user) return;
                    const settle = () => {
                      if (Math.abs(element.scrollTop - guard.top) > 8) {
                        element.scrollTop = guard.top;
                        lastScroll.current = guard.top;
                      }
                    };
                    settle();
                    window.setTimeout(settle, 0);
                  }}
                >
                  <Drawer.Description className="sr-only">
                    校园地点与步行路线助手
                  </Drawer.Description>
                  {historyOpen ? (
                    <div
                      className="assistant-history"
                      aria-label="历史对话列表"
                    >
                      {chat.conversations.map((item) => (
                        <div
                          key={item.id}
                          className="assistant-history-row"
                          data-current={
                            item.id === chat.conversationId ? "true" : undefined
                          }
                        >
                          <button
                            className="assistant-history-open"
                            aria-current={
                              item.id === chat.conversationId
                                ? "true"
                                : undefined
                            }
                            disabled={chat.loadingConversation}
                            onClick={() => {
                              setHistoryOpen(false);
                              setInput("");
                              void chat.openConversation(item.id);
                            }}
                          >
                            <strong>{item.title}</strong>
                            <time
                              dateTime={new Date(item.updatedAt).toISOString()}
                            >
                              {historyDate.format(item.updatedAt)}
                            </time>
                          </button>
                          <button
                            className="icon-button conversation-delete"
                            aria-label="删除对话"
                            title="删除对话"
                            disabled={chat.busy && !chat.conversationId}
                            onClick={() => {
                              setDeleteError("");
                              setDeleteTarget(item);
                            }}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      ))}
                      {chat.listBusy && <p role="status">正在加载…</p>}
                      {!chat.listBusy &&
                        !chat.conversations.length &&
                        !chat.historyError && <p>暂无历史对话</p>}
                      {chat.historyError && (
                        <p role="alert">
                          {chat.historyError}
                          <button
                            className="history-more"
                            onClick={() => void chat.loadConversations()}
                          >
                            重试
                          </button>
                        </p>
                      )}
                      {chat.nextCursor && (
                        <button
                          className="history-more"
                          disabled={chat.listBusy}
                          onClick={() => void chat.loadConversations(true)}
                        >
                          更多对话
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {chat.loadingConversation && (
                        <p role="status">正在打开对话…</p>
                      )}
                      {!chat.messages.length && !chat.loadingConversation && (
                        <h3>想了解校园里的什么？</h3>
                      )}
                      <div
                        role="log"
                        aria-label="校园助理对话"
                        aria-live="polite"
                        aria-relevant="additions text"
                      >
                        {chat.messages.map((message) => (
                          <div
                            key={message.id}
                            className={`chat-message chat-${message.role}`}
                            data-message-role={message.role}
                          >
                            {message.text &&
                              !(
                                message.error && message.error === chat.error
                              ) && (
                                <p>
                                  {message.role === "assistant" ? (
                                    <AssistantMessageText
                                      text={message.text}
                                      cards={message.cards}
                                      question={precedingQuestion(
                                        chat.messages,
                                        message.id,
                                      )}
                                    />
                                  ) : (
                                    message.text.replace(/\*\*(.*?)\*\*/g, "$1")
                                  )}
                                </p>
                              )}
                            <AssistantSources
                              cards={message.cards}
                              text={message.text}
                              question={precedingQuestion(
                                chat.messages,
                                message.id,
                              )}
                            />
                            {message.cards.map((card, index) =>
                              card.kind === "source" ||
                              card.kind ===
                                "external_source" ? null : card.kind ===
                                "place" ? (
                                <button
                                  key={card.place.placeId + index}
                                  className="assistant-place-card"
                                  onClick={() => void chat.showCard(card)}
                                >
                                  <strong>{card.place.name}</strong>
                                  {card.distanceMeters !== undefined && (
                                    <span>
                                      {Math.round(card.distanceMeters)} 米
                                    </span>
                                  )}
                                </button>
                              ) : (
                                <div
                                  key={card.routeId}
                                  className="assistant-route-card"
                                >
                                  <strong>
                                    {card.startName} → {card.endName}
                                  </strong>
                                  <span>
                                    {Math.round(card.distanceMeters)} 米 · 约{" "}
                                    {card.estimatedMinutes} 分钟
                                  </span>
                                  <div>
                                    <button
                                      onClick={() =>
                                        chat.activeRouteId === card.routeId
                                          ? chat.clearRoute()
                                          : void chat.showCard(card)
                                      }
                                    >
                                      {chat.activeRouteId === card.routeId
                                        ? "清除路线"
                                        : "显示路线"}
                                    </button>
                                    <button
                                      onClick={() =>
                                        void chat.showCard(card, true)
                                      }
                                    >
                                      开始导航
                                    </button>
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        ))}
                      </div>
                      {chat.status && (
                        <p className="assistant-status" role="status">
                          {chat.status}…
                        </p>
                      )}
                      {chat.error && (
                        <div className="assistant-error" role="alert">
                          <span>{chat.error}</span>
                          {!chat.ready && (
                            <button onClick={() => void chat.retry()}>
                              重试连接
                            </button>
                          )}
                        </div>
                      )}
                      <div ref={end} />
                    </>
                  )}
                </Drawer.Content>
                {!historyOpen && (
                  <div className="assistant-composer" data-base-ui-swipe-ignore>
                    <div className="assistant-input">
                      <label className="sr-only" htmlFor="assistant-message">
                        向校园助理提问
                      </label>
                      <textarea
                        ref={messageInput}
                        id="assistant-message"
                        placeholder="问政策、活动、地点或路线…"
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            submit();
                          }
                        }}
                        maxLength={2000}
                        disabled={!chat.ready || chat.loadingConversation}
                        enterKeyHint="send"
                      />
                      <button
                        className="send-button"
                        disabled={!chat.busy && (!chat.ready || !input.trim())}
                        aria-label={chat.busy ? "停止回复" : "发送消息"}
                        onClick={chat.busy ? chat.cancel : submit}
                      >
                        {chat.busy ? (
                          <Square size={16} fill="currentColor" />
                        ) : (
                          <ArrowUp size={19} />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.VirtualKeyboardProvider>
      </Drawer.Portal>
      <AlertDialog.Root
        open={!!deleteTarget}
        onOpenChange={(next) => {
          if (!next && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="conversation-confirm-backdrop" />
          <AlertDialog.Popup
            className="conversation-confirm"
            initialFocus={cancelDelete}
            finalFocus={historyOpen ? historyButton : newButton}
          >
            <AlertDialog.Title>删除这段对话？</AlertDialog.Title>
            <AlertDialog.Description>
              删除后，这段对话及其历史消息将无法恢复。
            </AlertDialog.Description>
            {deleteError && <p role="alert">{deleteError}</p>}
            <div className="conversation-confirm-actions">
              <AlertDialog.Close ref={cancelDelete} disabled={deleting}>
                取消
              </AlertDialog.Close>
              <button
                className="conversation-danger"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {deleting ? "正在删除…" : "删除"}
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Drawer.Root>
  );
}
