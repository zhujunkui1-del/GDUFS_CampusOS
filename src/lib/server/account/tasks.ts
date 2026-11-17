import {
  ChangeTaskSchema,
  CreateTaskSchema,
  type PersonalTask,
} from "@/domain/account/tasks";
import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";
import { readCalendar } from "../calendar/query";
import { safeExternalUrl } from "@/domain/console/contracts";
import { CALENDAR_VERSION } from "@/domain/calendar/extraction";
import { calendarBodyAllowedSql } from "../calendar/content-scope";

export class PersonalTaskStore {
  constructor(private db: SqlDatabase) {}

  async list(userId: string, now = Date.now()): Promise<PersonalTask[]> {
    const { results } = await this.db
      .prepare(
        `WITH mine AS MATERIALIZED (
      SELECT id,version,title,status,due_at,notes,event_id,event_day,article_id
      FROM user_tasks WHERE user_id=? AND status<>'deleted'
    ) SELECT mine.*, (SELECT p.url FROM console_public_documents p WHERE p.id=mine.article_id) AS article_url,
      EXISTS(SELECT 1 FROM article_activity_index a JOIN knowledge_documents d ON d.id=a.document_id
        JOIN document_article_analysis x ON x.document_id=d.id AND x.content_revision=d.content_revision AND x.input_hash=d.input_hash
        WHERE a.document_id=mine.article_id AND a.group_key=mine.event_id AND a.calendar_eligible=1
          AND a.calendar_version=x.calendar_version AND a.calendar_version=?
          AND (mine.event_day IS NULL OR mine.event_day BETWEEN a.starts_day AND COALESCE(a.ends_day,a.starts_day))
          AND (json_extract(a.activity_json,'$.calendar.usesBody')=0 OR (${calendarBodyAllowedSql()}))
          AND json_extract(a.activity_json,'$.status') NOT IN('cancelled','postponed')) AS active_event
      FROM mine ORDER BY due_at IS NULL,due_at,id`,
      )
      .bind(userId, CALENDAR_VERSION)
      .all<{
        id: string;
        version: number;
        title: string;
        notes: string;
        due_at: string | null;
        status: string;
        event_id: string | null;
        event_day: string | null;
        article_id: string | null;
        article_url: string | null;
        active_event: number;
      }>();
    return results.map((r) => ({
      id: r.id,
      version: r.version,
      title: r.title,
      notes: r.notes,
      dueAt: r.due_at,
      status:
        r.status === "completed"
          ? "completed"
          : r.due_at && Date.parse(r.due_at) < now
            ? "overdue"
            : "pending",
      source: r.article_id
        ? {
            articleId: r.article_id,
            eventId: r.event_id ?? undefined,
            day: r.event_day ?? undefined,
            articleAvailable: !!r.article_url,
            articleUrl: safeExternalUrl(r.article_url),
            eventChanged: !!r.event_id && (!r.active_event || !r.article_url),
          }
        : null,
    }));
  }

  async create(userId: string, raw: unknown) {
    const { key, title, dueAt, notes, source } = CreateTaskSchema.parse(raw);
    if (source) {
      const article = await this.db
        .prepare("SELECT id FROM console_public_documents WHERE id=?")
        .bind(source.articleId)
        .first();
      if (!article) throw new ApiError("NOT_FOUND", "文章已不可用。");
      if (source.eventId) {
        const events = await readCalendar(this.db, {
          event: source.eventId,
          day: source.day,
        });
        if (
          !events.items.some((e) =>
            e.sources.some((s) => s.documentId === source.articleId),
          )
        )
          throw new ApiError("NOT_FOUND", "活动已更新，请重新选择。");
      }
    }
    await this.db
      .prepare(
        `INSERT INTO user_tasks(id,user_id,title,due_at,notes,idempotency_key,article_id,event_id,event_day)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        title,
        dueAt ? new Date(dueAt).toISOString() : null,
        notes,
        key,
        source?.articleId ?? null,
        source?.eventId ?? null,
        source?.day ?? null,
      )
      .run();
    return { saved: true };
  }

  async change(userId: string, raw: unknown) {
    const input = ChangeTaskSchema.parse(raw);
    const values =
      input.action === "edit"
        ? [
            input.title,
            input.dueAt ? new Date(input.dueAt).toISOString() : null,
            input.notes,
          ]
        : [input.action === "complete" ? "completed" : "deleted"];
    const result = await this.db
      .prepare(
        `UPDATE user_tasks SET ${input.action === "edit" ? "title=?,due_at=?,notes=?" : "status=?"},version=version+1
      WHERE user_id=? AND id=? AND version=? AND status<>'deleted'`,
      )
      .bind(...values, userId, input.id, input.version)
      .run();
    if (!result.meta.changes)
      throw new ApiError("CONFLICT", "待办已更新，请刷新后重试。");
    return { saved: true };
  }
}
