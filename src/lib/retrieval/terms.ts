import { queryFocus, sportsQueryTerms } from "./query-focus";
import { buildQueryPlan, entityTerms, type QueryPlan } from "./query-plan";
import { stripSearchControls } from "./query-controls";
import { ALIAS_GROUPS } from "./aliases";
import { COLLEGE_NAMES } from "./colleges";
// Encoded two-character Chinese terms avoid unicode61's whole-Han-run behavior.
// This is keyword expansion, not paid embedding or a second classifier.
const groups = ALIAS_GROUPS.map((group) => group.aliases);
export function keywords(query: string) {
  const cleaned = stripSearchControls(query)
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /广外|广东外语外贸大学|学校|校园|请问|帮我|我想|如何|怎么|哪些|什么|有没有|现在|最近|这周|本周|今天|下个月|可以|目前|一下|需要|准备|的|吗|呢|呀/g,
      " ",
    );
  const phrases = cleaned.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) || [];
  const expanded = groups
    .filter((g) => g.some((t) => query.includes(t)))
    .flat();
  if (queryFocus(query) === "sports")
    expanded.unshift(...sportsQueryTerms(query));
  return [...new Set([...phrases, ...expanded])]
    .filter((s) => s.length >= 2)
    .slice(0, 24);
}
export function lexicalTokens(text: string) {
  const tokens: string[] = [];
  for (const run of text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{Script=Han}]+|[a-z0-9]+/gu) || []) {
    if (/\p{Script=Han}/u.test(run)) {
      const chars = [...run];
      for (let i = 0; i < chars.length - 1; i++)
        tokens.push(
          "h" +
            chars[i].codePointAt(0)!.toString(16) +
            "x" +
            chars[i + 1].codePointAt(0)!.toString(16),
        );
    } else if (run.length > 1) tokens.push("w" + run.slice(0, 80));
  }
  return tokens;
}
export function ftsExpression(query: string) {
  const plan = buildQueryPlan(query);
  // A plan subject is a separate phrase per subject ("信息学院" AND "院运会").
  // Falling back to the whole query would glue them into one Han run whose
  // every bigram must match, including the cross-boundary "院院".
  if (plan.topics.length || plan.entities.length || plan.modifiers.length)
    return planExpression(plan, false);
  // Require an actual topic rather than OR-ing every bigram of words such as
  // “申请条件”. The latter brings back most of the corpus for common syllables.
  const topics = [
    ["借书", "借阅", "续借"],
    ["校园卡", "一卡通", "补卡", "挂失"],
    ["选课", "课程选择"],
    ["奖学金"],
    ["助学金", "助学贷款"],
    ["就业协议", "三方协议"],
    ["招聘", "宣讲", "实习"],
    ["讲座", "讲坛", "学术沙龙", "论坛"],
    ["竞赛", "比赛", "大赛"],
    ["科研项目", "项目申报", "课题"],
    ["停水", "停电"],
  ];
  const anchored = topics
    .filter((g) => g.some((t) => query.includes(t)))
    .flat();
  if (queryFocus(query) === "food")
    anchored.push("食堂", "饭堂", "餐厅", "一饭", "文采园", "博雅园", "风采园");
  if (queryFocus(query) === "club")
    anchored.push("社团", "漫协", "二次元", "动漫", "ACG");
  const phrases = [
    ...new Set(
      queryFocus(query) === "sports"
        ? sportsQueryTerms(query)
        : anchored.length
          ? anchored
          : keywords(query),
    ),
  ].slice(0, 24);
  const expressions = phrases
    .map((p) => [...new Set(lexicalTokens(p))].slice(0, 12))
    .filter((p) => p.length)
    .map((p) => "(" + p.map((t) => '"' + t + '"').join(" AND ") + ")");
  return expressions.length ? "(" + expressions.join(" OR ") + ")" : null;
}
// A two-character chunk of a Han run, encoded the same way as a bigram.
function chunkToken(pair: string) {
  return (
    "h" +
    pair.codePointAt(0)!.toString(16) +
    "x" +
    pair.codePointAt(1)!.toString(16)
  );
}
// “门禁熄灯” is two words, not one phrase: the overlapping bigrams include the
// cross-word “禁熄”, which no article contains, so requiring all of them
// returned nothing. Non-overlapping chunks (“门禁” AND “熄灯”) survive that,
// and OR-ing them with the strict phrase keeps exact titles working.
function chunkExpression(phrase: string) {
  const chars = [...phrase];
  if (chars.length < 4 || !/^[\p{Script=Han}]+$/u.test(phrase)) return null;
  const chunks: string[] = [];
  for (let i = 0; i + 1 < chars.length; i += 2)
    chunks.push('"' + chunkToken(chars[i] + chars[i + 1]) + '"');
  return chunks.length >= 2 ? "(" + chunks.join(" AND ") + ")" : null;
}
function phraseExpression(phrases: string[]) {
  const groups = phrases.slice(0, 24).flatMap((phrase) => {
    const tokens = [...new Set(lexicalTokens(phrase))].slice(0, 12);
    if (!tokens.length) return [];
    const strict = "(" + tokens.map((t) => '"' + t + '"').join(" AND ") + ")";
    const chunks = chunkExpression(phrase);
    return [chunks ? "(" + strict + " OR " + chunks + ")" : strict];
  });
  return "(" + groups.join(" OR ") + ")";
}
function planExpression(plan: QueryPlan, literal: boolean) {
  const topics = plan.topics.map((t) =>
    phraseExpression(
      literal && t.originalTerms.length ? t.originalTerms : t.alternatives,
    ),
  );
  const entity = plan.entities.map((e) => phraseExpression(entityTerms(e)));
  // Recall must be as wide as the relevance gate that follows it. A named
  // college is what separates “信息学院院运会” from “院运会”, so it still
  // binds every modifier; the leftover fragments of an ordinary question
  // (“比例”, “区别”) are hints, and requiring all of them in one chunk
  // returned nothing to read.
  const collegeBound = plan.modifiers.some((m) =>
    m.alternatives.some((a) => COLLEGE_NAMES.includes(a)),
  );
  const modifier = plan.modifiers.map((m) =>
    phraseExpression(literal ? [m.original] : m.alternatives),
  );
  const modifierExpression = collegeBound
    ? modifier.join(" AND ")
    : modifier.length
      ? "(" + modifier.join(" OR ") + ")"
      : "";
  const parts = [
    ...(topics.length
      ? ["(" + topics.join(plan.topicMode === "any" ? " OR " : " AND ") + ")"]
      : []),
    ...(entity.length
      ? ["(" + entity.join(plan.topicMode === "any" ? " OR " : " AND ") + ")"]
      : []),
    ...(modifierExpression ? [modifierExpression] : []),
  ];
  return parts.join(" AND ");
}
export function ftsRecallLanes(query: string) {
  const plan = buildQueryPlan(query),
    expanded = ftsExpression(query);
  if (!expanded) return [];
  if (!plan.topics.length && !plan.entities.length && !plan.modifiers.length)
    return [{ name: "lexical", expression: expanded, limit: 96 }];
  return [
    {
      name: "title_subject",
      expression: "title_terms : (" + planExpression(plan, true) + ")",
      limit: 32,
    },
    { name: "expanded_subject", expression: expanded, limit: 64 },
  ];
}
