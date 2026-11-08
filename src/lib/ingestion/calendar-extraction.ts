import { parseHTML } from "linkedom";
import {
  CALENDAR_VERSION,
  type CalendarSource,
  type CalendarProposal,
} from "@/domain/calendar/extraction";
import type {
  ArticleActivitySchema,
  ArticleAnalysis,
  ArticleAnalysisInput,
  ArticleEvidence,
  ArticleTimePoint,
} from "@/domain/console/article-analysis";
import type { z } from "zod";
import { articleText, evidence, type ArticleText } from "./article-text";
import { normalizeArticleTime } from "./article-times";
type Activity = z.infer<typeof ArticleActivitySchema>;
type Source = {
  id: string;
  kind: "body" | "title" | CalendarSource["kind"];
  text: string;
  url: string;
  locator: string;
  method: string;
  digest: string;
};
const eventWords =
  /讲座|讲坛|论坛|研讨会|报告会|招聘会|宣讲会|比赛|竞赛|运动会|读书会|音乐会|演出|展览|开放日|体验日|选拔赛|决赛|复赛|挑战杯|工作坊|分享会|交流会|颁奖典礼|学术沙龙|活动预告|活动报名|讲堂|Workshop|Seminar|Lecture/i;
const confirmedValue = (v: string | null) =>
  v &&
  /^(?:待定|未知|暂无|未定|另行通知|详见后续|待通知|TBD|to be announced)/i.test(
    v.trim(),
  )
    ? null
    : v;
const eventRole =
  /(?:讲座|讲坛|讲堂|沙龙|活动|比赛|竞赛|会议|演出|论坛|考试|复赛|决赛|开幕|报告会|报告)(?:举办)?(?:时\s*间|日期)|举办时间|开始时间|结束时间|定于|将于|将在|举行|举办|开讲|开幕|(?:^|\n)时\s*间[：:]/g;
const otherRole =
  /报名|申请截止|申报截止|提交截止|材料提交|作品提交|缴费|公示|获奖|发布时间|发布日期|发布于|稿件|成绩公布/g;
const dateRe =
  /(?:20\d{2}[年./-]\s*)?\d{1,2}(?:月|[./-])\s*\d{1,2}[日号]?(?:\s*[（(](?:周|星期)[一二三四五六日天][）)]?)?(?:\s*(?:上午|下午|晚上|晚|中午|凌晨)?\s*(?:\d{1,2}[:：]\d{2}(?:[:：]\d{2})?|[一二两三四五六七八九十\d]{1,3}点(?:半|[一二三四五六七八九十\d]{1,3}分)?))?|(?<=[至到—–~～、或-])\s*\d{1,2}日(?:\s*\d{1,2}[:：]\d{2})?|(?<=[至到—–~～-])\s*\d{1,2}[:：]\d{2}/g;
