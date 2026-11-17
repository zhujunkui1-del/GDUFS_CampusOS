import type { PersonalConflictTask } from "@/domain/agent/personal-task";
import type { PersonalTask } from "@/domain/account/tasks";
import type { SqlDatabase } from "./database";
import { articleTitleKey } from "@/lib/retrieval/article-title";
import {
  asksScheduleConflict,
  calendarPair,
  confirmedEnd,
} from "../calendar/compare";
import { readCalendar, type CalendarItem } from "../calendar/query";
import { chinaDate } from "@/lib/retrieval/calendar-dates";

export function resolvePersonalConflict(
  question: string,
  previous?: PersonalConflictTask,
  now = Date.now(),
): PersonalConflictTask | undefined {
  const own = /待办|代办|个人(?:日程|事项)/.test(question);
  const followup =
    previous &&
    /^(?:所有|全部|全部的|所有的|这两个|就这两个|只看这两个|重新检查|再查一下)(?:活动|事项|待办|代办)?[。！？?\s]*$/.test(
      question.trim(),
    );
  const dateMatch = /(?:20\d{2}年)?(\d{1,2})月(\d{1,2})(?:日|号)/.exec(
    question,
  );
  const dateReply =
    previous &&
    /^(?:就|看|只看)?\s*(?:20\d{2}年)?\d{1,2}月\d{1,2}(?:日|号)(?:当天|的|活动|事项|待办|代办|呢|吗|的活动|当天的活动)*[。！？?\s]*$/.test(
      question.trim(),
    );
  if (!(own && asksScheduleConflict(question)) && !followup && !dateReply)
    return;
  const pair =
    calendarPair(question) ??
    (dateReply || (followup && /这两个/.test(question))
      ? previous?.titles
      : undefined);
  const scope = pair ? "named" : "all";
  const year =
    /20\d{2}/.exec(dateMatch?.[0] ?? "")?.[0] ?? chinaDate(now).slice(0, 4);
  const date = dateMatch
    ? `${year}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`
    : undefined;
  return {
    intent: "detect_schedule_conflicts",
    dataSource: "personal_todos",
    scope,
    ...(pair ? { titles: pair } : {}),
    ...(date
      ? { date }
      : !own && !followup && previous?.date
        ? { date: previous.date }
        : {}),
    status:
      /这两个/.test(question) && !pair ? "awaiting_clarification" : "ready",
  };
}

