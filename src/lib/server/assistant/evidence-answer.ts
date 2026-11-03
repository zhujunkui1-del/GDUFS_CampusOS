import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { containsToolProtocol } from "@/lib/assistant-output";
import { matchesQueryFocus } from "@/lib/retrieval/query-focus";
import { chinaDay } from "./time-window";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import type { ContentSearchResult } from "@/domain/retrieval/skills";

/** Listing asks for known items, not an invented narrative or inferred availability. */
export function eventEvidenceAnswer(
  cards: AssistantCard[],
  results: ContentSearchResult[],
) {
  const sources = cards.flatMap((card, index) =>
    card.kind === "source" ? [{ card, citation: index + 1 }] : [],
  );
  if (!sources.length) return undefined;
  return sources
    .slice(0, 5)
    .map(({ card, citation }, index) => {
      const activity = results
        .flatMap((r) => r.activities)
        .find((a) => a.documentId === card.documentId);
      const details: string[] = [];
      if (activity?.startsAt?.date) {
        const start = activity.startsAt;
        const end = activity.endsAt;
        const clock = (at: string) =>
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).format(new Date(at));
        details.push(
          `举办：${start.date}${start.at ? " " + clock(start.at) : ""}${end?.date && end.date !== start.date ? " 至 " + end.date : ""}${end?.at ? "—" + clock(end.at) : ""}`,
        );
      }
      if (activity?.placeRaw) details.push(`地点：${activity.placeRaw}`);
      const registration = {
        open: "报名中",
        not_started: "报名未开始",
        closed: "报名已截止",
        not_required: "无需报名",
        capacity_unknown: "额满即止，余量未确认",
        unknown: "",
      }[activity?.registrationState || "unknown"];
      if (registration) details.push(registration);
      if (!details.length && card.publishedAt)
        details.push(`发布：${chinaDay(card.publishedAt)}`);
      return `${index + 1}. **${card.title}** [${citation}]${details.length ? "\n   " + details.join(" · ") : ""}`;
    })
    .join("\n\n");
}