export const calendarDates = (text: string) => [
  ...text.matchAll(new RegExp(dateRe.source, "g")),
];
function chineseNumber(s: string) {
  if (/^\d+$/.test(s)) return +s;
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0);
  }
  return digits[s] ?? NaN;
}
function clock(raw: string) {
  return raw
    .replace(/[（(](?:周|星期)[一二三四五六日天][）)]?/g, "")
    .replace(
      /([一二两三四五六七八九十\d]{1,3})点(半|[一二三四五六七八九十\d]{1,3}分)?/g,
      (_, h: string, m: string) =>
        `${chineseNumber(h)}:${String(m === "半" ? 30 : m ? chineseNumber(m.slice(0, -1)) : 0).padStart(2, "0")}`,
    )
    .replace(/号/g, "日");
}
function asText(s: Source, title: string): ArticleText {
  return {
    title,
    text: s.text,
    paragraphs: [],
    links: [],
    bodyAvailable: true,
  };
}
function ev(
  s: Source,
  title: string,
  start: number,
  end: number,
  role: string,
): ArticleEvidence {
  const e = evidence(asText(s, title), "body", start, end, role);
  if (s.kind === "title") e.field = "title";
  if (s.id !== "body" && s.id !== "title") e.sourceId = s.id;
  return e;
}
function years(title: string, near: string) {
  // A cohort name such as "2027届毕业生" / "2027校招" / "2027年招生" names
  // the intake, not the event. Stamping that year onto every bare body date
  // produced phantom events a full year past the publication date.
  const cohort =
    /(?:20\d{2})[^。；\n]{0,14}(?:届|级|校招|校园招聘|招聘|招生|推免|保研|考研|毕业|入学|新生|批次|报考|考试|考核|转段|专升本)/;
  const all = [...title.matchAll(/\b(20\d{2})年?/g)]
    .filter((m) => {
      const at = m.index ?? 0;
      return !cohort.test(title.slice(at, at + m[0].length + 12));
    })
    .map((m) => +m[1]);
  if (all.length && new Set(all).size === 1)
    return { year: all[0], basis: "活动标题明确标注年份" };
  const lines = near
    .split(/\n/)
    .filter((l) => !/发布|编辑|来源|版权|Copyright/i.test(l));
  const found = lines
    .join(" ")
    .match(/(20\d{2})年[^。\n]{0,50}(?:活动|讲座|比赛|论坛|学期|学年)/);
  return found
    ? { year: +found[1], basis: "同一活动上下文明确标注年份" }
    : undefined;
}
function point(
  s: Source,
  title: string,
  m: RegExpMatchArray,
  offset: number,
  year: ReturnType<typeof years>,
  previous?: ArticleTimePoint,
) {
  const raw = m[0].trim(),
    start = offset + m.index! + m[0].indexOf(raw);
  const p = normalizeArticleTime(
    clock(raw),
    { text: raw, start, end: start + raw.length },
    asText(s, title),
    null,
    previous,
    year,
  );
  return {
    ...p,
    raw,
    evidence: ev(s, title, start, start + raw.length, "event_time"),
  };
}
function nature(
  title: string,
  body: string,
): NonNullable<Activity["calendar"]>["nature"] {
  if (/获奖|斩获|获评|荣获|喜报/.test(title)) return "award";
  if (/回顾|圆满|落幕|纪实|成功举办/.test(title)) return "recap";
  if (
    /(?:举行|举办|开展|召开)了|(?:顺利|成功|圆满)(?:开讲|举行|举办|开展|召开)|已(?:举行|举办)|日前.{0,20}(?:举行|举办)/.test(
      body,
    )
  )
    return "held";
  if (/报名|招募|招新/.test(title)) return "recruitment";
  if (
    eventWords.test(title) ||
    /将于|定于|将在/.test(body) ||
    /(?:比赛|活动|讲座|会议|报告)(?:举办)?时间/.test(body)
  )
    return "announcement";
  return "uncertain";
}
function campus(place: string | null) {
  return /线上|腾讯会议|Zoom|直播/i.test(place || "")
    ? ("online" as const)
    : /大学城|南校/.test(place || "") && !/白云|北校/.test(place || "")
      ? ("university_town" as const)
      : /白云|北校/.test(place || "") && !/大学城|南校/.test(place || "")
        ? ("baiyun" as const)
        : ("unknown" as const);
}
function category(title: string, base: ArticleAnalysis) {
  return /讲座|讲堂|讲坛|报告会|沙龙|Lecture/i.test(title)
    ? ("lecture" as const)
    : /招聘|宣讲|双选会/.test(title)
      ? ("education_career" as const)
      : /体育|篮球|足球|羽毛球|运动会|演出|音乐|文艺|展览|读书/.test(title)
        ? ("culture_sports" as const)
        : /比赛|竞赛|大赛/.test(title)
          ? ("competition" as const)
          : /论坛|研讨|学术|Workshop|Seminar/i.test(title)
            ? ("academic_research" as const)
            : base.radarCategory;
}
export function calendarInput(
  input: ArticleAnalysisInput,
): ArticleAnalysisInput {
  const added: CalendarSource[] = [];
  if (
    input.bodyFormat === "reading_html" &&
    input.bodyStatus !== "not_provided" &&
    input.body
  ) {
    const { document } = parseHTML(input.body);
    for (const [i, table] of [...document.querySelectorAll("table")]
      .slice(0, 2)
      .entries()) {
      const rows = [...table.querySelectorAll("tr")]
        .map((r) =>
          [...r.querySelectorAll("td,th")]
            .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
            .join(" | "),
        )
        .filter(Boolean);
      const text = rows.join("\n").slice(0, 20000);
      if (text)
        added.push({
          id: `table-${i + 1}`,
          kind: "table",
          url: input.originalUrl || "https://invalid.local/",
          locator: `table[${i + 1}]`,
          digest: "derived-from-current-body",
          text,
          method: "html-table",
        });
    }
  }
  return {
    ...input,
    calendarSources: [
      ...new Map(
        [...(input.calendarSources || []), ...added]
          // Early OCR relabelled captions and could mistake a source logo for an organiser.
          .filter((s) => !/^@cf\/.*-ocr$/.test(s.method))
          .map((s) => [s.id, s]),
      ).values(),
    ].slice(0, 4),
  };
}
function blocks(
  s: Source,
  title: string,
): { title: string; start: number; end: number; root?: boolean }[] {
  const h = [
    ...s.text.matchAll(
      /(?:^|\n)(?:活动名称|讲座题目|活动主题|(?:\d+[.、]|[一二三四五六七八九十]、)\s*(?:讲座|活动|比赛))[：:]\s*([^\n]{1,120})/g,
    ),
  ];
  if (!h.length) {
    const phases = [
      ...s.text.matchAll(
        /(?:^|\n)(开幕式|闭幕式|初赛|复赛|决赛)(?:(?:时间|日期)[：:]?|[：:]|(?=\n|$))/g,
      ),
    ];
    const rounds = [
      ...s.text.matchAll(/(?:^|\n)(第[一二三四五六七八九十\d]+场)[：:]?/g),
    ];
    const split = phases.length ? phases : rounds.length > 1 ? rounds : [];
    if (split.length)
      return [
        { title, start: 0, end: s.text.length, root: true },
        ...split.slice(0, 11).map((m, i) => {
          const next = split[i + 1]?.index ?? s.text.length;
          const rest = s.text.slice(m.index! + m[0].length, next);
          const boundary = rest.match(
            /\n(?:\s*\d{1,2}[.、]?\s*)?(?:活动赛制|活动时间|举办时间|报名方式|提交要求|咨询方式|参赛材料)(?:[：:]|\n|$)/,
          );
          return {
            title: `${title} · ${m[1]}`,
            start: m.index!,
            end:
              boundary?.index !== undefined
                ? m.index! + m[0].length + boundary.index
                : next,
          };
        }),
      ].filter((b) => b.end > b.start);
  }
  return h.length
    ? h.slice(0, 12).map((m, i) => ({
        title: m[1].trim(),
        start: m.index!,
        end: h[i + 1]?.index ?? s.text.length,
      }))
    : [{ title, start: 0, end: s.text.length }];
}
type Candidate = {
  scope?: string;
  specificity?: number;
  title: string;
  source: Source;
  start: ArticleTimePoint;
  end: ArticleTimePoint | null;
  quote: ArticleEvidence;
  place: string | null;
  organizer: string | null;
  nature: NonNullable<Activity["calendar"]>["nature"];
};
function candidates(s: Source, title: string): Candidate[] {
  const output: Candidate[] = [];
  const sections = blocks(s, title);
  for (const b of sections) {
    const body = s.text.slice(b.start, b.end),
      type = nature(b.title, body);
    if (
      type === "award" ||
      type === "uncertain" ||
      (!eventWords.test(b.title) &&
        !eventWords.test(body) &&
        !/(?:活动|讲座|会议|举办|报告)(?:举办)?时间[：:]/.test(body)) ||
      /每周|每月|每逢/.test(body)
    )
      continue;
    let carry = "";
    for (const m of body.matchAll(/[^\n。；;]+/g)) {
      const p = m[0],
        absolute = b.start + m.index!,
        hasDate = calendarDates(p).length > 0;
      const previous = carry;
      carry = p.trim().length < 50 ? p : "";
      if (!hasDate) continue;
      if (/暂定|待定|预计|另行通知/.test(p)) continue;
      const combined = previous + " " + p;
      if (/原定/.test(p) && !/改为|调整至|延期至/.test(p)) continue;
      let pp: ArticleTimePoint | undefined;
      const valid: { p: ArticleTimePoint; at: number; end: number }[] = [];
      for (const d of calendarDates(p)) {
        if (
          b.root &&
          sections.some(
            (other) =>
              !other.root &&
              absolute + d.index! >= other.start &&
              absolute + d.index! < other.end,
          )
        )
          continue;
        const prefix = p.slice(0, d.index),
          tail = p.slice(d.index! + d[0].length);
        if (
          /^\s*(?:之前|以前|前)?(?:开始|进行)?(?:报到|签到|发出|发送|截止|截稿|公示|公布|提交|递交|缴费|离会)/.test(
            tail,
          )
        )
          continue;
        const last = (re: RegExp) =>
          [...prefix.matchAll(new RegExp(re.source, "g"))].at(-1)?.index ?? -1;
        const role = last(eventRole),
          other = last(otherRole);
        const rescheduled = /原定/.test(p) && /改为|调整至|延期至/.test(prefix);
        if (other > role && !rescheduled) continue;
        if (/原定/.test(prefix) && !rescheduled) continue;
        const eventContext =
          s.kind === "title" ||
          (s.kind === "image" &&
            calendarDates(s.text).length === 1 &&
            eventWords.test(title + s.text) &&
            other < 0) ||
          role >= 0 ||
          new RegExp(eventRole.source).test(previous) ||
          /(?:讲座|比赛|活动|论坛|报告会|演出).{0,35}(?:将于|定于|举行|举办)/.test(
            combined,
          ) ||
          (/举行|举办|开讲|召开/.test(tail) && other < 0);
        if (!eventContext) continue;
        const t = point(
          s,
          b.title,
          d,
          absolute,
          years(b.title, body.slice(Math.max(0, m.index! - 180), m.index!)),
          pp,
        );
        pp = t;
        if (t.date)
          valid.push({ p: t, at: d.index!, end: d.index! + d[0].length });
      }
      if (!valid.length) continue;
      // The paragraph may hold a truncated label ("会议地点：广外") while
      // the full venue sits in the body, so keep whichever is longer.
      const place =
        [placeOf(p), placeOf(body)]
          .filter((v): v is string => !!v)
          .sort((a, b) => b.length - a.length)[0] ?? null;
      const organizer =
        body.match(/(?:主办单位|主办方)[：:]\s*([^，。；\n]{1,100})/)?.[1] ||
        body.match(/由([^，。；\n]{2,80})主办/)?.[1] ||
        null;
      if (/报到|离会/.test(p))
        for (const phase of p.matchAll(
          /(\d{1,2})日(?=正式会议|会议|开会|论坛)/g,
        )) {
          const fake = Object.assign([phase[1] + "日"], { index: phase.index });
          const t = point(
            s,
            b.title,
            fake as unknown as RegExpMatchArray,
            absolute,
            undefined,
            valid[0].p,
          );
          if (t.date)
            output.push({
              specificity: 2,
              scope:
                sections.length > 1 && !b.root ? String(b.start) : undefined,
              title: b.title,
              source: s,
              start: t,
              end: null,
              quote: ev(
                s,
                title,
                absolute,
                Math.min(absolute + p.length, absolute + 900),
                "event_time",
              ),
              place,
              organizer,
              nature: type,
            });
        }
      for (let i = 0; i < valid.length; i++) {
        const first = valid[i],
          next = valid[i + 1];
        const between = next ? p.slice(first.end, next.at) : "";
        const range = !!next && /^\s*(?:至|到|—|–|~|～|-)\s*$/.test(between);
        output.push({
          scope: sections.length > 1 && !b.root ? String(b.start) : undefined,
          title: b.title,
          source: s,
          start: first.p,
          end: range ? next.p : null,
          quote: ev(
            s,
            title,
            absolute,
            Math.min(absolute + p.length, absolute + 900),
            "event_time",
          ),
          place: confirmedValue(place?.trim() || null),
          organizer: confirmedValue(organizer?.trim() || null),
          nature: type,
        });
        if (range) i++;
      }
    }
  }
  return output;
}
function proposalCandidates(
  sources: Source[],
  input: ArticleAnalysisInput,
  proposal?: CalendarProposal,
) {
  const out: Candidate[] = [];
  for (const original of proposal?.events || []) {
    const e = { ...original, dates: [...new Set(original.dates)] };
    const s = sources.find((s) => s.id === e.sourceId);
    if (
      !s ||
      e.nature === "uncertain" ||
      !s.text.includes(e.occurrenceQuote) ||
      (!s.text.includes(e.title) && !input.title.includes(e.title))
    )
      continue;
    let at = s.text.indexOf(e.occurrenceQuote),
      end = at + e.occurrenceQuote.length;
    let spansValid = true;
    for (const raw of e.dates) {
      const matches = [
        ...s.text.matchAll(
          new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        ),
      ];
      if (!matches.length) {
        spansValid = false;
        break;
      }
      const nearest = matches.sort(
        (a, b) => Math.abs(a.index! - at) - Math.abs(b.index! - at),
      )[0];
      at = Math.min(at, nearest.index!);
      end = Math.max(end, nearest.index! + raw.length);
    }
    if (!spansValid || end - at > 1000) continue;
    e.occurrenceQuote = s.text.slice(at, end);
    if (
      /报名|截止|提交|发布|公示|获奖/.test(e.occurrenceQuote) &&
      !new RegExp(eventRole.source).test(e.occurrenceQuote)
    )
      continue;
    let previous: ArticleTimePoint | undefined;
    const pp = e.dates
      .map((raw) => {
        const offset = e.occurrenceQuote.indexOf(raw);
        if (offset < 0) return null;
        const surrounding = s.text.slice(
          Math.max(0, at + offset - 180),
          at + offset,
        );
        const lastRole = (re: RegExp) =>
          [...surrounding.matchAll(new RegExp(re.source, "g"))].at(-1)?.index ??
          -1;
        if (lastRole(otherRole) > lastRole(eventRole)) return null;
        const match = calendarDates(raw)[0];
        if (!match || match[0].trim() !== raw.trim()) return null;
        const p = point(
          s,
          e.title,
          match,
          at + offset,
          years(input.title, e.occurrenceQuote),
          previous,
        );
        previous = p;
        return p;
      })
      .filter((p): p is ArticleTimePoint => !!p?.date);
    if (!pp.length) continue;
    if (
      (e.place && !s.text.includes(e.place)) ||
      (e.organizer && !s.text.includes(e.organizer))
    )
      continue;
    const context = (value: string | null) => {
      const i = value ? s.text.indexOf(value) : -1;
      return {
        before:
          i >= 0
            ? s.text.slice(Math.max(0, i - 22), i).replace(/[*_]/g, "")
            : "",
        after:
          i >= 0 ? s.text.slice(i + value!.length, i + value!.length + 16) : "",
      };
    };
    const pc = context(e.place),
      oc = context(e.organizer);
    const verifiedPlace =
      /(?:地点|地址|会场|场地)[：:\s]*$/.test(pc.before) ||
      (/在\s*$/.test(pc.before) && /举行|举办|开讲/.test(pc.after))
        ? e.place
        : null;
    const verifiedOrganizer =
      /(?:主办单位|主办方|主办)[：:\s]*$/.test(oc.before) ||
      (/由\s*$/.test(oc.before) && /主办/.test(oc.after))
        ? e.organizer
        : null;
    const range = pp.length === 2 && /至|—|–|～/.test(e.occurrenceQuote);
    for (let i = 0; i < pp.length; i++) {
      out.push({
        scope:
          (proposal?.events.filter((x) => x.title === e.title).length || 0) > 1
            ? String(at)
            : undefined,
        title: e.title,
        source: s,
        start: pp[i],
        end: range ? pp[i + 1] || null : null,
        quote: ev(
          s,
          input.title,
          at,
          at + e.occurrenceQuote.length,
          "event_time",
        ),
        place: confirmedValue(verifiedPlace),
        organizer: confirmedValue(verifiedOrganizer),
        nature: e.nature,
      });
      if (range) break;
    }
  }
  return out;
}
/**
 * Place strings arrive in several shapes across GDUFS portals:
 *   - labelled "地点：广东外语外贸大学白云山校区行政楼国际会议厅"
 *   - labelled in a table cell ("✅ 比赛地点：假草场")
 *   - verb phrases "在白云山校区尚行报告厅举行" / "于腾讯会议线上平台顺利举行"
 *   - verb phrases using 召开, which the old list missed
 * The old patterns only knew 在+举行 and dropped roughly a third of places.
 */
