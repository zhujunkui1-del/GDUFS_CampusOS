"use client";
import { useRef, useState } from "react";

export function FeedPageJump({
  page,
  pages,
  onJump,
}: {
  page: number;
  pages: number;
  onJump(page: number): void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState("");
  function commit() {
    setEditing(false);
    if (!editing || !pages || !/^\d+$/.test(draft)) return;
    const target = Math.min(pages, Math.max(1, Number(draft)));
    if (target !== page) onJump(target);
  }
  return (
    <form
      className="public-feed-page-jump"
      aria-label="页码跳转"
      onClick={() => field.current?.focus()}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input
        ref={field}
        aria-label="当前页码"
        title="输入页码后按回车跳转"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={5}
        disabled={!pages}
        value={editing ? draft : String(page)}
        style={{ width: `${Math.max(2, String(pages).length)}ch` }}
        onFocus={(e) => {
          setDraft(String(page));
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(String(page));
            setEditing(false);
          }
        }}
      />
      <span>/ {pages}</span>
    </form>
  );
}
