"use client";

import { Drawer } from "@base-ui/react/drawer";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowUp,
  Maximize2,
  Minimize2,
  ShieldCheck,
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
                style={{ height: compact && !expanded ? "62%" : "100%" }}
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
                <Drawer.Content className="assistant-body">
                  <h3>服务尚未接入</h3>
                  <Drawer.Description>
                    服务接入后，可在这里查找地点、规划路线，核对校园信息。
                  </Drawer.Description>
                </Drawer.Content>
                <div className="assistant-composer" data-base-ui-swipe-ignore>
                  <div className="assistant-input">
                    <label className="sr-only" htmlFor="assistant-message">
                      向校园助理提问
                    </label>
                    <textarea
                      id="assistant-message"
                      placeholder="服务接入后即可提问"
                      disabled
                      enterKeyHint="send"
                    />
                    <button
                      className="send-button"
                      disabled
                      aria-label="发送消息"
                    >
                      <ArrowUp size={19} />
                    </button>
                  </div>
                  <div className="privacy-note">
                    <ShieldCheck size={13} strokeWidth={1.5} />
                    <span>请勿发送学校密码或验证码</span>
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
