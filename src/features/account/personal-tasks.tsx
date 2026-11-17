"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ListPlus } from "lucide-react";
import type { PersonalTask, TaskStatus } from "@/domain/account/tasks";
import type { CalendarItem } from "@/lib/server/calendar/query";
import { occurrenceTime } from "@/lib/retrieval/calendar-dates";
import { PublicArticleDialog } from "@/features/content/public-article-dialog";
import type { PublicArticleSummary } from "@/features/content/public-feed";
import { accountRequest, useAccount } from "./account-context";
import "./personal-tasks.css";
import "@/features/content/favorites.css";

type TaskArticle = {
  articleId: string;
  title: string;
  event?: CalendarItem;
  day?: string;
};
const labels: Record<TaskStatus, string> = {
  pending: "待处理",
  completed: "已完成",
  overdue: "已逾期",
};
const toField = (iso: string | null) =>
  !iso
    ? ""
    : new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16);

function preset(
  event: CalendarItem | undefined,
  day: string | undefined,
  kind: string,
) {
  if (!event || kind === "custom") return "";
  if (kind === "register") {
    const dates = [
      ...new Set(
        event.activity.registrationWindows.flatMap((window) =>
          window.end?.at
            ? [toField(window.end.at)]
            : window.end?.date
              ? [window.end.date + "T23:59"]
              : [],
        ),
      ),
    ];
    return dates.length === 1 ? dates[0] : "";
  }
  const date = day ?? event.activity.startsAt?.date;
  const clock = date && occurrenceTime(date, event.activity).startTime;
  return clock ? `${date}T${clock}` : "";
}

