/** Source/tool preferences are operators, not words that source prose must contain. */
export function stripSearchControls(query: string) {
  return query
    .replace(
      /(?:请问|请)?(?:调用|使用|通过|只用|仅用|用|从|在)\s*(?:小红书|互联网|网上|网络|外部搜索)(?:官网)?(?:上|里)?(?:来|帮我)?(?:搜索|查找|查询|看看|搜|查|找)(?:一下|一遍)?/g,
      " ",
    )
    .replace(/(?:只查内部|只用内部|仅查内部|仅用内部|不要联网|不用联网)/g, " ")
    .replace(
      /(?:^|[，,；;])\s*(?:只看|仅看|只用|仅用)小红书[。！？!?\s]*$/g,
      " ",
    );
}
