import {
  queryFocus,
  sportsQueryTerms,
  matchesQueryFocus,
  participationQuery,
  activityNounQuery,
} from "./query-focus";
import { stripSearchControls } from "./query-controls";
import { COLLEGE_NAMES, collegeAliases } from "./colleges";
import { ALIAS_GROUPS, TOPIC_GROUPS, VENUE_GROUPS } from "./aliases";

// A question word glued onto a noun is not a subject: “分算优秀”, “时候开”,
// “大一要选”, “各是”, “困难认定流程是”. They are removed before the query
// planner keeps a modifier, because a modifier is a hard filter.
const MODIFIER_NOISE =
  /(?:什么|哪些|哪里|哪儿|怎么|如何|多少|几个|几时|时候|是否|多久|多大|要不要)/;

// “几” questions ask for a count, not a subject: “一年评几次” is the shape of
// the question, and a phrase built from it matches nothing.
const COUNT_QUESTION = /几(?:次|个|场|门|位|种|名|天|年|月|周)/;

// A leftover fragment can read like part of a sentence rather than a subject:
// “里丢”, “用吹风机”, “池开放”, “时长不够会影响毕业”. No article writes those as
// words, so treating them as required filters rejected documents that actually
// answer the question (“校园卡业务” states how to report a lost card). Only a
// fragment that names a subject — “人工智能”, “双学位”, “414期” — keeps the veto.
const CLAUSE_VERB = /(?:不够|不会|会影响|会不会)|^(?:[里在中被把给用对从往随趁按照们收交办查找买卖寄借还去来做看听进出开关])/u;
// A rule is written as “功率不超过 1000 瓦”, not as the question's “功率限制”.
// The attribute word is how the question was phrased, so it cannot be a gate.
const CLAUSE_TAIL = /(?:开放|关闭|提交|交付|报修|保修|记录|影响|办理|使用|收费|发放|收取)$/u;
const ATTRIBUTE = /(?:限制|要求|标准|条件|费用|价格|流程|手续|时间|规定)$/u;
// A question glued to a particle or a modal is a clause, not a term:
// “报修在哪儿” leaves “报修在”, “宿舍好不好” leaves “好不好”. No article
// writes those, so they rank instead of vetoing.
// Only particles and question tails count as glue. Modal verbs such as 能 or
// 会 end plenty of real subjects (“人工智能”, “全运会”), so they stay hard.
const CLAUSE_GLUE = /(?:在|吗|呢|吧|的|了|啊|呀|否)$/u;
const CLAUSE_MODAL = /(?:方便吗?|可以吗?|能不能?否?|需要吗?|怎么样?)$/u;
function modifierIsHard(term: string): boolean {
  if (!/[0-9A-Za-z]/.test(term)) {
    if (CLAUSE_VERB.test(term)) return false;
    if (CLAUSE_TAIL.test(term)) return false;
    if (ATTRIBUTE.test(term)) return false;
    if (CLAUSE_GLUE.test(term)) return false;
    if (CLAUSE_MODAL.test(term)) return false;
  }
  return true;
}

// “校历在哪看得到” carries a real subject plus a whole clause about looking it
// up. Stripping the clause leaves the noun the articles actually use.
const LOOKUP_CLAUSE =
  /在?哪(?:里|儿)?(?:能|可以)?(?:看|找|查|问)?(?:得到|到)?/gu;

// Retrieval concepts are query vocabulary, not a parallel article taxonomy.
// The vocabulary lives in ./aliases so lexical search and entity retries read
// the same table; broad action words never replace a subject.
export type QueryGoal =
  | "registration"
  | "participation"
  | "procedure"
  | "requirements"
  | "policy"
  | "experience"
  | "discovery"
  | "facts";
