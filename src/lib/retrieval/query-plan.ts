import {
  queryFocus,
  sportsQueryTerms,
  matchesQueryFocus,
  participationQuery,
} from "./query-focus";

// Retrieval concepts are query vocabulary, not a parallel article taxonomy.
// Aliases expand each original concept; broad action words never replace it.
const concepts = [
  { id: "borrowing", aliases: ["借书", "借阅", "续借", "借阅规则"] },
  { id: "library", aliases: ["图书馆", "入馆", "读者"] },
  { id: "card", aliases: ["校园卡", "一卡通", "补卡", "挂失"] },
  { id: "courses", aliases: ["选课", "课程选择", "选课规则"] },
  { id: "scholarship", aliases: ["奖学金", "奖助", "学生资助"] },
  { id: "aid", aliases: ["助学金", "助学贷款"] },
  { id: "agreement", aliases: ["就业协议", "三方协议", "签约手续"] },
  { id: "recruitment", aliases: ["招聘", "招聘会", "宣讲会", "实习"] },
  {
    id: "research",
    aliases: ["科研项目", "科研管理", "项目申报", "课题", "项目招标"],
  },
  {
    id: "food",
    aliases: [
      "食堂",
      "饭堂",
      "餐厅",
      "好吃",
      "美食",
      "口味",
      "一饭",
      "文采园",
      "博雅园",
      "风采园",
    ],
  },
  {
    id: "housing",
    aliases: ["宿舍", "寝室", "住宿", "南苑", "北苑", "入住", "居住", "隔音"],
  },
  { id: "club", aliases: ["社团", "漫协", "二次元", "动漫协会", "ACG"] },
  { id: "water", aliases: ["停水", "供水", "用水中断"] },
  { id: "power", aliases: ["停电", "供电中断", "用电施工"] },
  { id: "lecture", aliases: ["讲座", "讲坛", "学术沙龙", "论坛"] },
  { id: "competition", aliases: ["竞赛", "比赛", "大赛"] },
] as const;
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
  modifiers: { original: string; alternatives: string[] }[];
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
  const normalized = query.normalize("NFKC");
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
  let topics: QueryPlan["topics"] = concepts
    .filter((c) => c.aliases.some((t) => positive.includes(t)))
    .map((c) => ({
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
              : /哪些|有什么|活动|赛事|讲座|比赛/.test(positive)
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
  const named = positive.match(
    /^(?:请问)?([\p{Script=Han}]{2,4})(?:是谁|是什么职务|是不是|担任|是广外)/u,
  )?.[1];
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
      ...concepts.flatMap((c) => [...c.aliases]),
      ...sportsQueryTerms(positive),
      ...entities,
      ...goalTerms[goal],
    ]),
  ].sort((a, b) => b.length - a.length))
    residual = residual.split(term).join(" ");
  residual = residual
    .replace(/20\d{2}年?|\d{1,2}月\d{1,2}日?|\d{4}-\d{2}-\d{2}/g, " ")
    .replace(
      /广东外语外贸大学|大学城校区|白云山校区|大学城|广外|白云山|南校区?|北校区?|校园|学校|校内|最近一周|下个月|本周|这周|下周|今天|今日|近期|最近|目前|现在|请问|帮我|我想|介绍|具体|相关|是否|有没有|有哪些|有什么|有啥|什么|哪些|如何|怎么办理|怎么办|怎么|能够|能不能|能否|还可以|还能|可以|参加|参与|参赛|申请|申报|通知|管理办法|规定|规则|制度|政策|条件|材料|资格|要求|手续|办理|截止|截至|开始|时间|日期|临时|学科|学术|追问|那么|以及|同时|还有|不要联网|只查内部|只用内部|的|吗|呢|那|和|与|及|有/g,
      " ",
    );
  const modifiers = [
    ...new Set([
      ...(residual.match(/[\p{Script=Han}]{2,}|[A-Za-z][A-Za-z0-9]{1,}/gu) ||
        []),
      ...[...positive.matchAll(/(?<!\d)\d{2,4}(?:期|届|轮|批|场|讲)/g)].map(
        (m) => m[0],
      ),
    ]),
  ]
    .filter(
      (t) =>
        ![
          "信息",
          "赛事",
          "方面",
          "帮忙",
          "一下",
          "看看",
          "了解",
          "资讯",
        ].includes(t),
    )
    .slice(0, 4)
    .map((original) => ({
      original,
      alternatives: /^(?:ai|人工智能)$/i.test(original)
        ? ["AI", "人工智能"]
        : [original],
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
        /(?:20\d{2}[-年]\d{1,2}(?:[-月]\d{1,2}日?)?|今天|今日|本周|这周|下周|最近一周|过去7天|下个月|近期|最近)/,
      )?.[0] || null,
    excludedTerms,
    qualifiers: ["本科生", "研究生", "新生", "毕业生", "学科竞赛"].filter((t) =>
      positive.includes(t),
    ),
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
  const venues = [
    ["一饭", "第一饭堂", "第一食堂", "文采园"],
    ["二饭", "第二饭堂", "第二食堂", "博雅园"],
    ["三饭", "第三饭堂", "第三食堂", "风采园"],
  ];
  return venues.find((g) => g.includes(entity)) || [entity];
}
export function queryRelevance(plan: QueryPlan, hit: QueryEvidence) {
  const title = (hit.title || "").normalize("NFKC").toLowerCase(),
    body = (hit.contentSnippet ?? hit.snippet ?? "")
      .normalize("NFKC")
      .toLowerCase(),
    text = title + " " + body;
  if (plan.excludedTerms.some((t) => title.includes(t)))
    return { relevant: false, score: 0, reason: "excluded_topic" };
  if (
    (plan.campus === "south" &&
      /白云山|北校/.test(title) &&
      !/大学城|南校/.test(title)) ||
    (plan.campus === "north" &&
      /大学城|南校/.test(title) &&
      !/白云山|北校/.test(title))
  )
    return { relevant: false, score: 0, reason: "campus_conflict" };
  const matched = plan.topics.map((t) =>
    t.alternatives.some((a) => text.includes(a.toLowerCase())),
  );
  if (
    plan.modifiers.length &&
    !plan.modifiers.every((m) =>
      m.alternatives.some((t) => text.includes(t.toLowerCase())),
    )
  )
    return { relevant: false, score: 0, reason: "subject_modifier_missing" };
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
  if (
    plan.entities.length &&
    !plan.entities.some((e) =>
      entityTerms(e).some((a) => text.includes(a.toLowerCase())),
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
    plan.goalTerms.filter((t) => text.includes(t)).length * 2;
  return {
    relevant: true,
    score,
    reason: plan.topics.length ? "subject_and_constraints" : "lexical_query",
  };
}
