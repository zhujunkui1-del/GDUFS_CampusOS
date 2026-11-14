"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCirclePlus, Send, X } from "lucide-react";
import "./feedback.css";

export function FeedbackEntry() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="feedback-trigger glass-surface"
        aria-label="留言区"
        title="留言区"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <MessageCirclePlus size={22} />
      </button>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [nickname, setNickname] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, content }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw Error(result.error?.message || "提交失败，请重试。");
      setNickname("");
      setContent("");
      setMessage("已提交");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败，请重试。");
    } finally {
      setSending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="feedback-dialog"
      aria-labelledby="feedback-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="feedback-panel">
        <header className="feedback-heading">
          <h2 id="feedback-title">
            <MessageCirclePlus size={25} />
            留言区
          </h2>
          <button type="button" aria-label="关闭留言区" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        <form className="feedback-form" onSubmit={submit}>
          <label className="feedback-nickname">
            昵称
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="可选，不填则匿名"
              autoComplete="nickname"
            />
          </label>
          <label>
            留言内容
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="写下你的问题、建议或补充的信息源"
              required
              rows={5}
            />
          </label>
          <footer>
            <span role="status">{message}</span>
            <button
              className="feedback-submit"
              type="submit"
              disabled={sending || !content.trim()}
            >
              <Send size={19} />
              {sending ? "提交中…" : "提交留言"}
            </button>
          </footer>
        </form>
      </section>
    </dialog>
  );
}
