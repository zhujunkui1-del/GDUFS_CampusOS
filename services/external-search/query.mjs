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
    /(?:食堂|饭堂|[一二三四五六七八九1-9]饭)/.test(query)
      ? query.replace(
          /有什么|有啥|好吃(?:的)?|推荐(?:一下)?|评价|口碑|美食|测评|评测|招牌菜|档口/g,
          " ",
        )
      : query
  )
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
