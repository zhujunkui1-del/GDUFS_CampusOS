/**
 * Where a question is answered.
 *
 * The assistant exists to answer this university's questions, but “What is
 * Python's latest stable release?” is not a GDUFS question. Before this
 * distinction existed every non-experience question was prefixed with
 * “广东外语外贸大学” and every non-GDUFS result was filtered out afterwards, so a
 * general question could never be answered from the public web.
 */
export type ExternalScope = "campus" | "general";

/** Words that name this university or something on it. */
const CAMPUS_TERM =
  /广外|广东外语外贸大学|GDUFS|校内|校园|本校|南校|北校|校区|大学城校区|白云山校区|一饭|二饭|三饭|食堂|饭堂|宿舍|南苑|北苑|图书馆|学术交流中心|体育馆|运动场|奖学金|助学金|教务|辅导员|学院|选课|学分|学生证|校园卡|一卡通|录取通知书|新生报到|培养方案|转专业|辅修|推免|保研/i;

/**
 * Campus life runs on notices and events that never carry the school name:
 * “最近有什么讲座” and “挑战杯什么时候举办” are this week's GDUFS announcements,
 * not world news.
 */
const CAMPUS_EVENT =
  /讲座|讲坛|论坛|沙龙|竞赛|比赛|大赛|挑战杯|校运会|运动会|社团招新|招新|晚会|演出|音乐会|校历|开学典礼|毕业典礼|考试安排|期末考试/i;

/**
 * Named global subjects decide the scope even when the question also mentions
 * “比赛” or “活动” — a question about OpenAI is about the world.
 */
const GLOBAL_SUBJECT =
  /OpenAI|Anthropic|\bAI\b|人工智能|[A-Za-z][A-Za-z0-9.]{2,}\s*(?:公司|公司发布)|arXiv|GitHub/i;

/** The most sub-queries one enumeration may expand into. */
export const MAX_ENUMERATION = 4;

/** Lead-ins that belong to the request, not to the subjects being listed. */
const LEAD_IN =
  /^(?:请|帮我|请帮我|我想|我想知道|想|要|需要|查询|查一下|查下|查查|查一查|搜一下|搜下|搜搜|搜一搜|看看|看一下|了解一下|了解下|介绍|介绍一下|告诉我|告诉我一下|列出)\s*/;

const TRAILING_PUNCTUATION = /[\s。！？?!.,~～]+$/u;
const LIST_SEPARATOR = /[、，;\n]+/u;
/**
 * Trailing question words, longest first. A name plus “分别是什么” is a
 * question, not a name: searching “D1 分别是什么” wastes the query.
 */
const QUESTION_SUFFIXES = [
  "分别是什么东西",
  "分别是什么",
  "分别是多少",
  "分别是哪些",
  "分别有哪些",
  "分别是什么样",
  "各自是什么",
  "各自是多少",
  "到底是什么",
  "到底是什么东西",
  "是什么东西",
  "是什么",
  "是哪些",
  "有哪些",
  "有多少",
  "什么样",
  "怎么样",
  "分别",
  "各自",
  "多少",
  "哪些",
  "什么",
  "呢",
];

/** A clause, not a name: “怎么补办” is a question, not something to enumerate. */
const CLAUSE_PART = /怎么|如何|为什么|何时|哪(?:个|些|里|儿)?/u;