/** A provider failure does not erase already-retrieved public evidence. No invented summary. */
export function foodEvidenceAnswer(
  cards: AssistantCard[],
  question: string,
  playful: boolean,
) {
  // This fallback is for ordinary dining discovery, not medical/dietary safety advice.
  if (/过敏|中毒|糖尿病|高血压|疾病|孕|医疗|服药|忌口/.test(question))
    return undefined;
  const candidates = cards
    .flatMap((card, index) => {
      if (card.kind !== "source" && card.kind !== "external_source") return [];
      if (
        !matchesQueryFocus("food", card, question) ||
        containsToolProtocol(card.snippet)
      )
        return [];
      if (
        (card.kind === "source" && card.evidenceType === "metadata") ||
        (card.kind === "external_source" &&
          card.evidenceKind !== "page_excerpt")
      )
        return [];
      const lines = card.snippet
        .split(/[\n。]+/)
        .map((line) =>
          line
            .replace(/#.*$/g, "")
            .replace(/\[[^\]]{1,20}R\]/g, "")
            .trim(),
        )
        .filter((line) =>
          /食|饭|菜|餐|粉|面|肉|锅|元|文采|博雅|风采/.test(line),
        );
      const quote = lines.join("；").slice(0, 130);
      if (!quote) return [];
      const score =
        Number(card.kind === "external_source") * 10 +
        Number(
          /一饭|第一食堂|文采园/.test(question) &&
            /一饭|文采园/.test(card.title + card.snippet),
        ) *
          4;
      return [{ card, quote, number: index + 1, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (!candidates.length) return undefined;
  return (
    (playful ? "本鱼翻到这些，先给你看：\n" : "可核对的信息：\n") +
    candidates
      .map(
        ({ card, quote, number }) =>
          `- ${card.publishedAt ? chinaDay(card.publishedAt) || "日期未注明" : "日期未注明"}：“${quote}${quote.length === 130 ? "…" : ""}”[${number}]`,
      )
      .join("\n") +
    "\n以上为原文片段，当前菜品供应以现场为准。"
  );
}
/** Roster questions use one deterministic extractive path, so the same question
 * never alternates between a generated list and a paragraph excerpt. */
const SURNAMES =
  "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";
const NOT_A_NAME = new Set([
  "安家费",
  "高学历",
  "编辑",
  "教授",
  "学者",
  "学院",
  "大学",
  "名单",
  "研究",
  "中心",
  "方向",
  "团队",
  "项目",
  "岗位",
  "条件",
  "待遇",
  "招聘",
  "应聘",
  "材料",
  "时间",
  "地点",
  "电话",
  "邮箱",
  "简介",
  "课程",
  "专业",
  "招生",
  "培养",
  "人才",
  "基地",
  "实验",
  "办公",
  "师资",
  "队伍",
]);
const BAD_NAME_END = /[费历辑院学者授师生员部处室馆场楼门局委办]$/;
const RECRUIT_TITLE = /招聘|诚聘|招贤|招生|简章|启事|公告|通知/;
export function rosterEvidenceAnswer(cards: AssistantCard[], playful = false) {
  const names: { name: string; source: number }[] = [];
  const seen = new Set<string>();

  cards.forEach((card, index) => {
    if (card.kind !== "source" && card.kind !== "external_source") return;
    // Recruitment pages mix benefit terms into name-like runs; they are not rosters.
    if (RECRUIT_TITLE.test(card.title)) return;
    const text = card.title + "\n" + card.snippet;
    // Roster pages list one name per bullet; pages in prose use 、-separated runs.
    const bullets = [
      ...text.matchAll(/^[\s>*+\-•]*([\u4e00-\u9fa5]{2,3})\s*$/gm),
    ].map((match) => match[1]);
    const runs = [
      ...text.matchAll(
        /([\u4e00-\u9fa5]{2,4}(?:[、，,；;\s]+[\u4e00-\u9fa5]{2,4}){2,})/g,
      ),
    ].flatMap((run) => run[1].split(/[、，,；;\s]+/));
    for (const name of [...bullets, ...runs]) {
      if (!/^[\u4e00-\u9fa5]{2,3}$/.test(name)) continue;
      if (!SURNAMES.includes(name[0])) continue;
      if (NOT_A_NAME.has(name) || BAD_NAME_END.test(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      names.push({ name, source: index + 1 });
    }
  });
  if (names.length < 3) return undefined;
  const list = names.slice(0, 24);
  return (
    (playful ? "本鱼按原文名单页整理，去重后是这些：" : "按原文名单页整理：") +
    "\n" +
    list.map((item, i) => `${i + 1}. ${item.name}[${item.source}]`).join("\n")
  );
}

export function retrievedEvidenceAnswer(
  cards: AssistantCard[],
  question: string,
  officialOnly: boolean,
  officialDocumentIds: Set<string>,
  playful = false,
) {
  const plan = buildQueryPlan(question);
  const currentOpportunity = ["participation", "registration"].includes(
    plan.goal,
  );
  const today = chinaDay(Date.now())!;
  const directGuide = (c: AssistantCard) =>
    plan.goal === "procedure" &&
    (c.kind === "source" || c.kind === "external_source") &&
    /指南|流程|操作|步骤/.test(c.title);
  const canAttribute = (c: AssistantCard) =>
    directGuide(c) &&
    c.kind === "source" &&
    c.evidenceType === "full_text" &&
    c.readable &&
    !/只(?:查|看|用|要).{0,8}官方|仅(?:查|看|用).{0,8}官方/.test(question);
  const candidates = cards
    .map((c, index) => ({ c, index }))
    .sort(
      (a, b) =>
        Number(directGuide(b.c)) - Number(directGuide(a.c)) ||
        (["participation", "registration", "discovery"].includes(plan.goal)
          ? Number(b.c.kind === "external_source") -
            Number(a.c.kind === "external_source")
          : 0),
    )
    .flatMap(({ c, index }) => {
      if (c.kind !== "source" && c.kind !== "external_source") return [];
      if (!queryRelevance(plan, c).relevant || containsToolProtocol(c.snippet))
        return [];
      if (
        c.kind === "source" &&
        (c.evidenceType === "metadata" ||
          (officialOnly && !officialDocumentIds.has(c.documentId)))
      )
        if (c.evidenceType === "metadata" || !canAttribute(c)) return [];
      if (
        c.kind === "external_source" &&
        (c.evidenceKind === "title_only" ||
          (officialOnly && c.authority !== "official"))
      )
        return [];
      const normalized = c.snippet.replace(/\s+/g, " ").trim();
      const attribution =
        c.kind === "source" &&
        !officialDocumentIds.has(c.documentId) &&
        canAttribute(c)
          ? "（公开指南，官方身份及现行效力待确认）"
          : "";
      const anchor = currentOpportunity
        ? normalized.search(/定于|将于|(?:比赛|活动|讲座)(?:举办)?时间[：:]?/)
        : -1;
      const start = anchor >= 0 ? Math.max(0, anchor - 5) : 0;
      const quote = normalized.slice(start, start + 160);
      const dates = [
        ...normalized.matchAll(
          /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})(?:\s*[—至-]\s*\d{1,2})?\s*日/g,
        ),
      ].filter((m) =>
        /定于|将于|时间/.test(
          normalized.slice(Math.max(0, m.index! - 20), m.index),
        ),
      );
      const future =
        currentOpportunity &&
        dates.some(
          (m) =>
            `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` >=
            today,
        );
      return quote
        ? [
            {
              future,
              text: `- ${c.title}${attribution}： “${quote}${quote.length === 160 ? "…" : ""}”[${index + 1}]`,
            },
          ]
        : [];
    });
  const excerpts = candidates
    .filter(
      (c) =>
        !currentOpportunity || !candidates.some((c) => c.future) || c.future,
    )
    .slice(0, 3)
    .map((c) => c.text);
  if (!excerpts.length) return undefined;
  const boundary = ["participation", "registration", "discovery"].includes(
    plan.goal,
  )
    ? "具体日期、报名和资格按原文核对，没写到的别当成已经开放。"
    : "原文没写的条件不补，政策是否仍有效也要再核。";
  return (
    (playful ? "本鱼翻到这些，给你划个重点：\n" : "可核对的信息：\n") +
    excerpts.join("\n") +
    "\n" +
    boundary
  );
}

/**
 * Merge articles that cover the same activity. Different outlets describe one
 * event with different headlines ("第29届秋之声…歌手大赛" vs "秋之声歌唱比赛"),
 * so an exact title comparison is not enough. Strip venue/edition/format words
 * and quoted sub-titles, then keep the first (newest) card for each signature.
 */
export function activitySignature(title: string) {
  const normalized = title
    .replace(/[【\[][^】\]]*[】\]]/g, " ")
    .replace(/[“"][^”"]*[”"]/g, " ")
    .replace(/第[一二三四五六七八九十百\d]+届/g, " ")
    .replace(/最佳人气奖评选|人气奖|投票|预告|报名|招募|圆满|收官|开唱/g, " ")
    .replace(/专属|Livehouse|livehouse/gi, " ")
    .replace(/广外|广东外语外贸大学|校园|大学城|白云山/g, " ")
    .replace(/[一-龥]{1,10}学院/g, " ")
    .replace(
      /歌唱|歌手|大赛|比赛|决赛|初赛|复赛|活动|晚会|演出|展览|展演/g,
      " ",
    )
    .replace(/[^一-龥A-Za-z0-9]+/g, "")
    .replace(/^的/, "")
    .trim();
  return normalized.length >= 3 ? normalized.slice(0, 12) : "";
}

// Containment core keeps the activity type while dropping branding/campus
// prefixes, so a broad headline still matches a longer branded one.
export function activityCore(title: string) {
  return title
    .replace(/[【\[（(][^】\]）)]*[】\]）)]/g, " ")
    .replace(/[“"][^”"]*[”"]/g, " ")
    .replace(/第[一二三四五六七八九十百\d]+届/g, " ")
    .replace(
      /最佳人气奖评选|人气奖|投票|预告|报名|招募|圆满|收官|开唱|举行|举办|落幕/g,
      " ",
    )
    .replace(
      /广外的?|广东外语外贸大学|专属|Livehouse|livehouse|大学城|白云山/g,
      " ",
    )
    .replace(/[一-龥]{1,10}学院/g, " ")
    .replace(/[^一-龥A-Za-z0-9]+/g, "")
    .replace(/^的|的$/g, "")
    .trim();
}

export function recentRadarAnswer(cards: AssistantCard[], label = "校园资讯") {
  const rows = cards
    .flatMap((card, citationIndex) => {
      if (card.kind !== "source" && card.kind !== "external_source") return [];
      if (!card.publishedAt || !card.title) return [];
      // Category landing pages are navigation, not a dated activity.
      if (
        /^(?:文体活动|竞赛|讲座|升学就业|学术科研|奖学金|校园通知)-/.test(
          card.title,
        )
      )
        return [];
      return [
        {
          title: card.title,
          publishedAt: card.publishedAt,
          citation: citationIndex + 1,
        },
      ];
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((row, index, all) => {
      if (all.findIndex((other) => other.title === row.title) !== index)
        return false;
      const signature = activitySignature(row.title);
      const core = activityCore(row.title);
      if (!signature && core.length < 4) return true;
      return (
        all.findIndex((other) => {
          if (signature && activitySignature(other.title) === signature)
            return true;
          const otherCore = activityCore(other.title);
          return (
            core.length >= 4 &&
            otherCore.length >= 4 &&
            (core.includes(otherCore) || otherCore.includes(core))
          );
        }) === index
      );
    })
    .slice(0, 5);
  if (rows.length < 3) return undefined;
  return [
    `最近广外${label}，按发布时间从新到旧：`,
    "",
    ...rows.map(
      (row, index) =>
        `${index + 1}. ${row.publishedAt.slice(0, 10)} 发布｜${row.title} [${row.citation}]`,
    ),
    "",
  ].join("\n");
}
