import type {
  ArticleAnalysis,
  ArticleAnalysisInput,
  ArticleEvidence,
  ArticleTimePoint,
  RegistrationWindow,
} from "@/domain/console/article-analysis";
import { articleText, evidence, type ArticleText } from "./article-text";

type Span = { text: string; start: number; end: number };
const datePattern =
  /(?:20\d{2}[年./-]\s*)?\d{1,2}(?:月|[./-])\s*\d{1,2}日?(?:\s*[（(](?:周|星期)[一二三四五六日天][）)])?(?:\s*(?:上午|下午|晚上|晚|中午|凌晨)?\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?)?|(?<=至|到|—|–|~|～|-)\s*\d{1,2}日(?:\s*\d{1,2}[:：]\d{2})?|(?<=至|到|—|–|~|～|-)\s*\d{1,2}[:：]\d{2}/g;
const registrationAnchor =
  /(?:报名(?:[：:]|时间|开始|截止|截至|期限|方式|通道|链接|信息|要求|表)|开始接受报名|扫码报名|参赛报名|参会回执|预约席位|填写报名|提交报名|申请(?:时间|截止|截至|期限)|申报(?:时间|截止|截至|期限)|即日起报名|报名，额满|请.{0,45}(?:前报名|报名)|报名前)/;
const negativeAnchor =
  /无需(?:预约|报名)|不(?:需要|用)报名|免(?:预约|报名)|直接到场/;
const otherAnchor =
  /(?:作品|论文|稿件|分析报告|成果)(?:提交|报送)?(?:时间|截止|截至)|(?:材料)(?:提交|报送)?(?:时间|截止|截至)|(?:缴费|付款)(?:时间|截止|截至)|(?:成绩公布|结果公布|名单公示|公示时间)/;
const eventAnchor =
  /(?:讲座|活动|比赛|演出|会议|考试|复赛|决赛|笔试|面试|开幕)(?:举办)?(?:时间|日期)|举办时间|开始时间|结束时间/;

