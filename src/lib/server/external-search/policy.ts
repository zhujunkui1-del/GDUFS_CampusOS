import { requestTimeWindow } from "../assistant/time-window";
import { dialogueReply } from "../assistant/dialogue";
import {
  assessEvidence,
  type EvidenceInput,
} from "@/lib/retrieval/evidence-assessment";
import {
  queryFocus,
  hasExperienceEvidence,
  participationQuery,
  matchesQueryFocus,
} from "@/lib/retrieval/query-focus";
export type ExternalPolicy = {
  intent: "official" | "experience" | "mixed" | "events" | "general";
  active: boolean;
  officialOnly: boolean;
  useXiaohongshu: boolean;
  campus: boolean;
  needsDeadline: boolean;
  explicit: boolean;
  needsOfficialVerification: boolean;
  onlyXhs?: boolean;
  focus?: ReturnType<typeof queryFocus>;
  relevanceQuery?: string;
  needsParticipation?: boolean;
  needsRoster?: boolean;
};
export function externalPolicy(query: string): ExternalPolicy {
  const focus = queryFocus(query);
  const noExternal =
    /不要联网|别联网|无需联网|不用联网|只用内部|只查内部|仅用内部|仅查内部/.test(
      query,
    );
  const experience =
    (focus === "food" &&
      /推荐|哪个好|哪家好|吃什么|吃啥|去哪吃|干饭/.test(query)) ||
    /好吃|难吃|口味|味道|踩雷|种草|测评|评测|体验|住.{0,5}怎么样|住起来|居住|隔音|蚊子|宿舍.{0,8}(?:怎么样|如何)|食堂.{0,8}(?:推荐|哪个好|哪家好)/.test(
      query,
    );
  const needsOfficialVerification =
    /(?:是|是否|担任|任职|受聘|聘任|现任|介绍|简介|师资|名单|有哪些|谁).{0,24}(?:首席专家|校长|院长|书记|教授|院士|导师)|(?:首席专家|校长|院长|书记|教授|院士|导师).{0,24}(?:有谁|有哪些|是谁|哪几位|名单|任职|现任|吗|是什么)/.test(
      query,
    );
  const official =
    needsOfficialVerification ||
    (focus === "sports" && /比赛|赛事|运动会|报名|赛程|参赛/.test(query)) ||
    /规章|制度|政策|管理办法|借阅|借书|续借|办理|流程|指南|手续|申请条件|评定条件|资格|选课|学校规定|截止|奖学金/.test(
      query,
    );
  const mixed = experience && /宿舍|住宿|设施|校园卡|选课|办理/.test(query);
  // A roster needs several named people; one lecture invitation mentioning a title
  // is not a list. Official pages are the only place to complete it.
  const needsRoster =
    /学者|教授|老师|院长|校长|专家|名单|人物/.test(query) &&
    /有哪些|举\s*(?:\d+|[几])?\s*[个位]|列举|列出|名单|谁|哪几位|介绍一下/.test(
      query,
    );
  const events =
    (requestTimeWindow(query) !== undefined || /最近|近期/.test(query)) &&
    /活动|讲座|竞赛|比赛|招聘|申请|报名|趣事|有趣|新闻|动态|分享|发生/.test(
      query,
    );
  const mapOnly =
    !experience &&
    !official &&
    !events &&
    (/地图|导航|路线|怎么走|怎么去|从.+(?:去|到)|定位|在哪|找到|找一下|附近有什么|切换.*(?:2d|3d)|(?:查找|寻找|帮我找|搜一下).*(?:图书馆|南苑|北苑|教学楼|食堂|宿舍)|^(?:南苑|北苑)\d+栋[。？?]?$|^图书馆[。？?]?$/i.test(
      query,
    ) ||
      (/图书馆|南苑\d+栋|北苑\d+栋|教学楼|饭堂|体育馆/.test(query) &&
        /详细资料|地点详情|多少层|高度|高约|属于哪个区域/.test(query)));
  const greeting =
    /^(?:你好[呀啊]?|您好|hi|hello|谢谢|好的|再见)[!！。,.，\s]*$/i.test(
      query.trim(),
    );
  const intent =
    official && !mixed
      ? "official"
      : mixed
        ? "mixed"
        : experience
          ? "experience"
          : events
            ? "events"
            : "general";
  return {
    focus,
    relevanceQuery: query,
    intent,
    active:
      !noExternal &&
      !greeting &&
      !dialogueReply(query) &&
      !mapOnly &&
      (query.trim().length >= 4 || official || experience || events),
    officialOnly: intent === "official",
    useXiaohongshu:
      ["experience", "mixed", "events"].includes(intent) ||
      (/小红书/.test(query) && intent !== "official"),
    campus:
      /广外|广东外语外贸大学|学校|校内|校园|食堂|宿舍|南苑|北苑|图书馆|奖学金/.test(
        query,
      ),
    needsDeadline: /截止|截至|最后.{0,4}(?:时间|日期)|还能报名/.test(query),
    explicit: /小红书|联网|上网|外部搜索|网上搜|互联网/.test(query),
    needsOfficialVerification,
    needsParticipation: participationQuery(query),
    needsRoster,
    onlyXhs:
      /只(?:看|用|查|搜).*小红书|仅(?:看|用|查|搜).*小红书/.test(query) &&
      intent !== "official",
  };
}
/** A source class selects providers; a retrieval miss never selects Xiaohongshu. */
export function supplementRequired(
  policy: ExternalPolicy,
  results: EvidenceInput[],
) {
  if (!policy.active) return false;
  // Archive matches cannot establish a current appointment, complete roster or campus assignment.
  if (policy.needsOfficialVerification || policy.needsRoster) return true;
  const assessment = assessEvidence(policy.relevanceQuery || "", results, {
    officialOnly: policy.officialOnly,
  });
  if (assessment.needsSupplement) return true;
  const bodies = results
    .flatMap((r) => r.hits)
    .filter(
      (h) =>
        h.bodyAvailable &&
        matchesQueryFocus(policy.focus || null, h, policy.relevanceQuery),
    );
  if (!bodies.length || policy.explicit) return true;
  if (policy.intent === "experience" || policy.intent === "mixed")
    return !bodies.some((h) =>
      hasExperienceEvidence(policy.focus || null, h, policy.relevanceQuery),
    );
  if (policy.needsParticipation) {
    const now = Date.now();
    const relevant = new Set(bodies.map((h) => h.documentId));
    return !results
      .flatMap((r) => r.activities)
      .some(
        (a) =>
          relevant.has(a.documentId) &&
          !a.historical &&
          !["cancelled", "postponed", "ended"].includes(a.eventStatus) &&
          (a.registrationState === "open" ||
            (a.registrationState === "not_required" &&
              !!a.startsAt?.date &&
              Date.parse(a.startsAt.date + "T00:00:00+08:00") > now)),
      );
  }
  if (policy.needsDeadline)
    return !results
      .flatMap((r) => r.activities)
      .some((a) => a.registrationWindows.some((w) => w.end?.date));
  if (policy.intent === "events")
    return !results.some((r) =>
      r.activities.some(
        (a) =>
          a.startsAt?.date &&
          !a.historical &&
          !["cancelled", "postponed", "ended"].includes(a.eventStatus),
      ),
    );
  return assessEvidence(policy.relevanceQuery || "", results, {
    officialOnly: policy.officialOnly,
  }).needsSupplement;
}
export function isOfficialCampusUrl(raw: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      (u.hostname === "gdufs.edu.cn" || u.hostname.endsWith(".gdufs.edu.cn"))
    );
  } catch {
    return false;
  }
}
