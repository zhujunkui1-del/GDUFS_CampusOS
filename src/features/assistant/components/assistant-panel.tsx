"use client";

import { useRef, useState, type RefObject } from "react";
import { Send, ShieldCheck, Sparkles, X } from "lucide-react";

export function AssistantPanel({
  closeButtonRef,
  onClose,
}: {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const [fullDrawer, setFullDrawer] = useState(false);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  return (
    <aside
      id="campus-assistant"
      className={`assistant-panel ${fullDrawer ? "drawer-full" : ""}`}
      aria-label="校园助理"
    >
      <button
        className="drawer-handle"
        aria-label={fullDrawer ? "恢复半屏助理" : "展开全屏助理"}
        onClick={() => {
          if (!dragged.current) setFullDrawer(!fullDrawer);
          dragged.current = false;
        }}
        onPointerDown={(event) => {
          dragged.current = false;
          dragStart.current = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (
            dragStart.current !== null &&
            Math.abs(event.clientY - dragStart.current) > 35
          ) {
            dragged.current = true;
            setFullDrawer(event.clientY < dragStart.current);
          }
          dragStart.current = null;
        }}
        onPointerCancel={() => {
          dragStart.current = null;
          dragged.current = false;
        }}
      >
        <span />
      </button>
      <div className="assistant-heading">
        <div>
          <span className="overline">全局 AI</span>
          <h2>校园助理</h2>
        </div>
        <button
          ref={closeButtonRef}
          className="icon-button"
          onClick={onClose}
          aria-label="收起校园助理"
        >
          <X size={19} />
        </button>
      </div>
      <div className="assistant-body">
        <span className="assistant-emblem">
          <Sparkles size={27} />
        </span>
        <h3>校园助理暂不可用</h3>
        <p>服务接入后，可以帮你查地点、规划路线、核对校园信息。</p>
        <span className="status-pill">尚未连接</span>
        <div className="privacy-note">
          <ShieldCheck size={16} />
          <span>请勿发送学校密码或验证码。</span>
        </div>
      </div>
      <div className="assistant-input">
        <label className="sr-only" htmlFor="assistant-message">
          向校园助理提问
        </label>
        <textarea
          id="assistant-message"
          placeholder="校园助理服务尚未接入"
          disabled
        />
        <button className="send-button" disabled aria-label="发送消息">
          <Send size={18} />
        </button>
      </div>
    </aside>
  );
}
