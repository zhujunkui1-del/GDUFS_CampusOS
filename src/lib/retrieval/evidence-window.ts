import { buildQueryPlan, type QueryGoal } from "./query-plan";
import { keywords } from "./terms";
/** Select task-bearing prose, rather than the first page introduction/FAQ.
 * Uses text already retrieved; never fetches, indexes or changes source text. */
export function evidenceWindow(
  text: string,
  query: string,
  maxChars: number,
  goalOverride?: QueryGoal,
) {
  const plan = buildQueryPlan(query),
    terms = keywords(query),
    goal = goalOverride || plan.goal;
  const cues: Record<string, RegExp> = {
    procedure:
      /登录|打开|点击|选择|扫描|刷卡|凭|持本人|填写|提交|确认|下载|打印|人工办理|自助借还/g,
    requirements:
      /申请条件|办理条件|资格|所需材料|须提交|需提供|适用对象|面向|限于/g,
    registration:
      /报名时间|报名开始|报名截止|报名截至|申请截止|预约时间|报名方式/g,
    participation:
      /报名时间|报名截止|比赛时间|活动时间|定于|将于|参赛对象|参赛条件/g,
    policy: /第[一二三四五六七八九十\d]+条|应当|不得|须|规定|有效期|适用范围/g,
    discovery: /讲座时间|活动时间|比赛时间|定于|将于|举办|举行|地点/g,
    experience: /好吃|口味|推荐|人均|价格|隔音|居住|入住|档口/g,
  };
  const spans = [...text.matchAll(/[^\n。！？!?]+[。！？!?]?/g)];
  let best = { at: 0, score: 0, priority: 0 };
  for (const m of spans) {
    const s = m[0];
    const cueCount = cues[goal]
      ? [...s.matchAll(new RegExp(cues[goal].source, "g"))].length
      : 0;
    let score =
      terms.reduce((n, t) => n + Number(s.includes(t)), 0) +
      Math.min(10, cueCount) * 3;
    // A workflow entry is more useful for “how do I” than a later field with
    // many repeated action verbs. This preference applies only to procedures.
    const priority = Number(
      goal === "procedure" &&
        cueCount > 0 &&
        !/[？?]$/.test(s) &&
        /第一步|步骤[一1]|(?:^|\s)[一1][.、．]|(?:打开|登录|进入).{0,24}(?:小程序|系统|办理平台|门户)/.test(
          s,
        ),
    );
    if (/[？?]$/.test(s) && cueCount < 3) score -= 6;
    if (
      /发布时间|发布日期/.test(s) &&
      ["registration", "participation", "discovery"].includes(goal)
    )
      score -= 4;
    if (
      priority > best.priority ||
      (priority === best.priority && score > best.score)
    )
      best = { at: m.index!, score, priority };
  }
  const start =
    text.length <= maxChars
      ? 0
      : Math.max(0, Math.min(text.length - maxChars, best.at - 60));
  return {
    text: text.slice(start, start + maxChars),
    start,
    score: best.score,
    priority: best.priority,
  };
}
