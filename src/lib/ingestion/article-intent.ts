import {
  ARTICLE_CLASSIFIER_VERSION,
  ArticleAnalysisInputSchema,
  ArticleAnalysisSchema,
  type ArticleAnalysisInput,
  type ArticleAnalysis,
} from "@/domain/console/article-analysis";
import { topicNames } from "@/domain/console/taxonomy";
import { articleText, evidence, type ArticleText } from "./article-text";

type Hit = {
  field: "title" | "body";
  start: number;
  end: number;
  role: string;
};
function hit(
  text: ArticleText,
  re: RegExp,
  role: string,
  field: "title" | "body" = "body",
): Hit | null {
  const match = (field === "title" ? text.title : text.text).match(re);
  return match
    ? { field, start: match.index!, end: match.index! + match[0].length, role }
    : null;
}
const topics: Partial<Record<(typeof topicNames)[number], RegExp>> = {
  AI: /人工智能|\bAI\b/gi,
  志愿服务: /志愿(?:服务|者)/g,
  信息素养: /信息素养/g,
  语言学习: /语言学习|外语学习|英语学习/g,
  体育: /体育锻炼|运动训练|运动会/g,
  学术交流: /学术交流|学术沙龙|学术讲座/g,
  校园招聘: /校园招聘|校招|校园双选|校园招聘会/g,
  毕业生: /毕业生|毕业年级|届毕业/g,
  就业服务: /就业服务|招聘会|就业协议|就业手续/g,
  就业协议: /就业协议|三方协议/g,
  奖学金: /奖学金/g,
  助学金: /助学金/g,
  学生资助: /学生资助|困难补助|助学贷款/g,
  选课: /选课/g,
  考试: /考试|考务/g,
  图书借阅: /图书借阅|借阅|续借/g,
  图书馆服务: /图书馆|入馆|读者服务/g,
  科研项目: /科研项目|课题|科研申报/g,
  科研管理: /科研管理|科研经费|学术规范/g,
  学术诚信: /学术诚信|学术不端/g,
  办事流程: /办理流程|办事指南|操作步骤/g,
  宿舍管理: /宿舍|学生公寓/g,
  后勤服务: /后勤服务|报修|停水|停电/g,
  校园交通: /校园交通|校车|交通调整/g,
  创新创业: /创新创业|创业项目|创新项目/g,
  心理健康: /心理健康|心理咨询/g,
};
const radarSignals = [
  ["lecture", /讲座|讲坛|论坛|研讨会|学术沙龙|主题.*培训/],
  ["competition", /竞赛|大赛|比赛|挑战杯/],
  [
    "scholarship_opportunity",
    /奖学金|助学金|资助申请|助学贷款|困难补助|评优|奖章/,
  ],
  [
    "education_career",
    /招聘|就业|宣讲|实习|升学|推免|复试|调剂|研考|研招|研究生招生|访学|国际培养|培养项目.*选拔/,
  ],
  ["academic_research", /科研|课题|项目申报|基金申报|学术项目|创新工作坊/],
  [
    "culture_sports",
    /文体|文艺|演出|音乐会|运动会|体育|歌唱|电影|游园|舞蹈|书展|展览/,
  ],
] as const;
const knowledgeSignals = [
  [
    "administrative_services",
    /信息化应用|办事大厅|办事平台|诉求建议|行政办事|证明办理/,
  ],
  ["scholarship_policy", /奖学金|助学金|资助|助学贷款|困难补助/],
  ["academic_affairs", /教务|选课|考试|学籍|课程|成绩|学分|转专业|补考/],
  ["education_career", /就业|招聘|升学|毕业|协议|留学|考研|云享|生涯/],
  ["research_innovation", /科研|课题|学术|科研经费|知识产权|创业|专利/],
  [
    "campus_life",
    /图书|借阅|宿舍|食堂|后勤|生活|校车|心理|入馆|健康|校园网|报修|校园卡|一卡|微校卡|文化场馆/,
  ],
] as const;
function category<T extends string>(
  text: ArticleText,
  list: readonly (readonly [T, RegExp])[],
): T | null {
  const scored = list
    .map(([code, re]) => ({
      code,
      score:
        (re.test(text.title) ? 5 : 0) +
        (/[|｜丨]/.test(text.title) &&
        re.test(text.title.split(/[|｜丨]/).at(-1)!)
          ? 4
          : 0) +
        Math.min(
          4,
          text.paragraphs.slice(0, 12).filter((p) => re.test(p.text)).length,
        ),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 2 ? scored[0].code : null;
}
export function classifyArticleContent(
  raw: ArticleAnalysisInput,
): ArticleAnalysis {
  const input = ArticleAnalysisInputSchema.parse(raw),
    text = articleText(input),
    hits: Hit[] = [],
    reasons: string[] = [];
  const add = (h: Hit | null) => {
    if (h) hits.push(h);
    return !!h;
  };
  const policy = add(
    hit(
      text,
      /(?:办法|条例|规章|管理规定|实施细则|章程|借阅规则|借阅须知|选课规则)(?:说明|解读|[》）)]|$)/,
      "standing_rule",
      "title",
    ),
  ) &&
    !/(?:学习|传达|领会|贯彻|落实|重温)[^。]{0,20}(?:条例|办法|规定|细则|章程)/.test(
      text.title,
    );
  const guide = add(
    hit(
      text,
      /指南|攻略|办理流程|操作说明|使用说明|常见问题|使用规则|借阅说明/,
      "reference_purpose",
      "title",
    ),
  );
  const titleCall = add(
    hit(
      text,
      /申请通知|申报通知|申请工作|申报工作|报名|征集|评选通知|招生通知|关于举办|邀请.*参加|招聘会|宣讲】|选课安排|考试安排|临时.*(?:调整|闭馆|停)|停水|停电/,
      "current_call",
      "title",
    ),
  );
  const eventTitle = add(
    hit(
      text,
      /讲座|论坛|竞赛|大赛|比赛|演出|宣讲|招聘会|运动会|书展|展览|主题.*培训/,
      "event_purpose",
      "title",
    ),
  );
  const window = add(
    hit(
      text,
      /(?:报名|申报|申请|征集|提交|预约)(?:时间|截止|期限|开始|材料)?[\s\S]{0,65}?(?:\d{1,2}月\d{1,2}日|20\d{2}[./-]\d{1,2}[./-]\d{1,2}|即日起|额满即止)/,
      "specific_window",
    ),
  );
  const timed = add(
    hit(
      text,
      /(?:活动|讲座|比赛|复赛|决赛|举办|会议|演出|考试|笔试|面试)(?:时间|日期)?[：:]?[\s\S]{0,60}?\d{1,2}月\d{1,2}日/,
      "event_time",
    ),
  );
  const procedureParagraphs = text.paragraphs.filter((p) =>
    /^(?:第[一二三四五六七八九十\d]+步|步骤)|(?:登录|进入|点击|选择|填写|核对|上传|提交|领取|办理).{0,35}(?:登录|进入|点击|选择|填写|核对|上传|提交|领取|办理)/.test(
      p.text,
    ),
  );
  const procedureLabel = add(
    hit(
      text,
      /操作步骤|办理流程|常见问题|具体操作如下|使用方法/,
      "procedure_structure",
    ),
  );
  const procedure =
    procedureParagraphs.length >= 2 || (procedureLabel && (guide || policy));
  for (const p of procedureParagraphs.slice(0, 3))
    hits.push({
      field: "body",
      start: p.start,
      end: Math.min(p.end, p.start + 160),
      role: "procedure_step",
    });
  const norms = add(
    hit(
      text,
      /本办法|本规定|本细则|适用范围|应当|不得|须遵守|借阅期限|借阅册数|办理条件|评定条件/,
      "rule_content",
    ),
  );
  const temporary = add(
    hit(
      text,
      /临时(?:关闭|闭馆|调整)|暂停(?:供水|供电|服务)|停水通知|停电通知|恢复(?:开放|供水|供电)/,
      "temporary_change",
    ),
  );
  const report = add(
    hit(
      text,
      /圆满(?:结束|召开)|成功(?:举办|召开)|顺利(?:举办|召开|举行)|举办了|举行了|召开了|近日.{0,40}(?:召开|举行|开展|公布)|\d{1,2}月\d{1,2}日[^\n]{0,130}(?:召开|举办|举行|来访|座谈|调研|出席|参观)/,
      "dated_report",
    ),
  );
  const datedCall = add(
    hit(
      text,
      /(?:20\d{2}(?:年|级|[—-]20\d{2})|本学期|本年度|秋季|春季).{0,65}(?:招生|调剂|复试|推免|选拔|审核工作|课程调整|课题招标|征集|选课|考试|笔试|学籍异动|填报年度|申请工作|申报工作|考核和培养)/,
      "scoped_batch",
      "title",
    ),
  );
  const noticePurpose = add(
    hit(text, /通知|公告|公示/, "notice_purpose", "title"),
  );
  const noticeBody = add(
    hit(
      text,
      /现将|现就|特此公告|现已|定于|请各|请同学|终止|截止|逾期|即日起/,
      "notice_action",
    ),
  );
  const serviceDirectory =
    guide &&
    add(
      hit(
        text,
        /(?:服务时间|开放时间|联系电话|服务地点|办理地点|联系方式)/,
        "service_directory",
      ),
    );
  const lead = text.text.slice(0, 900);
  const bodyReference = add(
    hit(
      text,
      /补办流程|怎么办|办理指南|平台.{0,8}(?:操作|使用)|场馆.{0,8}(?:开放|预约)|[使用操作]指南/,
      "body_reference",
    ),
  );
  const experience =
    /云享|留学|考研/.test(text.title) &&
    add(hit(text, /参考学习|申请经验|经验分享/, "experience_reference"));
  const serviceOperations =
    procedure &&
    add(hit(text, /提交工单|办理进度|诉求.{0,20}受理/, "reusable_service"));
  const referencePurpose =
    guide ||
    policy ||
    experience ||
    (bodyReference && procedure) ||
    serviceOperations;
  const datedEvent =
    eventTitle &&
    add(
      hit(
        text,
        /(?:时间|日期)[：:]?\s*(?:20\d{2}[年./-])?\d{1,2}(?:月|[./-])/,
        "scoped_event",
      ),
    );
  const leadTask =
    !policy &&
    ((/考试|报到|宣讲|研考|研招/.test(text.title) &&
      /(?:时间|报名|报到|\d{1,2}月\d{1,2}日)/.test(lead)) ||
      (/指南/.test(text.title) &&
        /时间安排[\s\S]{0,60}(?:即日|\d{1,2}月\d{1,2}日)/.test(lead)));
  const reportPurpose =
    /回顾|收官|成功举办|顺利举行/.test(text.title) &&
    add(hit(text, /本次|参加|举办|回顾|分批有序进行/, "retrospective_purpose"));
  let reference =
    (policy ? 6 : 0) +
    (guide ? 3 : 0) +
    (procedure && referencePurpose ? 4 : 0) +
    (norms && referencePurpose ? 3 : 0) +
    (serviceDirectory ? 4 : 0) +
    (experience ? 7 : 0) +
    (bodyReference && procedure ? 3 : 0) +
    (serviceOperations ? 3 : 0);
  const referenceSection = text.paragraphs.find(
    (p) =>
      p.text.length < 35 &&
      /评定条件|申请条件|适用范围|管理办法|操作流程|所需材料/.test(p.text),
  );
  if (referenceSection && referencePurpose) {
    reference += 3;
    hits.push({
      field: "body",
      start: referenceSection.start,
      end: referenceSection.end,
      role: "reference_section",
    });
  }
  let timely =
    (titleCall ? 5 : 0) +
    (eventTitle ? 2 : 0) +
    (window ? 5 : 0) +
    (timed ? 4 : 0) +
    (temporary ? 5 : 0) +
    (report ? 6 : 0) +
    (datedCall ? 6 : 0) +
    (noticePurpose && noticeBody ? 5 : 0) +
    (datedEvent ? 5 : 0) +
    (leadTask ? 8 : 0) +
    (reportPurpose ? 8 : 0);
  // A policy-announcement wrapper does not turn the attached rules into a one-off opportunity.
  if (policy && !window && !timed && !titleCall) reference += 2;
  if (guide && eventTitle && (window || timed)) timely += 4;
  if (titleCall && window) timely += 3;
  if (procedure && referencePurpose && !window && !timed && !temporary)
    reference += 2;
  // Institutional documents (recruitment brochures, implementing rules,
  // training plans, work schemes) are reusable reference material even when
  // they also carry a dated batch scope such as "2026年复试". The reference
  // side previously had no signal for this whole family, so the whole family
  // fell into the unclassified bucket.
  const documentTitle = add(
    hit(
      text,
      /招生简章|招生方案|实施细则|管理办法|培养方案|工作方案|考核细则|管理规定|规章制度|学籍管理|学位授予/,
      "document_title",
      "title",
    ),
  );
  if (documentTitle) reference += 6;
  const mixed = reference >= 6 && timely >= 6;
  let destination: ArticleAnalysis["primaryDestination"] = "unknown";
  if (text.bodyAvailable) {
    if (mixed) {
      // A document titled as a brochure / implementing rule / scheme is
      // reference material even when it also carries a dated batch scope.
      destination = documentTitle
        ? "knowledge"
        : titleCall ||
            datedCall ||
            leadTask ||
            reportPurpose ||
            (eventTitle && window) ||
            (noticePurpose && noticeBody && window && !policy && !guide)
          ? "radar"
          : guide || policy
            ? "knowledge"
            : timely > reference + 2
              ? "radar"
              : reference > timely + 2
                ? "knowledge"
                : "unknown";
      reasons.push("同时发现可重复参考内容和阶段性事项，按主意图选择唯一栏目");
    } else if (reference >= 6 && reference > timely) destination = "knowledge";
    else if (timely >= 5 && timely > reference) destination = "radar";
  }
  // A large share of official-site posts score on neither side: photo-only
  // posts, short notices and brochures whose title already names the
  // document family. Resolve them here instead of leaving them in the
  // unclassified bucket that the radar feed then shows as "unclassified".
  if (destination === "unknown") {
    const soft =
      /云享|访谈|特辑|资讯|推荐|故事|心得|侧记|纪实|来啦|上线啦|真的太需要|倡议书|救场|精选课程|语培/.test(
        text.title,
      );
    const docTitle =
      /招生简章|招生方案|招生简介|实施细则|工作方案|培养方案|考核细则/.test(text.title);
    const HEAD =
      /^(?:[一二三四五六七八九十]{1,3}[、.．]|\d{1,2}[、.．])?\s*(?:申请条件|招生对象|报考条件|收费标准|学费标准|办理流程|所需材料|申请材料|报名材料|办理时间|办理地点|服务时间|服务地点|预约方式|开放时间|奖助政策|学制)\s*[:：]?\s*$/;
    const headings = new Set(
      text.paragraphs
        .filter((p) => p.text.length < 30 && HEAD.test(p.text))
        .map((p) => p.text.replace(/^[\d一二三四五六七八九十\s、.．]+/, "")),
    );
    const noticeLike =
      /讲座|讲坛|论坛|沙龙|研讨会|值班表|答辩|公示|公告|通知|日程|议程|宣讲|咨询会|直播|校招|招聘|招募|签署|来访|座谈|调研|获奖|表彰|举办|召开|举行|交流|签约|揭牌|慰问|走访|动态|统计表|成绩表|名单/.test(
        text.title,
      );
    // A one-word title such as "通知" is not enough on its own.
    const substantive = text.title.length >= 8;
    // A real HTML body means the page has content even when the extracted
    // text is empty, which happens on image-only posts.
    const hasContent = text.bodyAvailable || input.body.length >= 200;
    if (!soft && (docTitle || (headings.size >= 2 && !noticeLike))) {
      destination = "knowledge";
    } else if (substantive && hasContent) {
      // Photos, galleries, greetings and short notices are all campus posts.
      destination = "radar";
    }
  }

  let radarCategory: ArticleAnalysis["radarCategory"] =
    destination === "radar" ? category(text, radarSignals) : null;
  const knowledgeCategory =
    destination === "knowledge"
      ? category(text, knowledgeSignals) || "administrative_services"
      : null;
  if (destination === "radar" && !radarCategory)
    radarCategory = "campus_notice";
  if (destination === "knowledge")
    reasons.push("正文包含规则条件、重复使用的服务说明或连续操作流程");
  if (destination === "radar")
    reasons.push("正文围绕具体活动、申请窗口、临时变化或已发生的校园事件");
  if (destination === "unknown")
    reasons.push(
      text.bodyAvailable
        ? "主意图证据不足或规则冲突，保留待分类"
        : "没有可用正文，标题仅作为候选线索",
    );
  const tags = Object.entries(topics)
    .filter(([, re]) => {
      re!.lastIndex = 0;
      const inTitle = new RegExp(re!.source, "i").test(text.title),
        mentions = [...text.text.matchAll(new RegExp(re!.source, "gi"))].length;
      return inTitle || mentions >= 2;
    })
    .map(([tag]) => tag)
    .slice(0, 12);
  const type =
    destination === "knowledge"
      ? policy
        ? "policy"
        : "guide"
      : destination === "radar"
        ? eventTitle && (!report || titleCall || datedEvent)
          ? "event"
          : report
            ? "news"
            : "notice"
        : "unknown";
  return ArticleAnalysisSchema.parse({
    primaryDestination: destination,
    radarCategory: destination === "radar" ? radarCategory : null,
    knowledgeCategory: destination === "knowledge" ? knowledgeCategory : null,
    temporalType:
      destination === "unknown"
        ? "unknown"
        : mixed
          ? "mixed"
          : destination === "knowledge"
            ? "long"
            : "short",
    contentType: type,
    tags,
    auxiliaryDestinations:
      mixed && destination !== "unknown"
        ? [destination === "radar" ? "knowledge" : "radar"]
        : [],
    classificationConfidence:
      destination === "unknown"
        ? "low"
        : Math.abs(reference - timely) >= 4 ||
            (mixed && (titleCall || guide || policy))
          ? "high"
          : "medium",
    classificationReasons: reasons,
    classificationEvidence: hits
      .slice(0, 20)
      .map((h) => evidence(text, h.field, h.start, h.end, h.role)),
    classifierVersion: ARTICLE_CLASSIFIER_VERSION,
    method: "rules",
    needsAssistance: destination === "unknown",
    bodyAvailable: text.bodyAvailable,
    registrationStatus: "unknown",
    hasRegistration: false,
    activities: [],
    knowledge: {
      topic: destination === "knowledge" ? text.title : null,
      audience: [],
      departments: [],
      campusScope: /大学城校区|南校区/.test(text.text)
        ? "university_town"
        : /白云山校区|北校区/.test(text.text)
          ? "baiyun"
          : "unknown",
      conditions: [],
      steps: procedureParagraphs
        .slice(0, 20)
        .map((p) =>
          evidence(
            text,
            "body",
            p.start,
            Math.min(p.end, p.start + 600),
            "procedure_step",
          ),
        ),
      materials: [],
      effectiveFrom: null,
      effectiveUntil: null,
      validity: "unknown",
    },
    issues:
      input.bodyStatus === "partial"
        ? ["正文不完整，未出现的字段不能判定为不存在"]
        : [],
  });
}