const clean = (text: string) => text.replace(/[\[\]<>*_\\]/g, "\\$&");
type Scheduled = {
  event: CalendarItem;
  taskTitles: string[];
  start: number;
  end: number;
};
export async function scanPersonalConflicts(
  db: SqlDatabase,
  tasks: PersonalTask[],
  intent: PersonalConflictTask,
) {
  const selected = tasks.filter(
    (task) =>
      task.status !== "completed" &&
      (!intent.titles ||
        intent.titles.some((title) =>
          articleTitleKey(task.title).includes(articleTitleKey(title)),
        )),
  );
  const unresolved: { title: string; reason: string }[] = [];
  const entries = new Map<string, Scheduled>();
  for (const task of selected) {
    const source = task.source;
    if (!source?.articleAvailable) {
      unresolved.push({
        title: task.title,
        reason: source ? "来源不可用" : "只有逾期时间，未关联活动场次",
      });
      continue;
    }
    const query = source.eventId
      ? { event: source.eventId, day: source.day }
      : { articleId: source.articleId, limit: 50 };
    const { items } = await readCalendar(db, query);
    const candidates = items.filter(
      (event) =>
        event.sources.some((s) => s.documentId === source.articleId) &&
        (!source.day || event.dates.includes(source.day)) &&
        (!intent.date || event.dates.includes(intent.date)),
    );
    if (intent.date && items.length && !candidates.length) continue;
    const matches =
      source.eventId || candidates.length === 1
        ? candidates
        : candidates.filter((event) =>
            articleTitleKey(task.title).includes(
              articleTitleKey(event.activity.title),
            ),
          );
    if (matches.length !== 1) {
      unresolved.push({
        title: task.title,
        reason: matches.length
          ? "关联多个场次，需指定场次"
          : "未能核实关联活动，可能已取消、延期或更新",
      });
      continue;
    }
    const event = matches[0];
    const endAt = await confirmedEnd(db, event);
    const start = Date.parse(event.activity.startsAt?.at ?? "");
    const end = Date.parse(endAt ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      unresolved.push({
        title: task.title,
        reason: "缺少明确的开始或结束时间，日期信息不能证明全天占用",
      });
      continue;
    }
    const old = entries.get(event.eventId);
    if (old) old.taskTitles.push(task.title);
    else
      entries.set(event.eventId, {
        event,
        taskTitles: [task.title],
        start,
        end,
      });
  }
  const ordered = [...entries.values()].sort((a, b) => a.start - b.start);
  const conflicts: { first: Scheduled; second: Scheduled; minutes: number }[] =
    [];
  let active: Scheduled[] = [];
  for (const current of ordered) {
    active = active.filter((item) => item.end > current.start);
    for (const earlier of active)
      conflicts.push({
        first: earlier,
        second: current,
        minutes: (Math.min(earlier.end, current.end) - current.start) / 60000,
      });
    active.push(current);
  }
  const name = (item: Scheduled) => {
    const title = clean(item.event.activity.title);
    const url = item.event.sources[0]?.originalUrl;
    return url ? `[${title}](<${url}>)` : title;
  };
  const at = (stamp: number) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(stamp);
  const ranges = (item: Scheduled) =>
    `${at(item.start)} 至 ${chinaDate(item.start) === chinaDate(item.end) ? at(item.end).slice(-5) : at(item.end)}`;
  let text = !selected.length
    ? "你目前没有未完成的待办事项。"
    : conflicts.length
      ? `在你的待办中发现 ${conflicts.length} 组时间冲突（北京时间）\n\n` +
        conflicts
          .slice(0, 5)
          .map(
            ({ first, second, minutes }) =>
              `- ${name(first)}\n  ${ranges(first)}\n  与 ${name(second)}\n  ${ranges(second)}\n  重叠 ${minutes} 分钟。`,
          )
          .join("\n\n")
      : ordered.length >= 2
        ? "已核实的待办活动时间不冲突。\n\n" +
          ordered
            .slice(0, 5)
            .map((item) => `- ${name(item)}：${ranges(item)}。`)
            .join("\n")
        : "目前有明确起止时间的待办活动不足两场，无法完成冲突比较。";
  if (conflicts.length > 5)
    text += `\n\n其余还有 ${conflicts.length - 5} 组冲突。`;
  if (unresolved.length)
    text +=
      "\n\n以下事项尚无法判断\n" +
      unresolved
        .map((item) => `- ${clean(item.title)}：${item.reason}。`)
        .join("\n");
  if (intent.status === "awaiting_clarification")
    text = "当前没有已选定的两场活动，请提供活动名称；也可以检查全部待办。";
  const taskStatus =
    intent.status === "awaiting_clarification"
      ? "needs_input"
      : unresolved.length
        ? "partial"
        : selected.length && ordered.length < 2
          ? "insufficient_evidence"
          : "completed";
  return {
    text,
    activeTask: {
      ...intent,
      status:
        taskStatus === "needs_input"
          ? "awaiting_clarification"
          : taskStatus === "completed"
            ? "completed"
            : "partial",
    } as PersonalConflictTask,
    diagnostics: {
      resolvedIntent: intent.intent,
      dataSource: intent.dataSource,
      readStatus: "completed",
      retrievalStatus: !selected.length
        ? "empty"
        : ordered.length
          ? "matched"
          : "insufficient_evidence",
      taskStatus,
      completionReason: !selected.length
        ? "no_unfinished_tasks"
        : unresolved.length
          ? "missing_event_intervals"
          : ordered.length < 2
            ? "fewer_than_two_intervals"
            : conflicts.length
              ? "conflicts_found"
              : "checked_no_conflicts",
      totalTasks: tasks.length,
      selectedTasks: selected.length,
      verifiedEvents: ordered.length,
      sourceCount: new Set(
        ordered.flatMap(({ event }) =>
          event.sources.map(({ documentId }) => documentId),
        ),
      ).size,
      conflictCount: conflicts.length,
      unresolved: unresolved.map(({ reason }) => reason),
      timeModel: {
        taskDueAt: "deadline_only",
        eventInterval: "source_activity",
        timezone: "Asia/Shanghai",
        allDay: "date_only_is_insufficient",
        recurrence: "not_stored",
      },
      matchedEvents: ordered.map((item) => ({
        eventId: item.event.eventId,
        title: item.event.activity.title,
        start: new Date(item.start).toISOString(),
        end: new Date(item.end).toISOString(),
      })),
    },
  };
}
