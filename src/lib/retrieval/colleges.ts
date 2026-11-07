// College names are query vocabulary, not a second article taxonomy: the same
// school is written by its full name in one notice and by its short name in
// another ("信息科学与技术学院" vs "信息学院"). Both are one subject, so the
// plan must accept either spelling instead of treating one as a different term.
export const COLLEGE_GROUPS: { id: string; names: string[] }[] = [
  { id: "informatics", names: ["信息科学与技术学院", "信息学院"] },
  { id: "english", names: ["英语语言文化学院", "英文学院"] },
  { id: "trade", names: ["经济贸易学院", "经贸学院"] },
  { id: "businessEnglish", names: ["国际商务英语学院", "商英学院"] },
  { id: "business", names: ["商学院"] },
  { id: "accounting", names: ["会计学院"] },
  { id: "finance", names: ["金融学院"] },
  { id: "law", names: ["法学院"] },
  { id: "publicAdmin", names: ["社会与公共管理学院", "公管学院"] },
  { id: "translation", names: ["高级翻译学院", "翻译学院"] },
  { id: "eastAsian", names: ["东方语言文化学院", "东语学院"] },
  { id: "westEuropean", names: ["西方语言文化学院", "西语学院"] },
  { id: "japanese", names: ["日语语言文化学院", "日语学院"] },
  { id: "statistics", names: ["数学与统计学院", "数统学院"] },
  { id: "chinese", names: ["中国语言文化学院", "中文学院"] },
  { id: "education", names: ["英语教育学院", "教育学院"] },
  { id: "media", names: ["新闻与传播学院", "新闻传播学院"] },
  { id: "governance", names: ["国际治理创新学院"] },
  { id: "regional", names: ["区域国别学院"] },
  { id: "african", names: ["亚非语言文化学院", "亚非学院"] },
];

/** Every spelling of the college this term names, longest first so a caller
 * can prefer the full name without losing the short one. */
export function collegeAliases(term: string) {
  const group = COLLEGE_GROUPS.find((g) => g.names.includes(term));
  if (!group) return [];
  return [...group.names].sort((a, b) => b.length - a.length);
}

/** Longest spelling first, so "社会与公共管理学院" is not eaten by "公管学院". */
export const COLLEGE_NAMES = [
  ...new Set(COLLEGE_GROUPS.flatMap((g) => g.names)),
].sort((a, b) => b.length - a.length);