const PLACE_LABEL =
  /(?:活动地点|讲座地点|比赛地点|举办地点|会议地点|报到地点|地点为|地点)\s*[：:]\s*([^，。；\n]{1,130})/;
const PLACE_VERB =
  /(?:在|于)\s*([^，。；\n]{2,100}?)(?:举行|举办|召开|开展|开讲|开幕)/g;
const PLACE_HINT = /(?:校区|楼|厅|室|馆|场|中心|平台|大学|学院|广场|线上|会议)/;

function cleanPlace(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw

    .replace(/(?:顺利|成功|隆重|正式|联合|共同)$/g, "")
    .replace(/^[\s、，,]+/, "")
    .trim();
  if (!value || value.length < 2) return null;
  if (/^\d{4}\s*年/.test(value) || /^\d{1,2}[:：]\d{2}/.test(value)) return null;
  return value;
}

/** A labelled place is trusted as-is; a verb phrase needs a place hint. */
function placeOf(text: string): string | null {
  const labelled = cleanPlace(text.match(PLACE_LABEL)?.[1]);
  if (labelled) return labelled;
  // Scan from the last preposition: "定于2026年11月20日—22日在北京举行"
  // would otherwise drag the date range into the match.
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== "在" && text[i] !== "于") continue;
    const m = text.slice(i).match(
      new RegExp("^[在于]\\s*([^，。；\\n]{2,100}?)(?:举行|举办|召开|开展|开讲|开幕)"),
    );
    const value = cleanPlace(m?.[1]);
    if (!value) continue;
    if (!PLACE_HINT.test(value) && value.length < 4) continue;
    return value;
  }
  return null;
}

