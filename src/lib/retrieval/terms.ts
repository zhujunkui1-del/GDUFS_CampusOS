// Encoded two-character Chinese terms avoid unicode61's whole-Han-run behavior.
// This is keyword expansion, not paid embedding or a second classifier.
const groups = [
  ["借书", "借阅", "图书借阅", "续借", "借阅规则"],
  ["图书馆", "入馆", "读者"],
  ["校园卡", "一卡通", "补卡", "挂失", "校园卡补办"],
  ["选课", "课程选择", "选课规则"],
  ["奖学金", "奖助", "学生资助"],
  ["助学金", "学生资助", "助学贷款"],
  ["就业协议", "三方协议", "签约"],
  ["招聘", "宣讲", "招聘会", "实习"],
  ["申请条件", "评定条件", "申请资格", "条件"],
  ["申请材料", "所需材料", "提交材料", "材料"],
  ["讲座", "讲坛", "学术沙龙", "论坛"],
  ["竞赛", "比赛", "大赛"],
  ["报名", "预约席位", "参会回执", "申请时间"],
  ["办事", "办理流程", "操作指南"],
  ["科研项目", "项目申报", "课题"],
  ["停水", "停电", "临时通知"],
];
export function keywords(query: string) {
  const cleaned = query
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
  const phrases = [
    ...new Set(anchored.length ? anchored : keywords(query)),
  ].slice(0, 20);
  const expressions = phrases
    .map((p) => [...new Set(lexicalTokens(p))].slice(0, 12))
    .filter((p) => p.length)
    .map((p) => "(" + p.map((t) => '"' + t + '"').join(" AND ") + ")");
  return expressions.length ? "(" + expressions.join(" OR ") + ")" : null;
}
