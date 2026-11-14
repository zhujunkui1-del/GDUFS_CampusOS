"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCirclePlus, Send, X, ImagePlus } from "lucide-react";
import "./feedback.css";
import { uploadImage } from "./image-upload";

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
  const [images, setImages] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
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
      const form = new FormData();
      form.set("nickname", nickname);
      form.set("content", content);
      for (const file of images) form.append("images", await uploadImage(file));
      const response = await fetch("/api/public/feedback", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw Error(result.error?.message || "提交失败，请重试。");
      setNickname("");
      setContent("");
      setImages([]);
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
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              setImages((previous) => [...previous, ...files]);
              event.target.value = "";
            }}
          />
          <button
            className="feedback-upload"
            type="button"
            disabled={sending}
            onClick={() => fileInput.current!.click()}
          >
            <ImagePlus size={19} />
            上传图片
          </button>
          {images.length > 0 && (
            <ul className="feedback-files">
              {images.map((file, index) => (
                <li key={index}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    aria-label={"移除图片 " + file.name}
                    disabled={sending}
                    onClick={() =>
                      setImages((previous) =>
                        previous.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <X size={17} />
                  </button>
                </li>
              ))}
            </ul>
          )}
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