function spans(text: ArticleText, start: number, end: number): Span[] {
  return [...text.text.slice(start, end).matchAll(/[^\n；;。，]+/g)]
    .map((m) => {
      const before = m[0].length - m[0].trimStart().length;
      const s = start + m.index! + before;
      return { text: m[0].trim(), start: s, end: s + m[0].trim().length };
    })
    .filter((s) => s.text);
}
function ev(text: ArticleText, s: Span, role: string): ArticleEvidence {
  return evidence(text, "body", s.start, Math.min(s.end, s.start + 600), role);
}
export function normalizeArticleTime(
  raw: string,
  s: Span,
  text: ArticleText,
  publishedAt: string | null,
  previous?: ArticleTimePoint | null,
  contextYear?: { year: number; basis: string },
): ArticleTimePoint {
  const evidencePoint = ev(text, s, "time_expression");
  const clock = raw.match(/^(\d{1,2})[:：](\d{2})$/);
  if (clock && previous?.date && +clock[1] < 24 && +clock[2] < 60)
    return {
      raw,
      date: previous.date,
      at: `${previous.date}T${clock[1].padStart(2, "0")}:${clock[2]}:00+08:00`,
      timezone: "Asia/Shanghai",
      precision: "exact_time",
      resolution: "minute",
      inferred: true,
      inferenceBasis: "同一明确时间区间的起始日期",
      evidence: evidencePoint,
    };
  const m = raw.match(
    /^(?:(20\d{2})[年./-]\s*)?(?:(\d{1,2})(?:月|[./-])\s*)?(\d{1,2})日?(?:\s*[（(].*?[）)])?(?:\s*(上午|下午|晚上|晚|中午|凌晨)?\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?)?$/,
  );
  const point: ArticleTimePoint = {
    raw,
    date: null,
    at: null,
    timezone: "Asia/Shanghai",
    precision: "unknown",
    resolution: "unknown",
    inferred: false,
    inferenceBasis: null,
    evidence: evidencePoint,
  };
  if (!m) return point;
  let year = m[1] ? +m[1] : null,
    month = m[2] ? +m[2] : null;
  const day = +m[3],
    bases: string[] = [];
  if (!month && previous?.date) {
    month = +previous.date.slice(5, 7);
    bases.push("同一明确区间的起始月份");
  }
  if (!year && previous?.date) {
    year = +previous.date.slice(0, 4);
    if (month !== null && month < +previous.date.slice(5, 7)) year++;
    bases.push("同一区间起始年份，跨月/跨年顺序");
  }
  if (!year && contextYear) {
    year = contextYear.year;
    bases.push(contextYear.basis);
  }
  if (!year && publishedAt && /^20\d{2}-\d{2}-\d{2}/.test(publishedAt)) {
    const pub = new Date(
      publishedAt.length === 10 ? publishedAt + "T00:00:00+08:00" : publishedAt,
    );
    if (Number.isFinite(+pub) && month) {
      const local = new Date(+pub + 8 * 3600000);
      year = local.getUTCFullYear();
      const pm = local.getUTCMonth() + 1;
      if (pm === 12 && month === 1) year++;
      if (pm === 1 && month === 12) year--;
      bases.push("原文明确发布日期的相邻年度；不是系统当前日期");
    }
  }
  if (!year || !month) return point;
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (
    !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
  )
    return point;
  point.date = date;
  point.precision = "date";
  point.resolution = "day";
  point.inferred = bases.length > 0;
  point.inferenceBasis = bases.length ? bases.join("；") : null;
  if (m[5]) {
    let h = +m[5];
    const minute = +m[6],
      second = +(m[7] || 0);
    if (/下午|晚上|晚/.test(m[4] || "") && h < 12) h += 12;
    if (m[4] === "中午" && h < 11) h += 12;
    if (h > 23 || minute > 59 || second > 59)
      return {
        ...point,
        date: null,
        precision: "unknown",
        resolution: "unknown",
      };
    point.at = `${date}T${String(h).padStart(2, "0")}:${m[6]}:${m[7] || "00"}+08:00`;
    point.precision = "exact_time";
    point.resolution = m[7] ? "second" : "minute";
  }
  return point;
}
function points(s: Span, text: ArticleText, publishedAt: string | null) {
  const matches = [...s.text.matchAll(new RegExp(datePattern.source, "g"))];
  const result: ArticleTimePoint[] = [];
  for (const match of matches) {
    const raw = match[0].trim();
    const pos = s.start + match.index! + match[0].indexOf(raw);
    result.push(
      normalizeArticleTime(
        raw,
        { text: raw, start: pos, end: pos + raw.length },
        text,
        publishedAt,
        result.at(-1),
      ),
    );
  }
  return result;
}
function windowFor(
  s: Span,
  text: ArticleText,
  publishedAt: string | null,
): RegistrationWindow {
  const pp = points(s, text, publishedAt),
    range = /(?:至|到|—|–|~|～)/.test(s.text),
    endOnly = /截止|截至|之前|前(?:完成|报名)|日前|\d[日分]?前/.test(s.text),
    startOnly = /开始|起报名|起接受|开放报名/.test(s.text);
  let start: ArticleTimePoint | null =
    range && pp.length > 1
      ? pp[0]
      : startOnly && !endOnly
        ? pp[0] || null
        : null;
  const end =
    range && pp.length > 1
      ? pp[1]
      : endOnly || range
        ? pp.at(-1) || null
        : null;
  if (
    /即日起/.test(s.text) &&
    publishedAt &&
    /^20\d{2}-\d{2}-\d{2}/.test(publishedAt)
  ) {
    const raw = "即日起",
      pos = s.start + s.text.indexOf(raw);
    const d =
      publishedAt.length === 10
        ? publishedAt
        : new Date(Date.parse(publishedAt) + 8 * 3600000)
            .toISOString()
            .slice(0, 10);
    start = {
      raw,
      date: d,
      at: null,
      timezone: "Asia/Shanghai",
      precision: "date",
      resolution: "day",
      inferred: true,
      inferenceBasis: "报名段落“即日起”以原文发布日期为基准",
      evidence: evidence(
        text,
        "body",
        pos,
        pos + raw.length,
        "relative_registration_start",
      ),
    };
  }
  const issues: string[] = [];
  if (pp.some((p) => !p.date)) issues.push("时间表达缺少可信年月或日期无效");
  if (
    start?.date &&
    end?.date &&
    (start.at || start.date) > (end.at || end.date)
  ) {
    issues.push("开始时间晚于结束时间，待核实");
    start = null;
  }
  return {
    roundLabel:
      s.text.match(/第[一二三四五六七八九十\d]+(?:批|轮|阶段)/)?.[0] || null,
    start,
    end,
    deadlineSemantics: /之前|日前|前(?:完成|报名)|\d(?:日|\d|分)前/.test(s.text)
      ? "before"
      : /截至|截止/.test(s.text)
        ? "inclusive"
        : /当天/.test(s.text)
          ? "on"
          : "unspecified",
    capacityLimited: /额满即止|满额即止|报满为止/.test(s.text),
    confidence: issues.length
      ? "low"
      : pp.some((p) => p.inferred)
        ? "medium"
        : "high",
    evidence: [ev(text, s, "registration")],
    issues,
  };
}

