import { z } from "zod";
import taxonomy from "../../../docs/contracts/s3-taxonomy.v1.json";

export const radarCategories = taxonomy.radar;
export const knowledgeCategories = taxonomy.knowledge;
export const topicNames = [
  "AI",
  "志愿服务",
  "信息素养",
  "语言学习",
  "体育",
  "学术交流",
  "校园招聘",
  "毕业生",
  "就业服务",
  "就业协议",
  "奖学金",
  "助学金",
  "学生资助",
  "选课",
  "考试",
  "图书借阅",
  "图书馆服务",
  "科研项目",
  "科研管理",
  "学术诚信",
  "办事流程",
  "宿舍管理",
  "后勤服务",
  "校园交通",
  "创新创业",
  "心理健康",
] as const;
export const TopicTagsSchema = z
  .array(z.enum(topicNames))
  .max(taxonomy.rules.tags_max)
  .default([])
  .transform((value) => [...new Set(value)].sort());
export const ContentTypeSchema = z.enum(taxonomy.content_type);
export const RightsScopeSchema = z.enum(taxonomy.rights_scope);
export const RadarCategorySchema = z.enum(radarCategories.map((x) => x.code));
export const KnowledgeCategorySchema = z.enum(
  knowledgeCategories.map((x) => x.code),
);
export const RegistrationRequirementSchema = z.enum(
  taxonomy.registration_requirement,
);
export const RegistrationStateSchema = z.enum(taxonomy.registration_state);
export const DerivedEventStatusSchema = z.enum(taxonomy.event_status_derived);
export const contentTypeNames: Record<string, string> = {
  event: "活动",
  notice: "通知",
  policy: "政策",
  guide: "指南",
  news: "新闻",
  unknown: "待核实",
};
export const rightsNames: Record<string, string> = {
  metadata_only: "仅元数据",
  excerpt_and_link: "短摘录与原文链接",
  licensed_full_text: "已许可全文",
  no_collection: "不准采集",
  unknown: "待核实",
};
