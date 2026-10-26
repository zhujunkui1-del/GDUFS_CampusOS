/** @param {string} raw */
export function xiaohongshuQuery(raw) {
  // Platform search expects keywords, rather than a full question sentence.
  const query = raw
    .normalize("NFKC")
    .replace(/广东外语外贸大学/g, "广外")
    .replace(/大学城校区/g, "大学城")
    .replace(
      /学生(?:评价|体验)|(?:哪个|哪家)(?:好吃)?|怎么样|(?:请|帮我)(?:查询|搜索|查找)/g,
      " ",
    )
    .replace(/[？?，,。；;]/g, " ");
  return (
    /(?:食堂|饭堂)/.test(query)
      ? query.replace(/好吃|推荐|评价|口碑|美食|测评|评测/g, " ")
      : query
  )
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
