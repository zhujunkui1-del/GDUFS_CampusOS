// One alias vocabulary for the whole retrieval stack.
//
// The same campus thing is written several ways ("信息科学与技术学院" /
// "信息学院", "文采园" / "一饭"), and each subsystem used to keep its own
// private copy of the table — which is why the college list was missing from
// all of them at once. This is the single source of that vocabulary.
//
// It is expansion over words we already have. It is not a second taxonomy,
// not an embedding model, and not a change to what D1 stores.
export { COLLEGE_GROUPS, COLLEGE_NAMES, collegeAliases } from "./colleges";

export type AliasRole = "topic" | "keyword";

export type AliasGroup = {
  id: string;
  /** Every member is an acceptable spelling of the same subject. */
  aliases: string[];
  /**
   * Where the group is read.
   *
   * - `topic` — the query planner treats it as a *subject* of the question.
   *   Only things a document can be about belong here.
   * - `keyword` — lexical expansion for FTS only.
   *
   * Action words ("报名", "申请材料") are keyword-only: "英语演讲竞赛报名通知"
   * is a notice about a competition, not about the act of registering, so
   * letting "报名" become a topic would make it look like a different subject.
   */
  roles: AliasRole[];
};

const topic = (id: string, aliases: string[]): AliasGroup => ({
  id,
  aliases,
  roles: ["topic", "keyword"],
});
const keyword = (id: string, aliases: string[]): AliasGroup => ({
  id,
  aliases,
  roles: ["keyword"],
});

/** Subjects of a question. Query planning picks a group when one of its
 * members appears; lexical search expands every member of that group. */
export const ALIAS_GROUPS: AliasGroup[] = [
  topic("borrowing", ["借书", "借阅", "图书借阅", "续借", "借阅规则"]),
  topic("library", ["图书馆", "入馆", "读者"]),
  topic("card", ["校园卡", "一卡通", "补卡", "挂失", "校园卡补办"]),
  topic("courses", ["选课", "课程选择", "选课规则"]),
  topic("scholarship", ["奖学金", "奖助", "学生资助"]),
  topic("aid", ["助学金", "学生资助", "助学贷款"]),
  topic("agreement", ["就业协议", "三方协议", "签约手续", "签约"]),
  topic("volunteer", ["志愿者", "志愿活动", "志愿服务", "志愿招募"]),
  topic("recruitment", ["招聘", "宣讲", "招聘会", "宣讲会", "实习"]),
  topic("research", ["科研项目", "科研管理", "项目申报", "课题", "项目招标"]),
  topic("food", [
    "食堂",
    "饭堂",
    "餐厅",
    "好吃",
    "美食",
    "口味",
    "一饭",
    "文采园",
    "二饭",
    "博雅园",
    "三饭",
    "风采园",
  ]),
  topic("housing", [
    "宿舍",
    "寝室",
    "住宿",
    "南苑",
    "北苑",
    "入住",
    "居住",
    "隔音",
  ]),
  topic("club", ["社团", "漫协", "二次元", "动漫协会", "ACG"]),
  topic("water", ["停水", "供水", "用水中断"]),
  topic("power", ["停电", "供电中断", "用电施工"]),
  topic("lecture", ["讲座", "讲坛", "学术沙龙", "论坛"]),
  topic("competition", ["竞赛", "比赛", "大赛"]),
  keyword("requirements", ["申请条件", "评定条件", "申请资格"]),
  keyword("materials", ["申请材料", "所需材料", "提交材料"]),
  keyword("registration", ["报名", "预约席位", "参会回执", "申请时间"]),
  keyword("procedureGroup", ["办事", "办理流程", "操作指南"]),
];

export const TOPIC_GROUPS = ALIAS_GROUPS.filter((group) =>
  group.roles.includes("topic"),
);

export type VenueGroup = {
  id: string;
  /** Every member names the same place. */
  names: string[];
};

/** Places students name by their short form ("一饭" for the first canteen). */
export const VENUE_GROUPS: VenueGroup[] = [
  { id: "clinic", names: ["门诊部", "门诊楼", "门诊室", "校医院"] },
  { id: "canteen1", names: ["一饭", "文采园", "第一饭堂", "第一食堂"] },
  { id: "canteen2", names: ["二饭", "博雅园", "第二饭堂", "第二食堂"] },
  { id: "canteen3", names: ["三饭", "风采园", "第三饭堂", "第三食堂"] },
  { id: "yunshan", names: ["云山学者", "云山青年学者", "云山领军学者"] },
];