function stripTrailingQuestion(text: string): string {
  let result = text.trim();
  for (;;) {
    const before = result;
    result = result.replace(TRAILING_PUNCTUATION, "").trim();
    const suffix = QUESTION_SUFFIXES.find((word) => result.endsWith(word));
    if (suffix) result = result.slice(0, -suffix.length).trim();
    // Strip a trailing copula only once the question word is gone, so
    // “是” inside a name is never touched.
    result = result.replace(/[是为]$/u, "").trim();
    if (result === before) return result;
    // A part that was only a question (“分别是什么”) is no subject at all.
    if (!result) return "";
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

/** True when the question asks about this university rather than the world. */
export function isCampusQuestion(query: string): boolean {
  if (GLOBAL_SUBJECT.test(query)) return false;
  return CAMPUS_TERM.test(query) || CAMPUS_EVENT.test(query);
}

/** The scope of the question, which drives both the query and the result filter. */
export function externalScope(query: string): ExternalScope {
  return isCampusQuestion(query) ? "campus" : "general";
}

/**
 * The questions an enumeration asks, one per subject.
 *
 * `search` is what a search engine should see: a bare name such as “D1” is
 * ambiguous (a camera, a dopamine receptor), so the question tail is kept.
 * `judge` stays the bare name, because that is the only part every page about
 * the subject is required to contain.
 */
export function enumerationConcepts(
  query: string,
): { search: string; judge: string }[] {
  const subjects = splitEnumeration(query);
  if (!subjects.length) return [];
  // “Cloudflare、D1、SQLite 分别是什么” loses its tail when the subjects are
  // split; put a question back so the search reads as a question rather than a
  // bare name. “分别” is dropped: it is a hint to the reader, not to the engine.
  const tail =
    /(?:是什么东西|是什么意思|是什么|有哪些|有多少|怎么样|多少)[。！？?]?\s*$/u.exec(
      query,
    )?.[0] ?? "";
  return subjects.map((subject) => {
    const judge = subject.trim();
    // A short Latin token ("D1", "ECS") is a product name, not a word: alone it
    // retrieves a camera, a dopamine receptor and an old phone brand. The
    // leading name of the same list is almost always its family.
    const family = subjects[0].trim();
    const ambiguous =
      /^[A-Za-z0-9._-]{1,3}$/.test(judge) &&
      /^[A-Za-z][A-Za-z0-9._-]{3,}$/.test(family) &&
      family !== judge;
    const head = ambiguous ? `${family} ${judge}` : judge;
    // A subject that already carries its own predicate (“OpenAI 的 API 定价”)
    // is a complete question; appending the tail would only garble it.
    const appendTail = !/[\u4e00-\u9fff]/u.test(judge);
    return {
      judge,
      search: `${head}${appendTail && tail ? ` ${tail.trim()}` : ""}`.trim(),
    };
  });
}

/**
 * The queries a relevance judgement should be made against.
 *
 * An enumeration is judged one subject at a time: reusing the merged
 * question would demand every name in one page, which is exactly the AND gate
 * that discarded all three answers to “Cloudflare、D1、SQLite 分别是什么”.
 */
export function relevanceQueries(query: string): string[] {
  const concepts = enumerationConcepts(query);
  return concepts.length > 1
    ? concepts.map((concept) => concept.judge)
    : [query];
}

/**
 * “Cloudflare、D1、SQLite 分别是什么” asks three questions at once.
 *
 * The relevance gate is a hard AND across modifiers, so one query that contains
 * all three names rejects every page that answers only one of them. Splitting
 * into one short query per subject keeps the gate meaningful.
 *
 * Returns [] when the query is not an enumeration, so callers keep the single
 * query unchanged.
 */
export function splitEnumeration(query: string): string[] {
  const text = query
    .replace(LEAD_IN, "")
    .trim()
    .replace(TRAILING_PUNCTUATION, "");
  if (!text) return [];
  // “A and B” counts only when both sides are Latin identifiers: a Chinese
  // “和” usually joins clauses rather than two named subjects.
  const conjunction = text.match(
    /^([A-Za-z][A-Za-z0-9._-]{1,29})\s*(?:和|与)\s*([A-Za-z][A-Za-z0-9._-]{1,29})(.*)$/u,
  );
  if (conjunction) {
    const suffix = stripTrailingQuestion(conjunction[3]);
    return unique([conjunction[1], conjunction[2]]).map((subject) =>
      `${subject} ${suffix}`.trim(),
    );
  }
  const parts = text.split(LIST_SEPARATOR).map((part) => part.trim());
  if (parts.length < 2) return [];
  // A part that reads as a question (“怎么补办”) is a clause, not a name, and a
  // long part is a sentence. Enumerating either searches nonsense.
  if (parts.some((part) => CLAUSE_PART.test(part) || part.length > 40))
    return [];
  // A predicate that trails the last item belongs to every item:
  // “A、B、C 的 API 定价” → “A 的 API 定价”, “B 的 API 定价”, …
  const last = parts[parts.length - 1];
  const spaced = last.match(/^(\S+)\s+(.+)$/u);
  const subjects = spaced ? [...parts.slice(0, -1), spaced[1]] : parts;
  const suffix = spaced ? stripTrailingQuestion(spaced[2]) : "";
  const cleaned = unique(
    subjects.map((subject) => stripTrailingQuestion(subject)),
  );
  if (cleaned.length < 2 || cleaned.length > MAX_ENUMERATION) return [];
  return cleaned.map((subject) => (suffix ? `${subject} ${suffix}` : subject));
}
