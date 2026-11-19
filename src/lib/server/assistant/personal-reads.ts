import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { addDays, chinaDate, weekOf } from "@/lib/retrieval/calendar-dates";
import { PersonalTaskStore } from "../account/tasks";
import { ArticleFavoriteStore } from "../account/favorites";
import { articleTitleKey } from "@/lib/retrieval/article-title";
import { readCalendar } from "../calendar/query";
import {
  asksScheduleConflict,
  calendarPair,
  compareCalendarPair,
} from "../calendar/compare";
import { D1KeywordRetriever } from "../retrieval/retriever";
import type { SqlDatabase } from "./database";
import type { PersonalConflictTask } from "@/domain/agent/personal-task";
import {
  resolvePersonalConflict,
  scanPersonalConflicts,
} from "./personal-conflicts";

const escape = (text: string) => text.replace(/[\\`*_{}\[\]<>#|]/g, "\\$&");
const oneLine = (text: string) => escape(text.replace(/\s+/g, " ").trim());
const taskTitle = (title: string) => /^(报名|参加)\s*[：:]\s*/.exec(title);
const namedTask = (question: string) => {
  const quote = /[“「《"]([^”」》"]+)[”」》"]/.exec(question)?.[1];
  if (quote) return quote;
  return /(?:我的?(?:待办|代办)(?:里|中|的)*)(.+?)(?:这篇|那篇)?(?:有什么内容|有哪些内容|是什么内容|讲了什么|写了什么)[？?。！!]*$/
    .exec(question)?.[1]
    ?.trim();
};
const time = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

export function personalReadIntent(question: string) {
  const taskQuestion =
    /(?:我(?:的|今天|明天|这周|本周|下周)?|个人)(?:还有|都有|有|的)?(?:哪些|什么|多少)?(?:已逾期|逾期|已完成|待处理)?(?:待办|代办)|(?:待办|代办)(?:有哪些|有什么)/.test(
      question,
    );
  if (taskQuestion) return "tasks" as const;
  // 「替我收藏」「自动收藏」 is an instruction about saving, not a request to
  // read the saved list. Only an owned list counts as a read.
  if (/(?<!替|帮|给|为)我(?:的)?(?:收藏|已收藏|保存的)|收藏夹|收藏的/.test(question))
    return "favorites" as const;
}

export async function personalRead(
  db: SqlDatabase,
  userId: string | undefined,
  question: string,
  now = Date.now(),
  conflictTask?: PersonalConflictTask,
): Promise<
  | {
      text: string;
      cards: AssistantCard[];
      activeTask?: PersonalConflictTask;
      diagnostics?: Record<string, unknown>;
    }
  | undefined
> {
  const conflict =
    conflictTask ?? resolvePersonalConflict(question, undefined, now);
  const scope = conflict ? "tasks" : personalReadIntent(question);
  if (!scope) return;
  const answer = (text: string, cards: AssistantCard[] = []) => ({
    text,
    cards,
  });
  if (!userId)
    return {
      ...answer("请先登录，再查看自己的收藏和待办。"),
      ...(conflict
        ? {
            activeTask: {
              ...conflict,
              status: "awaiting_clarification" as const,
            },
            diagnostics: {
              resolvedIntent: conflict.intent,
              dataSource: "personal_todos",
              readStatus: "unauthenticated",
              retrievalStatus: "not_executed",
              taskStatus: "needs_auth",
              completionReason: "login_required",
            },
          }
        : {}),
    };
  if (conflict) {
    const tasks = await new PersonalTaskStore(db).list(userId, now);
    return { ...(await scanPersonalConflicts(db, tasks, conflict)), cards: [] };
  }
  const today = chinaDate(now);
  const week = weekOf(/下周/.test(question) ? addDays(today, 7) : today);
  const day = /明天/.test(question)
    ? addDays(today, 1)
    : /今天|今日/.test(question)
      ? today
      : undefined;
  if (scope === "tasks") {
    if (asksScheduleConflict(question)) {
      const names = calendarPair(question);
      if (!names) return answer("请告诉我要比较的两场活动名称。");
      const mine = await new PersonalTaskStore(db).list(userId, now);
      return answer(await compareCalendarPair(db, names, mine));
    }
    const name = namedTask(question);
    const titleKey = name ? articleTitleKey(name) : null;
    const state = /已完成/.test(question)
      ? "completed"
      : /逾期/.test(question)
        ? "overdue"
        : "pending";
    const tasks = (await new PersonalTaskStore(db).list(userId, now)).filter(
      (task) => {
        if (task.status !== state) return false;
        if (titleKey && !articleTitleKey(task.title).includes(titleKey))
          return false;
        const date = task.dueAt ? chinaDate(Date.parse(task.dueAt)) : null;
        if (day) return date === day;
        if (/这周|本周|下周/.test(question))
          return date !== null && week.includes(date);
        return true;
      },
    );
    if (!tasks.length)
      return answer(
        name
          ? `没有找到与「${oneLine(name)}」匹配的待办。`
          : "这个范围内没有待办。",
      );
    const priority =
      /先做|优先/.test(question) && state === "pending" && tasks[0].dueAt
        ? "第一项最早到期，建议先处理。\n\n"
        : "";
    const excerpts = new Map<string, string>();
    if (name && /内容|讲了什么|写了什么/.test(question)) {
      const ids = [
        ...new Set(
          tasks
            .slice(0, 5)
            .flatMap((task) =>
              task.source?.articleAvailable ? [task.source.articleId] : [],
            ),
        ),
      ];
      if (ids.length) {
        const { result } = await new D1KeywordRetriever(db).search({
          query: name.slice(0, 300),
          documentIds: ids,
          limit: 5,
        });
        for (const hit of result.hits)
          if (hit.evidenceType !== "metadata" && !excerpts.has(hit.documentId))
            excerpts.set(hit.documentId, hit.contentSnippet);
      }
    }
    return answer(
      priority +
        tasks
          .slice(0, 5)
          .map((task) => {
            const prefix = taskTitle(task.title);
            const title = oneLine(
              prefix ? task.title.slice(prefix[0].length) : task.title,
            );
            const url = task.source?.articleUrl;
            const heading = `${prefix ? `${prefix[1]}：` : ""}${url ? `[${title}](<${url}>)` : title}`;
            const excerpt = task.source && excerpts.get(task.source.articleId);
            return [
              `- ${heading}`,
              task.dueAt ? `  ⏱️逾期时间:${time(task.dueAt)}` : "",
              task.notes ? `  📝备注：${oneLine(task.notes)}` : "",
              excerpt ? `  ${oneLine(excerpt)}` : "",
              state === "completed"
                ? "  已完成"
                : state === "overdue"
                  ? "  已逾期"
                  : "",
            ]
              .filter(Boolean)
              .join("  \n");
          })
          .join("\n"),
    );
  }
  const rows = await db
    .prepare(
      "SELECT article_id FROM user_article_favorites WHERE user_id=? ORDER BY created_at_ms DESC,id DESC",
    )
    .bind(userId)
    .all<{ article_id: string }>();
  const ids = rows.results.map((row) => row.article_id);
  if (!ids.length) return answer("你还没有收藏文章。");
  if (
    /活动|讲座|宣讲|竞赛|冲突|报名/.test(question) &&
    (day || /这周|本周|下周|冲突|有哪些.*报名|还能报名/.test(question))
  ) {
    const { items } = await readCalendar(
      db,
      { after: day ?? week[0], before: day ?? week[6], limit: 50 },
      new Date(now).toISOString(),
      ids,
    );
    const registration = /还能报名|可以报名|能报名/.test(question);
    const events = items.filter(
      (item) =>
        (!registration || item.registrationState === "open") &&
        (!/宣讲/.test(question) ||
          /宣讲/.test(item.activity.title) ||
          item.sources.some((s) => /宣讲/.test(s.title))),
    );
    if (!events.length) return answer("这个范围内没有符合条件的收藏活动。");
    if (/冲突/.test(question)) {
      const known = events.filter(
        (e) => e.activity.startsAt?.at && e.activity.endsAt?.at,
      );
      const overlaps = known.flatMap((event, index) =>
        known
          .slice(index + 1)
          .filter(
            (other) =>
              Date.parse(event.activity.startsAt!.at!) <
                Date.parse(other.activity.endsAt!.at!) &&
              Date.parse(other.activity.startsAt!.at!) <
                Date.parse(event.activity.endsAt!.at!),
          )
          .map(
            (other) =>
              `- [${escape(event.activity.title)}](${event.calendarUrl}) 和 [${escape(other.activity.title)}](${other.calendarUrl}) 时间重叠。`,
          ),
      );
      return answer(
        [
          overlaps.length
            ? overlaps.join("\n")
            : "有完整起止时间的活动之间未发现重叠。",
          known.length < events.length
            ? "部分活动缺少完整起止时间，无法判断是否冲突。"
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }
    return answer(
      events
        .slice(0, 15)
        .map((event) => {
          const start = event.activity.startsAt;
          const deadlines = [
            ...new Set(
              event.activity.registrationWindows.flatMap((window) =>
                registration &&
                ((window.start?.at && Date.parse(window.start.at) > now) ||
                  (window.start?.date && window.start.date > today) ||
                  (window.end?.at && Date.parse(window.end.at) < now) ||
                  (window.end?.date && window.end.date < today))
                  ? []
                  : window.end?.at
                    ? [time(window.end.at)]
                    : window.end?.date
                      ? [window.end.date]
                      : [],
              ),
            ),
          ];
          return `- [${escape(event.activity.title)}](${event.calendarUrl}) · ${start?.at ? time(start.at) : (start?.date ?? "")}${deadlines.length ? ` · 报名截止 ${deadlines.join("、")}` : ""}`;
        })
        .join("\n"),
    );
  }
  const query =
    question
      .replace(
        /我(?:的收藏|收藏|已收藏|保存的)(?:的|里|中)?|收藏夹|收藏的/g,
        "",
      )
      .replace(
        /(?:这篇|那篇)(?:文章|通知|公告)?(?:主要)?(?:讲了什么|写了什么|有些什么内容|有哪些内容|有什么内容)?[？?。！!]*$/,
        "",
      )
      .trim() || "最近";
  const retriever = new D1KeywordRetriever(db);
  const hits = [];
  const materials = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 80) {
    const { result, articles } = await retriever.search({
      query: query.slice(0, 300),
      documentIds: ids.slice(i, i + 80),
      limit: 4,
    });
    hits.push(...result.hits);
    if (/材料/.test(question))
      for (const { hit, analysis } of articles) {
        const entries =
          analysis?.knowledge.materials.map((item) => item.text) ?? [];
        if (entries.length)
          materials.set(hit.documentId, [...new Set(entries)]);
      }
  }
  const seen = new Set<string>();
  const selected = hits
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .filter((hit) => {
      if (seen.has(hit.documentId)) return false;
      seen.add(hit.documentId);
      return true;
    })
    .slice(0, 4);
  const materialSources = selected.filter((hit) =>
    materials.has(hit.documentId),
  );
  if (materialSources.length)
    selected.splice(0, selected.length, ...materialSources);
  if (!selected.length) {
    const key = articleTitleKey(query);
    if (key.length >= 4) {
      const store = new ArticleFavoriteStore(db);
      for (let page = 1; ; page++) {
        const result = await store.list(userId, { page, limit: 50 });
        const match = result.items.find(
          (item) => item.available && articleTitleKey(item.title).includes(key),
        );
        if (match)
          return answer(
            `我在你的收藏里找到了《${escape(match.title)}》。可以点下方来源查看正文。`,
            [
              {
                kind: "source",
                documentId: match.articleId,
                title: match.title.slice(0, 250),
                sourceName: match.sourceName.slice(0, 250),
                originalUrl: match.url,
                publishedAt: match.publishedAt,
                snippet: "",
                evidenceType: "metadata",
                classificationState: "unknown",
                validity: "unknown",
                readable: match.readable,
              },
            ],
          );
        if (!result.hasMore) break;
      }
    }
    return answer("在你的收藏里没有找到相关的可引用内容。");
  }
  const cards: AssistantCard[] = selected.map((hit) => ({
    kind: "source",
    documentId: hit.documentId,
    title: hit.title,
    sourceName: hit.sourceName,
    originalUrl: hit.originalUrl,
    publishedAt: hit.publishedAt,
    snippet: hit.contentSnippet,
    evidenceType: hit.evidenceType,
    classificationState: hit.classificationState,
    validity: hit.validity,
    readable: hit.readable,
  }));
  return answer(
    selected
      .map(
        (hit, i) =>
          `- **${escape(hit.title)}** [${i + 1}]\n  ${(materials.get(hit.documentId) ?? [hit.contentSnippet]).map(escape).join("\n  ")}`,
      )
      .join("\n"),
    cards,
  );
}