/** Pure extraction: no current clock, network, OCR or image downloads. */
export function extractArticleStructure(
  input: ArticleAnalysisInput,
  analysis: ArticleAnalysis,
): ArticleAnalysis {
  const text = articleText(input),
    publishedAt = input.publishedAt || null;
  if (!text.bodyAvailable) return analysis;
  const headings = [
    ...text.text.matchAll(
      /(?:^|\n)(?:活动名称|讲座题目|活动主题|\d+[.、]\s*(?:讲座|活动|比赛))[：:]\s*([^\n]{1,100})/g,
    ),
  ];
  const phases = [
    ...text.text.matchAll(/(?:^|\n)(复赛|决赛)(?:时间|日期)[：:]?\s*/g),
  ];
  const blocks = headings.length
    ? headings.slice(0, 12).map((m, i) => ({
        title: m[1],
        start: m.index! + (m[0].startsWith("\n") ? 1 : 0),
        end: headings[i + 1]?.index ?? text.text.length,
      }))
    : phases.length > 1
      ? [
          { title: text.title, start: 0, end: phases[0].index! },
          ...phases.map((m, i) => ({
            title: `${text.title} · ${m[1]}`,
            start: m.index! + 1,
            end: phases[i + 1]?.index ?? text.text.length,
          })),
        ]
      : [{ title: text.title, start: 0, end: text.text.length }];
  const activities: ArticleAnalysis["activities"] = [];
  for (const [index, block] of blocks.entries()) {
    const pieces = spans(text, block.start, block.end),
      blockText = text.text.slice(block.start, block.end);
    const isEvent =
      analysis.contentType === "event" ||
      headings.length > 0 ||
      eventAnchor.test(blockText);
    const hasReg = registrationAnchor.test(blockText),
      noReg = negativeAnchor.test(blockText);
    if (
      !isEvent &&
      !hasReg &&
      !noReg &&
      analysis.primaryDestination !== "radar"
    )
      continue;
    const a: ArticleAnalysis["activities"][number] = {
      key: `activity-${index + 1}`,
      title: block.title,
      kind: isEvent ? "event" : hasReg ? "opportunity" : "notice",
      category: analysis.radarCategory,
      startsAt: null,
      endsAt: null,
      placeRaw: null,
      organizer: null,
      registrationStatus:
        noReg && !hasReg
          ? "not_required"
          : hasReg && !noReg
            ? "required"
            : "unknown",
      registrationWindows: [],
      registrationUrl: null,
      otherDeadlines: [],
      status: "unknown",
      evidence: [],
      issues: [],
    };
    let carry: Span | null = null,
      registrationSection = false;
    for (let i = 0; i < pieces.length; i++) {
      const s = pieces[i];
      let current = s;
      if (carry && s.start - carry.end < 4) {
        current = {
          text: text.text.slice(carry.start, s.end),
          start: carry.start,
          end: s.end,
        };
        carry = null;
      }
      const other = otherAnchor.test(current.text),
        registration =
          registrationAnchor.test(current.text) ||
          (registrationSection &&
            /第[一二三四五六七八九十\d]+(?:批|轮).*截止/.test(current.text)),
        event = eventAnchor.test(current.text);
      const datePoints = points(current, text, publishedAt);
      if (
        (registration || other || event) &&
        !datePoints.length &&
        current.text.length < 35 &&
        !/即日起|额满|无需|直接到场/.test(current.text)
      ) {
        carry = current;
        if (registration) registrationSection = true;
        continue;
      }
      if (other) {
        const role = /作品|论文|稿件|报告|成果/.test(current.text)
          ? "work_submission"
          : /材料/.test(current.text)
            ? "material_submission"
            : /缴费|付款/.test(current.text)
              ? "payment"
              : /公示/.test(current.text)
                ? "publicity"
                : "results";
        for (const p of datePoints.slice(0, 2))
          a.otherDeadlines.push({
            role,
            time: p,
            evidence: ev(text, current, role),
          });
      } else if (registration && !negativeAnchor.test(current.text)) {
        registrationSection = true;
        a.registrationStatus = "required";
        // Multiple rounds in the same clause keep separate windows.
        const rounds = [
          ...current.text.matchAll(
            /第[一二三四五六七八九十\d]+(?:批|轮|阶段)/g,
          ),
        ];
        const regSpans =
          rounds.length > 1
            ? rounds.map((m, j) => {
                const start = current.start + m.index!,
                  end =
                    current.start +
                    (rounds[j + 1]?.index ?? current.text.length);
                return { start, end, text: text.text.slice(start, end) };
              })
            : [current];
        for (const reg of regSpans)
          if (a.registrationWindows.length < 12) {
            const w = windowFor(reg, text, publishedAt),
              prev = a.registrationWindows.at(-1);
            if (
              prev &&
              !prev.start &&
              !prev.end &&
              prev.roundLabel === w.roundLabel &&
              (w.start || w.end)
            ) {
              w.evidence.unshift(...prev.evidence.slice(0, 2));
              a.registrationWindows.pop();
              a.registrationWindows.push(w);
            } else if (
              prev?.start &&
              !prev.end &&
              !w.start &&
              w.end &&
              prev.roundLabel === w.roundLabel
            ) {
              prev.end = w.end;
              prev.evidence.push(...w.evidence);
              prev.deadlineSemantics = w.deadlineSemantics;
            } else a.registrationWindows.push(w);
          }
        a.evidence.push(ev(text, current, "registration"));
        const url = current.text.match(/https:\/\/[^\s，。；<>]+/)?.[0];
        if (url) a.registrationUrl = url;
      } else if (event && datePoints.length) {
        if (/结束时间/.test(current.text)) a.endsAt = datePoints[0];
        else {
          a.startsAt ??= datePoints[0];
          if (datePoints.length > 1 && /至|到|—|–|~/.test(current.text))
            a.endsAt = datePoints[1];
        }
        a.evidence.push(ev(text, current, "event_time"));
        registrationSection = false;
      }
      if (negativeAnchor.test(current.text)) {
        a.evidence.push(ev(text, current, "registration_not_required"));
        if (a.registrationStatus === "required")
          a.issues.push("报名要求存在冲突，待核实");
        else a.registrationStatus = "not_required";
      }
      const place = current.text.match(
        /(?:活动地点|讲座地点|比赛地点|举办地点|地点)[：:]\s*([^\n]{1,150})/,
      );
      if (place) {
        a.placeRaw = place[1].trim();
        a.evidence.push(ev(text, current, "place"));
      }
      const organizer = current.text.match(
        /(?:主办单位|主办方)[：:]\s*([^\n]{1,100})/,
      );
      if (organizer) a.organizer = organizer[1].trim();
    }
    if (/(?:本次活动|本场讲座|比赛)(?:已)?取消/.test(blockText))
      a.status = "cancelled";
    else if (/(?:活动|讲座|比赛)(?:延期|改期)/.test(blockText))
      a.status = "postponed";
    if (noReg && hasReg) {
      a.registrationStatus = "unknown";
      a.registrationWindows = [];
      a.issues.push("同一活动既出现需报名又出现无需报名，不能自动确定");
    }
    if (a.registrationStatus === "required" && !a.registrationWindows.length)
      a.registrationWindows.push({
        roundLabel: null,
        start: null,
        end: null,
        deadlineSemantics: "unspecified",
        capacityLimited: /额满即止/.test(blockText),
        confidence: "low",
        evidence: pieces
          .filter((p) => registrationAnchor.test(p.text))
          .slice(0, 2)
          .map((p) => ev(text, p, "registration")),
        issues: ["没有可靠的报名日期"],
      });
    if (/额满即止|报满为止/.test(blockText))
      for (const w of a.registrationWindows) w.capacityLimited = true;
    a.evidence = a.evidence.slice(0, 20);
    a.otherDeadlines = a.otherDeadlines.slice(0, 15);
    activities.push(a);
  }
  const required = activities.some((a) => a.registrationStatus === "required"),
    notRequired =
      activities.length > 0 &&
      activities.every((a) => a.registrationStatus === "not_required");
  const parts = spans(text, 0, text.text.length),
    field = (re: RegExp, role: string) =>
      parts
        .filter((p) => re.test(p.text))
        .slice(0, 12)
        .map((p) => ev(text, p, role));
  const effective = parts.find((p) =>
      /(?:生效时间|生效日期|自.{0,20}起施行)/.test(p.text),
    ),
    expires = parts.find((p) => /失效日期|失效时间|有效期至/.test(p.text));
  const knowledge = {
    ...analysis.knowledge,
    audience: parts
      .flatMap(
        (p) =>
          p.text.match(/(?:适用对象|面向对象)[：:]\s*(.{1,100})/)?.slice(1) ||
          [],
      )
      .slice(0, 8),
    departments: parts
      .flatMap(
        (p) =>
          p.text
            .match(/(?:适用部门|办理部门|负责部门)[：:]\s*(.{1,100})/)
            ?.slice(1) || [],
      )
      .slice(0, 8),
    conditions: field(/办理条件|申请条件|评定条件|须满足|需满足/, "condition"),
    materials: field(/所需材料|须提交|需提供/, "materials"),
    effectiveFrom: effective
      ? points(effective, text, publishedAt)[0] || null
      : null,
    effectiveUntil: expires
      ? points(expires, text, publishedAt)[0] || null
      : null,
  };
  return {
    ...analysis,
    registrationStatus: required
      ? "required"
      : notRequired
        ? "not_required"
        : "unknown",
    hasRegistration: required,
    activities,
    knowledge,
    issues: [
      ...analysis.issues,
      ...(/附件|海报|图片/.test(text.text) &&
      !activities.some((a) => a.registrationWindows.some((w) => w.end?.date))
        ? ["附件或图片未获得可靠时间文本，不推测日期"]
        : []),
    ].slice(0, 30),
  };
}

/** Status changes at read time; saved source facts do not need periodic writes. */
export function activityStatus(
  a: ArticleAnalysis["activities"][number],
  now: string,
): ArticleAnalysis["activities"][number]["status"] {
  if (a.status === "cancelled" || a.status === "postponed") return a.status;
  const stamp = Date.parse(now),
    today = new Date(stamp + 8 * 3600000).toISOString().slice(0, 10);
  const past = (p: ArticleTimePoint | null) =>
    !!p && (p.at ? Date.parse(p.at) < stamp : !!p.date && p.date < today);
  if (past(a.endsAt)) return "ended";
  if (a.startsAt?.at && Date.parse(a.startsAt.at) > stamp) return "upcoming";
  if (
    a.registrationWindows.length &&
    a.registrationWindows.every((w) => past(w.end))
  )
    return "registration_closed";
  if (
    a.registrationWindows.some(
      (w) =>
        w.end?.at &&
        Date.parse(w.end.at) > stamp &&
        w.start?.at &&
        Date.parse(w.start.at) <= stamp,
    )
  )
    return "registration_open";
  return "unknown";
}
