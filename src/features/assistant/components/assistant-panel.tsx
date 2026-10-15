"use client";

import { Drawer } from "@base-ui/react/drawer";
import { useCampusMap } from "@/features/campus-map/components/campus-map-provider";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAssistant } from "../use-assistant";
import {
  ArrowUp,
  Maximize2,
  Minimize2,
  Square,
  Sparkles,
  X,
} from "lucide-react";

const SNAP_POINTS = [0.62, 1];

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
  const { assistantPlace } = useCampusMap();
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
  const end = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [chat.messages, chat.status]);
  const submit = () => {
    if (!input.trim() || chat.busy || !chat.ready) return;
    const text = input.trim();
    if (compact) document.getElementById("assistant-message")?.blur();
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
                    <span className="assistant-title-icon">
                      <Sparkles size={17} strokeWidth={1.65} />
                    </span>
                    <Drawer.Title>校园助理</Drawer.Title>
                  </div>
                  <div className="assistant-actions">
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
                >
                  <Drawer.Description className="sr-only">
                    校园地点与步行路线助手
                  </Drawer.Description>
                  {assistantPlace && (
                    <p className="assistant-map-context">
                      当前地点：{assistantPlace.name}
                    </p>
                  )}
                  {!chat.messages.length && <h3>想去哪里？</h3>}
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
                        {message.text && !(message.error && message.error === chat.error) && (
                          <p>{message.text.replace(/\*\*(.*?)\*\*/g, "$1")}</p>
                        )}
                        {message.cards.map((card, index) =>
                          card.kind === "place" ? (
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
                                  onClick={() => void chat.showCard(card)}
                                >
                                  显示路线
                                </button>
                                <button
                                  onClick={() => void chat.showCard(card, true)}
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
                </Drawer.Content>
                <div className="assistant-composer" data-base-ui-swipe-ignore>
                  <div className="assistant-input">
                    <label className="sr-only" htmlFor="assistant-message">
                      向校园助理提问
                    </label>
                    <textarea
                      id="assistant-message"
                      placeholder="问地点、路线…"
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
                      disabled={!chat.ready}
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
              </div>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.VirtualKeyboardProvider>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