export function calendarizeArticle(
  input: ArticleAnalysisInput,
  base: ArticleAnalysis,
  proposal?: CalendarProposal,
): ArticleAnalysis {
  const canonical = articleText(input),
    sources: Source[] = [
      {
        id: "body",
        kind: "body",
        text: canonical.text,
        url: input.originalUrl || "",
        locator: "article",
        digest: "current-body",
        method: "articleText",
      },
      {
        id: "title",
        kind: "title",
        text: canonical.title,
        url: input.originalUrl || "",
        locator: "title",
        digest: "current-title",
        method: "title",
      },
      ...(input.calendarSources || []),
    ];
  const tableEvents: CalendarProposal["events"] = [];
  for (const s of sources.filter(
    (s) => s.kind === "table" || s.kind === "attachment",
  )) {
    const tables =
      s.kind === "table"
        ? [s.text]
        : [...s.text.matchAll(/(?:^[^\n]*\|[^\n]*(?:\n|$)){2,}/gm)].map(
            (m) => m[0],
          );
    for (const table of tables.slice(0, 2)) {
      const [header, ...rows] = table.trim().split("\n"),
        cols = header.split("|").map((x) => x.trim());
      const ni = cols.findIndex((x) => /名称|主题|题目/.test(x)),
        ti = cols.findIndex(
          (x) => /时间|日期/.test(x) && !/报名|截止|提交|发布|公示/.test(x),
        ),
        pi = cols.findIndex((x) => /地点/.test(x)),
        oi = cols.findIndex((x) => /主办/.test(x));
      if (ni < 0 || ti < 0) continue;
      for (const row of rows.slice(0, 12)) {
        const c = row.split("|").map((x) => x.trim());
        if (!c[ni] || !c[ti]) continue;
        const dates = calendarDates(c[ti]).map((m) => m[0].trim());
        if (dates.length)
          tableEvents.push({
            title: c[ni],
            sourceId: s.id,
            occurrenceQuote: row,
            dates,
            place: pi >= 0 ? c[pi] || null : null,
            organizer: oi >= 0 ? c[oi] || null : null,
            nature: "announcement",
          });
      }
    }
  }
  const tableCandidates = proposalCandidates(sources, input, {
    events: tableEvents,
  });
  let found = [
    ...sources.flatMap((s) => candidates(s, input.title)),
    ...tableCandidates,
    ...proposalCandidates(sources, input, proposal),
  ].filter(
    (c) =>
      !(
        ["body", "table"].includes(c.source.kind) &&
        c.title === input.title &&
        tableCandidates.some((t) => t.start.date === c.start.date)
      ),
  );
  const unresolvedMultiple =
    /活动汇总|多场(?:讲座|活动)|[三四五六七八九十\d]+场(?:讲座|活动)|系列讲座/.test(
      input.title + canonical.text.slice(0, 300),
    ) &&
    !proposal?.events.length &&
    found.length > 1 &&
    found.every((c) => c.title === input.title && !c.scope);
  if (unresolvedMultiple) found = [];
  const grouped = new Map<string, Candidate[]>();
  for (const c of found) {
    const key =
      c.title.replace(/[\s“”"'·|｜]/g, "") + (c.scope ? "|" + c.scope : "");
    const g = grouped.get(key) || [];
    g.push(c);
    grouped.set(key, g);
  }
  const activities: Activity[] = [];
  let reason = canonical.bodyAvailable ? "no_activity" : "no_body";
  for (let list of grouped.values()) {
    if (list.some((c) => c.specificity === 2))
      list = list.filter((c) => c.specificity === 2);
    list.sort(
      (a, b) =>
        a.start.date!.localeCompare(b.start.date!) ||
        Number(!!b.start.at) - Number(!!a.start.at) ||
        (a.start.at || "").localeCompare(b.start.at || ""),
    );
    const c = list[0];
    const bodyDates = new Set(
      list.filter((x) => x.source.kind === "body").map((x) => x.start.date),
    );
    const mediaDates = list
      .filter((x) => ["image", "attachment"].includes(x.source.kind))
      .map((x) => x.start.date);
    if (bodyDates.size && mediaDates.some((d) => !bodyDates.has(d))) {
      reason = "media_conflict";
      continue;
    }
    const end = c.end?.date || c.start.date!;
    const span =
      (Date.parse(end + "T00:00:00Z") -
        Date.parse(c.start.date + "T00:00:00Z")) /
      86400000;
    if (
      span < 0 ||
      span > 366 ||
      (c.end?.at && c.start.at && c.end.at < c.start.at)
    ) {
      reason = "invalid_interval";
      continue;
    }
    const old =
      base.activities.find((a) => a.title === c.title) ||
      (grouped.size === 1 && base.activities.length === 1
        ? base.activities[0]
        : undefined);
    const a: Activity = {
      key: `activity-${activities.length + 1}`,
      title: c.title,
      kind: "event",
      category: category(c.title, base),
      startsAt: c.start,
      endsAt: c.end,
      placeRaw: c.place,
      organizer: c.organizer,
      registrationStatus: old?.registrationStatus || "unknown",
      registrationWindows: old?.registrationWindows || [],
      registrationUrl: old?.registrationUrl || null,
      otherDeadlines: old?.otherDeadlines || [],
      status: /取消/.test(c.quote.text) ? "cancelled" : "unknown",
      evidence: [
        c.quote,
        ...[c.place, c.organizer].flatMap((value, i) =>
          value && c.source.text.includes(value)
            ? [
                ev(
                  c.source,
                  input.title,
                  c.source.text.indexOf(value),
                  c.source.text.indexOf(value) + value.length,
                  i === 0 ? "place" : "organizer",
                ),
              ]
            : [],
        ),
        ...(old?.evidence.filter((e) => e.role.startsWith("registration")) ||
          []),
      ].slice(0, 20),
      issues: [],
      calendar: {
        eligible: true,
        reason: "dated_event",
        nature: c.nature,
        campus: campus(c.place),
        candidateDates: [...new Set(list.map((x) => x.start.date!))].slice(
          0,
          20,
        ),
        origins: (input.calendarSources || [])
          .filter((s) => list.some((c) => c.source.id === s.id))
          .map((s) => ({
            id: s.id,
            kind: s.kind,
            url: s.url,
            locator: s.locator,
            digest: s.digest,
            method: s.method,
          })),
        usesBody: list.some((c) => c.source.kind !== "title"),
      },
    };
    if (a.status === "cancelled") {
      reason = "cancelled";
      continue;
    }
    activities.push(a);
    if (activities.length >= 12) break;
  }
  if (!activities.length) {
    if (unresolvedMultiple) reason = "multiple_events_unresolved";
    if (
      ["no_activity", "no_body"].includes(reason) &&
      (eventWords.test(input.title) ||
        eventWords.test(canonical.text.slice(0, 2000)))
    )
      reason = /获奖|喜报|斩获/.test(input.title)
        ? "award_not_event"
        : calendarDates(canonical.text).length
          ? !/20\d{2}/.test(input.title + canonical.text)
            ? "year_unconfirmed"
            : "no_reliable_event_date"
          : "no_event_date";
    for (const a of base.activities.filter(
      (a) =>
        !a.calendar?.origins.some(
          (o) => !input.calendarSources?.some((s) => s.id === o.id),
        ),
    ))
      activities.push({
        ...a,
        calendar: {
          eligible: false,
          reason,
          nature: nature(a.title, canonical.text),
          campus: campus(a.placeRaw),
          candidateDates: [],
          origins: [],
          usesBody: true,
        },
      });
  }
  const mediaHint =
    input.bodyFormat === "reading_html" &&
    /<img|\.(pdf|docx?|xlsx?)/i.test(input.body || "");
  return {
    ...base,
    activities,
    calendar: {
      version: CALENDAR_VERSION,
      status: activities.some((a) => a.calendar?.eligible)
        ? "accepted"
        : ![
              "award_not_event",
              "media_conflict",
              "invalid_interval",
              "cancelled",
            ].includes(reason) &&
            (eventWords.test(input.title) ||
              /活动时间|讲座时间|举办时间/.test(canonical.text)) &&
            (mediaHint ||
              (input.calendarSources?.length || 0) > 0 ||
              (eventWords.test(input.title) &&
                calendarDates(canonical.text).length)) &&
            (base.calendar?.attempts || 0) < 2
          ? "needs_enrichment"
          : "excluded",
      reason: activities.some((a) => a.calendar?.eligible)
        ? "dated_event"
        : reason,
      sources: input.calendarSources || [],
      attempts:
        base.calendar?.version === CALENDAR_VERSION
          ? base.calendar.attempts
          : 0,
    },
  };
}