export type QueryPlan = {
  version: "query-v2";
  original: string;
  topics: { id: string; originalTerms: string[]; alternatives: string[] }[];
  topicMode: "all" | "any";
  entities: string[];
  campus: "south" | "north" | null;
  goal: QueryGoal;
  goalTerms: string[];
  temporalExpression: string | null;
  excludedTerms: string[];
  qualifiers: string[];
  modifiers: { original: string; alternatives: string[]; hard?: boolean }[];
  timeRange?: {
    after: string;
    before: string;
    role: "publication" | "event" | "registration";
  };
};
export function buildQueryPlan(
  query: string,
  timeRange?: QueryPlan["timeRange"],
): QueryPlan {
  const normalized = stripSearchControls(query.normalize("NFKC"));
  // Exclusions are constraints, never positive expansion seeds.
  const excludedTerms = [
    ...normalized.matchAll(
      /(?:不要|排除|不含|除了)\s*([\p{Script=Han}a-zA-Z]{2,12})(?=[，。；\s]|$)/gu,
    ),
  ].map((m) => m[1]);
  const positive = normalized.replace(
    /(?:不要|排除|不含|除了)\s*[\p{Script=Han}a-zA-Z]{2,12}(?=[，。；\s]|$)/gu,
    " ",
  );
  let topics: QueryPlan["topics"] = TOPIC_GROUPS.filter((c) =>
    c.aliases.some((t) => positive.includes(t)),
  ).map((c) => ({
    id: c.id,
    originalTerms: c.aliases.filter((t) => positive.includes(t)),
    alternatives: [...c.aliases],
  }));
  if (queryFocus(positive) === "sports")
    topics.unshift({
      id: "sports",
      originalTerms: sportsQueryTerms(positive).filter((t) =>
        positive.includes(t),
      ),
      alternatives: sportsQueryTerms(positive),
    });
  // Library is context for borrowing, and a generic competition is an action,
  // not a substitute for the requested subject (sports/research/etc.).
  if (topics.some((t) => t.id === "borrowing"))
    topics = topics.filter((t) => t.id !== "library");
  if (topics.some((t) => !["lecture", "competition"].includes(t.id)))
    topics = topics.filter((t) => t.id !== "competition");
  if (topics.some((t) => t.id === "agreement"))
    topics = topics.filter((t) => t.id !== "recruitment");
  const goal: QueryGoal = /报名|可报|能报|申请.*截止/.test(positive)
    ? "registration"
    : participationQuery(positive)
      ? "participation"
      : /怎么办|如何办理|办理流程|手续|操作|怎么借|怎么选/.test(positive)
        ? "procedure"
        : /条件|资格|材料|要求/.test(positive)
          ? "requirements"
          : /政策|管理办法|制度|规则|规定/.test(positive)
            ? "policy"
            : /好吃|口味|怎么样|体验|推荐|踩雷/.test(positive)
              ? "experience"
              : /哪些|有什么|活动|赛事|讲座|比赛/.test(positive) ||
                  activityNounQuery(positive)
                ? "discovery"
                : "facts";
  const goalTerms: Record<QueryGoal, string[]> = {
    registration: ["报名", "申请", "截止"],
    participation: ["报名", "参赛", "参加", "通知"],
    procedure: ["流程", "办理", "步骤", "指南", "手续"],
    requirements: ["条件", "资格", "材料", "要求"],
    policy: ["办法", "规定", "规则", "制度", "政策"],
    experience: ["推荐", "口味", "体验", "好吃", "入住"],
    discovery: [],
    facts: [],
  };
  const entities = [...positive.matchAll(/[“「"]([^”」"\n]{2,40})[”」"]/g)].map(
    (m) => m[1],
  );
  const named = [...positive.split(/；追问：/)]
    .reverse()
    .map(
      (clause) =>
        clause.match(
          /^(?:请问|那|那么)?([\p{Script=Han}]{2,4})(?:是谁|是什么职务|是不是|是否|属于|担任|是广外)/u,
        )?.[1],
    )
    .find(Boolean);
  if (named && !topics.length && !/广外|学校|校园/.test(named))
    entities.push(named);
  // A concrete venue remains a constraint rather than disappearing in synonyms.
  for (const m of positive.matchAll(
    /南苑\d+栋|北苑\d+栋|文采园|博雅园|风采园|[一二三]饭/g,
  ))
    entities.push(m[0]);
  for (const region of ["南苑", "北苑"])
    if (
      positive.includes(region) &&
      !entities.some((e) => e.startsWith(region))
    )
      entities.push(region);
  // Keep unconsumed subject modifiers, rather than discarding everything once
  // a broad intent like “讲座/比赛” has matched. This also covers new subjects
  // that are not entries in the curated campus concept vocabulary.
  let residual = positive;
  for (const term of [
    ...new Set([
      ...ALIAS_GROUPS.flatMap((c) => [...c.aliases]),
      ...sportsQueryTerms(positive),
      ...entities,
      ...goalTerms[goal],
    ]),
  ].sort((a, b) => b.length - a.length))
    residual = residual.split(term).join(" ");
  // A college name is one subject: "信息科学与技术学院" must not be split at
  // "与" by the generic cleanup below, and "信息学院院运会" must not become one
  // Han run whose every bigram (including the cross-boundary "院院") has to
  // match. Park each name in a placeholder, then restore it after the cleanup.
  const parked = new Map<string, string>();
  residual = residual.replace(/[\p{Script=Han}]+/gu, (run) => {
    const found = COLLEGE_NAMES.filter((name) => run.includes(name));
    if (!found.length) return run;
    let out = run;
    for (const name of found) {
      const key = `\u0000${parked.size}\u0000`;
      parked.set(key, name);
      out = out.split(name).join(` ${key} `);
    }
    return out;
  });
  residual = residual
    // A written date range is a constraint, not a subject. “11月10号到11月22号”
    // used to leave the modifier “号到”, which no article contains, so every
    // candidate was rejected and the answer became “没有可核对的信息”.
    .replace(
      /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]?\s*(?:到|至)\s*(?:\d{1,2}\s*月\s*)?\d{1,2}\s*[日号]?/g,
      " ",
    )
    .replace(/20\d{2}年?|\d{1,2}月\d{1,2}[日号]?|\d{4}-\d{2}-\d{2}/g, " ")
    .replace(
      /广东外语外贸大学|大学城校区|白云山校区|大学城|广外|白云山|南校区?|北校区?|校园|学校|校内|最近一两周|最近两周|近两周|这两周|未来两周|接下来两周|过去两周|前两周|最近一周|下个月|下个星期|下下周|下周|本周末|这周末|本周|这周|今天|今日|明天|明日|后天|昨日|昨天|近期|最近|目前|现在|马上|立刻|\d{1,2}周|\d{1,2}天|\d{1,2}个月|\d{1,2}点|\d{1,2}:\d{2}|请问|帮我|我想|介绍|具体|相关|是否|有没有|有哪些|有什么|有啥|什么|哪些|如何|怎么办理|怎么办|怎么|能够|能不能|能否|还可以|还能|可以|参加|参与|参赛|申请|申报|通知|管理办法|规定|规则|制度|政策|条件|材料|资格|要求|手续|办理|截止|截至|开始|时间|日期|临时|学科|学术|追问|那么|以及|同时|还有|不要联网|只查内部|只用内部|的|吗|呢|那|和|与|及|有/g,
      " ",
    );
  for (const [key, name] of parked) residual = residual.split(key).join(name);
  // An interrogative is how the question is asked, not what it is about:
  // "哪个食堂好吃", "宿舍停电了找谁", "有多少奖学金" must not keep "哪个",
  // "了找谁" or "多少" as a hard subject filter.
  residual = residual
    .replace(/哪个|哪里|哪儿|多少|几个|找谁|什么时候|几点|为什么/g, " ")
    .replace(/(?:^|\s)(?:了|吧|啊|呀|哦|嘛)(?=\s|$)/g, " ");
  const modifiers = [
    ...new Set([
      ...(residual.match(/[\p{Script=Han}]{2,}|[A-Za-z][A-Za-z0-9]{1,}/gu) ||
        []),
      ...[...positive.matchAll(/(?<!\d)\d{2,4}(?:期|届|轮|批|场|讲)/g)].map(
        (m) => m[0],
      ),
    ]),
  ]
    .map((t) =>
      t
        .replace(/^[了去找办补进出和与及的有吗呢吧啊]+/, "")
        .replace(/[了去找办补进出和与及的有吗呢吧啊]+$/, ""),
    )
    .filter((t) => t.length >= 2)
    .filter(
      (t) =>
        !/或/.test(t) &&
        ![
          "信息",
          "赛事",
          "活动",
          "方面",
          "帮忙",
          "一下",
          "看看",
          "了解",
          "资讯",
          "是谁",
          "属于",
          "担任",
          "是不是",
          "是否",
        ].includes(t),
    )
    // A modifier is a hard subject filter, so it must be something an article
    // can literally contain. “多少分算优秀” yielded “分算优秀”, “什么时候开”
    // yielded “时候开”, “大一要选哪些课” yielded “大一要选” — none of them
    // occur anywhere in the corpus, so every candidate was rejected and the
    // answer became “没有检索到”. Keep the nouns, drop the question.
    .filter((t) => !MODIFIER_NOISE.test(t))
    .map((t) => t.replace(/^(?:要|需要|可以|能|会|应该|想|打算)/, ""))
    // Same failure on the other end: “门禁熄灯是” and “缓考请假要走” kept the
    // trailing verb, and the two-character chunks then ended in “灯是” / “要走”,
    // which also appear nowhere.
    .map((t) => t.replace(/[是有走要看查找办做用评算去来]+$/u, ""))
    .map((t) => t.replace(LOOKUP_CLAUSE, ""))
    .map((t) => t.replace(/(?:得到|知道|获取|看到|查到|找到)$/u, ""))
    // “校园卡挂失之后怎么补办” kept “之后” as the subject: the article says
    // “挂失后”, never “之后”. Time words are not what the question is about.
    .map((t) => t.replace(/(?:之后|以前|之前|以后|的时候|时)$/u, ""))
    // “一次能借几本书” is a counted question, not a subject. The article
    // writes “每次可借 5 册”, so the question phrase matches nothing and the
    // topic word has to carry the search. Keep short ones (“功率限制”).
    .filter((t) => !(t.length > 4 && /[几多少]/.test(t)))
    // “收快递除了驿站还有别的点吗” and “外来访客进校需要登记吗” are two
    // clauses glued together. The clause boundary is a verb, not a noun, so
    // the subject is what comes before it.
    .flatMap((t) => {
      const parts = t.split(/需要|除了|可以|能够|能不能|有没有|还有/u);
      return parts.filter((p) => p.length >= 2);
    })
    .filter(
      (t) =>
        t.length >= 2 && !MODIFIER_NOISE.test(t) && !COUNT_QUESTION.test(t),
    )
    .slice(0, 4)
    .map((original) => ({
      original,
      alternatives: /^(?:ai|人工智能)$/i.test(original)
        ? ["AI", "人工智能"]
        : collegeAliases(original).length
          ? collegeAliases(original)
          : [original],
      // A clause fragment is a hint, not a gate: see clauseFragment.
      hard: modifierIsHard(original),
    }));
  return {
    version: "query-v2",
    original: query,
    topics: topics.slice(0, 4),
    topicMode: /和|以及|同时|还有|；追问/.test(positive) ? "any" : "all",
    entities: [...new Set(entities)].slice(0, 4),
    campus:
      /南校|大学城/.test(positive) && !/北校|白云山/.test(positive)
        ? "south"
        : /北校|白云山/.test(positive) && !/南校|大学城/.test(positive)
          ? "north"
          : null,
    goal,
    goalTerms: goalTerms[goal],
    temporalExpression:
      positive.match(
        /(?:20\d{2}\s*[-年]\s*\d{1,2}(?:\s*[-月]\s*\d{1,2}\s*[日号]?)?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?\s*(?:到|至)\s*(?:\d{1,2}\s*月\s*)?\d{1,2}\s*[日号]?|今天|今日|明天|明日|本周|这周|下周|最近一两周|最近两周|近两周|这两周|未来两周|接下来两周|过去两周|最近一周|过去7天|下个月|近期|最近)/,
      )?.[0] || null,
    excludedTerms,
    qualifiers: [
      ...["本科生", "研究生", "新生", "毕业生", "学科竞赛"].filter((t) =>
        positive.includes(t),
      ),
      ...new Set(positive.match(/20\d{2}/g) || []),
    ],
    modifiers,
    ...(timeRange ? { timeRange } : {}),
  };
}
type QueryEvidence = {
  title?: string;
  sourceName?: string;
  contentSnippet?: string;
  snippet?: string;
};
export function entityTerms(entity: string) {
  const venue = VENUE_GROUPS.find((group) => group.names.includes(entity));
  return venue ? [...venue.names] : [entity];
}
// “门禁熄灯” is two words, so no chunk contains it as one string. Accept the
// modifier when its head word is present and any of the following words
// qualifies it — a rulebook states the curfew and the lights-out time in
// separate paragraphs, and demanding both in one chunk rejected every real
// answer.
function modifierPresent(text: string, term: string) {
  const literal = term.toLowerCase();
  if (text.includes(literal)) return true;
  const chars = [...literal];
  if (chars.length < 4 || !/^[\p{Script=Han}]+$/u.test(literal)) return false;
  const pairs: string[] = [];
  for (let i = 0; i + 1 < chars.length; i += 2)
    pairs.push(chars[i] + chars[i + 1]);
  const [head, ...rest] = pairs;
  return text.includes(head) && rest.some((p) => text.includes(p));
}
// The head word of a compound entity is the subject: "缓考请假" is asked about
// 缓考, and no chapter writes both words together.
function entityPresent(text: string, term: string) {
  if (text.includes(term)) return true;
  const chars = [...term];
  if (chars.length < 4 || !/^[\p{Script=Han}]+$/u.test(term)) return false;
  return text.includes(chars[0] + chars[1]);
}
// “缓考请假” is one subject with a second word glued on. When a document
// holds the subject but not the tail — the handbook has a chapter on 缓考 but
// never says 请假 — the question is still about that chapter. Narrowing to the
// head word gives the second pass a chance without loosening the first.
export function headOfSubject(plan: QueryPlan): QueryPlan {
  const modifiers = plan.modifiers.map((m) => {
    const chars = [...m.original];
    if (chars.length < 4 || !/^[\p{Script=Han}]+$/u.test(m.original)) return m;
    const head = chars[0] + chars[1];
    return { original: head, alternatives: [head] };
  });
  return { ...plan, modifiers };
}
export function queryRelevance(plan: QueryPlan, hit: QueryEvidence) {
  const title = (hit.title || "").normalize("NFKC").toLowerCase(),
    body = (hit.contentSnippet ?? hit.snippet ?? "")
      .normalize("NFKC")
      .toLowerCase(),
    text = title + " " + body;
  const years = plan.qualifiers.filter((t) => /^20\d{2}$/.test(t));
  if (
    years.length &&
    /20\d{2}/.test(text) &&
    !years.some((year) => text.includes(year))
  )
    return { relevant: false, score: 0, reason: "requested_year_missing" };
  if (plan.excludedTerms.some((t) => title.includes(t)))
    return { relevant: false, score: 0, reason: "excluded_topic" };
  if (
    (!/是不是|是否|属于|算不算/.test(plan.original) &&
      plan.campus === "south" &&
      /白云山|北校/.test(title) &&
      !/大学城|南校/.test(title)) ||
    (!/是不是|是否|属于|算不算/.test(plan.original) &&
      plan.campus === "north" &&
      /大学城|南校/.test(title) &&
      !/白云山|北校/.test(title))
  )
    return { relevant: false, score: 0, reason: "campus_conflict" };
  const matched = plan.topics.map((t) =>
    t.alternatives.some((a) => text.includes(a.toLowerCase())),
  );
  // A modifier is a hard filter, but not every leftover fragment deserves that
  // weight: “绩点怎么算，多少分算优秀” leaves “分算优秀”, which no article
  // contains. Requiring every modifier rejected all evidence for two thirds of
  // real campus questions. A named college still binds every constraint,
  // because it is what makes “信息学院院运会” different from “院运会”.
  const modifierMatched = plan.modifiers.map((m) =>
    m.alternatives.some((t) => modifierPresent(text, t)),
  );
  const collegeBound = plan.modifiers.some((m) =>
    m.alternatives.some((a) => COLLEGE_NAMES.includes(a)),
  );
  // A number or a code is a discriminator, not a topic: “414期” must never
  // match “412期”, and “云山” alone must not rescue it.
  const distinctive = plan.modifiers.map((m) =>
    /[0-9]|[A-Za-z]/.test(m.original),
  );
  // Only a modifier that reads as a subject may veto a document. A clause
  // fragment such as “里丢” or “池开放” is a sentence piece no article writes,
  // so it ranks instead of rejecting the article that answers the question.
  const gating = plan.modifiers
    .map((m, i) => ({ m, matched: modifierMatched[i], hard: distinctive[i] }))
    .filter((x) => x.m.hard !== false);
  if (gating.length) {
    const ok = collegeBound
      ? gating.every((x) => x.matched)
      : gating.some((x) => x.hard)
        ? gating.every((x) => !x.hard || x.matched)
        : gating.some((x) => x.matched);
    if (!ok)
      return { relevant: false, score: 0, reason: "subject_modifier_missing" };
  }
  const coreInTitle = plan.topics.some((t) =>
    t.alternatives.some((a) => title.includes(a.toLowerCase())),
  );
  const titleTopics = buildQueryPlan(title).topics.map((t) => t.id);
  const compatible = (wanted: string, actual: string) =>
    wanted === actual ||
    (wanted === "borrowing" && actual === "library") ||
    (wanted === "competition" && actual === "sports");
  if (
    plan.topics.length &&
    titleTopics.length &&
    !plan.topics.some((w) => titleTopics.some((a) => compatible(w.id, a)))
  )
    return { relevant: false, score: 0, reason: "other_primary_topic" };
  const unrelatedPurpose =
    /招聘|宣讲|缴费|迎新|游学|留学|志愿者?招募|志愿活动|志协|候选人|团学exploring|临时困难补助|校领导检查|申报经验交流|申报指导会|申报动员/.test(
      title,
    ) &&
    !coreInTitle &&
    !/招聘|宣讲|缴费|迎新|游学|留学|志愿|困难补助|检查|经验交流|指导会|动员/.test(
      plan.original,
    );
  if (unrelatedPurpose)
    return { relevant: false, score: 0, reason: "incidental_subject" };
  if (
    /评审委员会|委员.{0,6}选拔|委员会.{0,12}代表/.test(title) &&
    !/委员会|委员|代表/.test(plan.original)
  )
    return { relevant: false, score: 0, reason: "wrong_target_role" };
  if (
    plan.topics.some(
      (t) =>
        t.id === "card" &&
        t.originalTerms.some((a) => a === "校园卡" || a === "一卡通"),
    ) &&
    !/校园卡|一卡通/.test(text)
  )
    return { relevant: false, score: 0, reason: "card_type_mismatch" };
  if (
    plan.topics.some((t) => t.id === "card") &&
    /挂失|补办|补卡/.test(plan.original) &&
    !/挂失|补办|补卡/.test(text)
  )
    return { relevant: false, score: 0, reason: "requested_operation_missing" };
  if (
    (plan.qualifiers.includes("本科生") &&
      /研究生/.test(title) &&
      !/本科生/.test(title)) ||
    (plan.qualifiers.includes("研究生") &&
      /本科生/.test(title) &&
      !/研究生/.test(title))
  )
    return { relevant: false, score: 0, reason: "audience_conflict" };
  if (
    plan.qualifiers.includes("学科竞赛") &&
    matchesQueryFocus("sports", hit, "体育比赛")
  )
    return { relevant: false, score: 0, reason: "discipline_conflict" };
  if (
    matched.length &&
    !(plan.topicMode === "any" ? matched.some(Boolean) : matched.every(Boolean))
  )
    return { relevant: false, score: 0, reason: "core_topic_missing" };
  const focus = queryFocus(plan.original);
  if (plan.topics.length <= 1 && !matchesQueryFocus(focus, hit, plan.original))
    return { relevant: false, score: 0, reason: "purpose_mismatch" };
  // A planner that rewrites the question into quoted anchors ("缓考请假"
  // "手续") turns them into entities, and the handbook chapter that states the
  // rule never writes the two words together — it says "缓考" in one article
  // and "请假" in another. The head word is the subject; demanding the tail
  // too threw away the chapter that answers the question.
  if (
    plan.entities.length &&
    !plan.entities.some((e) =>
      entityTerms(e).some((a) => entityPresent(text, a.toLowerCase())),
    )
  )
    return { relevant: false, score: 0, reason: "entity_missing" };
  const goalEvidence: Partial<Record<QueryGoal, RegExp>> = {
    policy: /办法|规定|规则|制度|政策/,
    procedure:
      /流程|办理|步骤|指南|手续|借阅规则|续借|凭.{0,12}(?:卡|证)|登录|提交/,
    requirements: /条件|资格|材料|要求|须|需满足|面向/,
    experience:
      /推荐|好吃|口味|味道|体验|测评|踩雷|隔音|居住|价格|喜欢|不错|难吃/,
  };
  const borrowingOperation =
    plan.topics.some((t) => t.id === "borrowing") &&
    ["procedure", "policy", "requirements"].includes(plan.goal);
  const borrowingSupport =
    /续借|借(?:书|阅).{0,20}(?:规则|管理办法|权限|流程|办理|方式|操作|期限)|(?:凭|持).{0,15}(?:校园卡|借阅证)|自助借还|人工借还|总服务台|借期|借阅期|可借.{0,8}[册本]/.test(
      text,
    );
  if (
    borrowingOperation &&
    (!borrowingSupport ||
      (/排行|荐书|书单|新书展|书展|馆藏上新/.test(title) &&
        !/排行|荐书|书单|新书展|书展/.test(plan.original)))
  )
    return { relevant: false, score: 0, reason: "borrowing_operation_missing" };
  if (
    plan.goal === "experience" &&
    plan.topics.some((t) => t.id === "housing") &&
    !/隔音|居住|入住体验|住宿体验|宿舍.{0,15}(?:环境|条件|感受)|寝室.{0,15}(?:环境|条件)|蚊子|空调|浴室|床|卫生间/.test(
      text,
    )
  )
    return { relevant: false, score: 0, reason: "housing_experience_missing" };
  if (
    plan.topics.some((t) => t.id === "water" || t.id === "power") &&
    !coreInTitle &&
    !/(?:停水|停电|供水中断|供电中断)(?:时间|通知)|(?:将|临时|需要|进行|安排|计划|届时|全天).{0,16}(?:停水|停电|暂停供水|暂停供电)/.test(
      body,
    )
  )
    return { relevant: false, score: 0, reason: "notice_action_missing" };
  if (
    ["registration", "participation"].includes(plan.goal) &&
    plan.topics.some((t) =>
      ["sports", "lecture", "competition"].includes(t.id),
    ) &&
    !/比赛|赛事|竞赛|联赛|运动会|讲座|论坛|讲坛|大赛|杯|报名|预告|对阵|通知/.test(
      title,
    ) &&
    !/(?:报名|活动|比赛|讲座)(?:时间|截止|地点)|定于20\d{2}/.test(body)
  )
    return { relevant: false, score: 0, reason: "event_opportunity_missing" };
  if (
    !borrowingOperation &&
    goalEvidence[plan.goal] &&
    !goalEvidence[plan.goal]!.test(text)
  )
    return { relevant: false, score: 0, reason: "goal_evidence_missing" };
  const score =
    plan.topics.reduce(
      (n, t) =>
        n +
        (t.alternatives.some((a) => title.includes(a.toLowerCase())) ? 6 : 3),
      0,
    ) +
    plan.goalTerms.filter((t) => text.includes(t)).length * 2 +
    // More matched subjects beat fewer: an article that mentions “绩点” and
    // “优秀” outranks one that only mentions “绩点”.
    modifierMatched.filter(Boolean).length * 2;
  return {
    relevant: true,
    score,
    reason: plan.topics.length ? "subject_and_constraints" : "lexical_query",
  };
}
