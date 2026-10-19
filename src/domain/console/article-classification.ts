// Article placement is independent of structured event extraction. Each article
// has one public destination; a dated notice does not become a standing policy.
export function classifyArticle(title: string) {
  let knowledgeCategory: string | null = null;
  if (/学习空间.*预约|借阅规则|借阅指南|开放时间一览/.test(title))
    knowledgeCategory = "campus_life";
  else if (/办法|条例|规章|管理规定|实施细则|办事指南|办理流程/.test(title))
    knowledgeCategory = /奖|助学|资助/.test(title)
      ? "scholarship_policy"
      : /教务|选课|考试|学籍|课程/.test(title)
        ? "academic_affairs"
        : /就业|升学|毕业/.test(title)
          ? "education_career"
          : /科研|课题|学术/.test(title)
            ? "research_innovation"
            : /宿舍|食堂|后勤|图书|生活/.test(title)
              ? "campus_life"
              : "administrative_services";
  const radarCategory = knowledgeCategory
    ? null
    : /讲座|论坛|学术沙龙|讲坛/.test(title)
      ? "lecture"
      : /竞赛|大赛|比赛|挑战杯/.test(title)
        ? "competition"
        : /奖学金|助学金|资助|困难补助|校长奖章/.test(title)
          ? "scholarship_opportunity"
          : /就业|招聘|升学|支教团|免试攻读/.test(title)
            ? "education_career"
            : /文艺|演出|运动会|体育|音乐|电影/.test(title)
              ? "culture_sports"
              : /科研项目|课题申报|科研申报/.test(title)
                ? "academic_research"
                : "campus_notice";
  return { radarCategory, knowledgeCategory };
}