function TaskEditor({
  article,
  task,
  onClose,
  onSaved,
}: {
  article?: TaskArticle;
  task?: PersonalTask;
  onClose(): void;
  onSaved(dueAt: string | null): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [events, setEvents] = useState<CalendarItem[]>(
    article?.event ? [article.event] : [],
  );
  const [eventId, setEventId] = useState(article?.event?.eventId ?? "");
  const [kind, setKind] = useState(article?.event ? "attend" : "custom");
  const [title, setTitle] = useState(
    task?.title ??
      (article?.event
        ? `参加：${article.event.activity.title}`
        : (article?.title ?? "")
      ).slice(0, 200),
  );
  const [time, setTime] = useState(
    task ? toField(task.dueAt) : preset(article?.event, article?.day, "attend"),
  );
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  useEffect(() => {
    if (!article || article.event) return;
    const abort = new AbortController();
    fetch(
      `/api/public/activities?limit=50&articleId=${encodeURIComponent(article.articleId)}`,
      { signal: abort.signal },
    )
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok || !payload.ok) throw Error("活动场次暂时无法加载。");
        return payload.data.items as CalendarItem[];
      })
      .then((items) => {
        if (!abort.signal.aborted) {
          setEvents(items);
          if (items.length === 1) setEventId(items[0].eventId);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [article]);
  const event = events.find((item) => item.eventId === eventId);
  function select(id: string, nextKind: string) {
    setEventId(id);
    setKind(nextKind);
    const next = events.find((item) => item.eventId === id);
    const name = next?.activity.title || article?.title || "";
    setTitle(
      (nextKind === "custom"
        ? name
        : `${nextKind === "register" ? "报名" : "参加"}：${name}`
      ).slice(0, 200),
    );
    setTime(preset(next, article?.day, nextKind));
  }
  return (
    <dialog
      ref={dialog}
      aria-label={task ? "编辑待办" : "新建待办"}
      className="conversation-confirm task-editor"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <h2>{task ? "编辑待办" : "新建待办"}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const fields = {
              title,
              notes,
              dueAt: time ? time + ":00+08:00" : null,
            };
            if (task)
              await accountRequest(
                "/api/me/tasks",
                {
                  ...fields,
                  id: task.id,
                  version: task.version,
                  action: "edit",
                },
                "PATCH",
              );
            else
              await accountRequest("/api/me/tasks", {
                ...fields,
                key,
                ...(article
                  ? {
                      source: {
                        articleId: article.articleId,
                        eventId: event?.eventId,
                        day: article.day ?? event?.activity.startsAt?.date,
                      },
                    }
                  : {}),
              });
            onSaved(fields.dueAt);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败。");
          } finally {
            setBusy(false);
          }
        }}
      >
        {events.length > 1 && (
          <label>
            场次
            <select
              value={eventId}
              onChange={(e) => select(e.target.value, kind)}
            >
              <option value="">选择场次</option>
              {events.map((item) => (
                <option key={item.eventId} value={item.eventId}>
                  {item.activity.startsAt?.at?.slice(0, 16).replace("T", " ") ||
                    item.activity.startsAt?.date}{" "}
                  · {item.activity.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {event && !task && (
          <label>
            事项
            <select
              value={kind}
              onChange={(e) => select(eventId, e.target.value)}
            >
              <option value="custom">自定义</option>
              <option value="register">报名</option>
              <option value="attend">参加</option>
            </select>
          </label>
        )}
        <label>
          标题
          <input
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          逾期时间
          <input
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label>
          备注
          <textarea
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="conversation-confirm-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            className="task-primary"
            disabled={busy || (events.length > 1 && !eventId)}
          >
            保存
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function AddTaskButton({ article }: { article: TaskArticle }) {
  const { session } = useAccount();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <button
        type="button"
        className="favorite-button task-add-button"
        title="添加待办"
        aria-label="添加待办"
        onClick={() => {
          if (!session?.user) router.push("/account/login");
          else setOpen(true);
        }}
      >
        <ListPlus size={21} aria-hidden="true" />
      </button>
      {open && (
        <TaskEditor
          article={article}
          onClose={() => setOpen(false)}
          onSaved={() => setSaved(true)}
        />
      )}
      {saved && (
        <span className="sr-only" role="status">
          已添加待办
        </span>
      )}
    </>
  );
}

export function PersonalTasks({ userId }: { userId: string }) {
  const [status, setStatus] = useState<"pending" | "history">("pending");
  const [items, setItems] = useState<PersonalTask[]>();
  const [edit, setEdit] = useState<PersonalTask | "new" | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingSource, setReadingSource] = useState(false);
  const [source, setSource] = useState<{
    article: PublicArticleSummary;
    fromEvent: boolean;
  } | null>(null);
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    let active = true;
    accountRequest<{ items: PersonalTask[] }>("/api/me/tasks", undefined, "GET")
      .then((data) => {
        if (active) setItems(data.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision, userId]);
  const visible = items?.filter(
    (item) => (item.status === "pending") === (status === "pending"),
  );
  async function openSource(reference: NonNullable<PersonalTask["source"]>) {
    setReadingSource(true);
    setError("");
    try {
      const { items } = await accountRequest<{ items: PublicArticleSummary[] }>(
        `/api/public/content?id=${encodeURIComponent(reference.articleId)}`,
        undefined,
        "GET",
      );
      if (!items[0]) throw Error("文章已不可用。");
      setSource({ article: items[0], fromEvent: !!reference.eventId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "文章暂时无法读取。");
    } finally {
      setReadingSource(false);
    }
  }
  async function change(task: PersonalTask, action: "complete" | "delete") {
    setBusy(true);
    setError("");
    try {
      await accountRequest(
        "/api/me/tasks",
        { id: task.id, version: task.version, action },
        "PATCH",
      );
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="task-toolbar">
        <div className="favorites-tabs" role="group" aria-label="待办状态">
          {(["pending", "history"] as const).map((value) => (
            <button
              type="button"
              aria-pressed={status === value}
              key={value}
              onClick={() => setStatus(value)}
            >
              {value === "pending" ? labels.pending : "已完成 | 已逾期"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="task-primary"
          onClick={() => setEdit("new")}
        >
          新建待办
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!error && !items && <p role="status">正在加载待办…</p>}
      {visible?.length === 0 && (
        <p className="favorites-empty">
          {status === "pending" ? "暂无待处理事项" : "暂无已完成或已逾期事项"}
        </p>
      )}
      <div className="favorites-list">
        {visible?.map((task) => (
          <article className="favorites-card task-card" key={task.id}>
            <div className="task-card-content">
              <strong>{task.title}</strong>
              {status === "history" && (
                <span className="task-card-status" data-status={task.status}>
                  {labels[task.status]}
                </span>
              )}
              {task.dueAt && (
                <time dateTime={task.dueAt}>
                  {toField(task.dueAt).replace("T", " ")}
                </time>
              )}
              {task.notes && <p>{task.notes}</p>}
              {task.source?.eventChanged && <p>原活动已更新或不可用</p>}
            </div>
            <div className="task-card-footer">
              {task.source?.articleAvailable && (
                <button
                  type="button"
                  className="task-primary task-source-button"
                  disabled={readingSource}
                  onClick={() => {
                    if (task.source) void openSource(task.source);
                  }}
                >
                  查看来源
                </button>
              )}
              <div className="task-card-actions">
                <button type="button" onClick={() => setEdit(task)}>
                  编辑
                </button>
                {task.status !== "completed" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void change(task, "complete")}
                  >
                    完成
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void change(task, "delete")}
                >
                  删除
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {source && (
        <PublicArticleDialog
          article={source.article}
          categoryLabel={source.fromEvent ? "活动原文" : "来源文章"}
          surface={
            source.fromEvent
              ? "calendar"
              : source.article.primaryDestination === "knowledge"
                ? "knowledge"
                : "radar"
          }
          onClose={() => setSource(null)}
        />
      )}
      {edit && (
        <TaskEditor
          task={edit === "new" ? undefined : edit}
          onClose={() => setEdit(null)}
          onSaved={(dueAt) => {
            if (edit === "new")
              setStatus(
                dueAt && Date.parse(dueAt) < Date.now() ? "history" : "pending",
              );
            refresh();
          }}
        />
      )}
    </>
  );
}
