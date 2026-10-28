export type QueryFocus = "food" | "housing" | "club" | null;
type Evidence = {
  title?: string;
  sourceName?: string;
  contentSnippet?: string;
  snippet?: string;
};
export function queryFocus(query: string): QueryFocus {
  const venue = /食堂|饭堂|餐厅|餐馆|档口|[一二三四]饭|吃什么|吃啥|去哪吃/;
  if (
    /书籍|书展|新书|书单|馆藏|阅读|什么书|哪些书/.test(query) &&
    !venue.test(query)
  )
    return null;
  if (venue.test(query) || /好吃|美食|口味|味道|干饭/.test(query))
    return "food";
  if (/社团|漫协|动漫协会|二次元|ACG|cosplay/i.test(query)) return "club";
  if (/宿舍|住宿|入住|居住|隔音|寝室/.test(query)) return "housing";
  return null;
}
/** Article purpose matters: an overseas canteen or a book title is not campus food evidence. */
export function matchesQueryFocus(
  focus: QueryFocus,
  evidence: Evidence,
  query = "",
) {
  if (!focus) return true;
  const title = evidence.title || "";
  const body = evidence.contentSnippet ?? evidence.snippet ?? "";
  if (/广外|广东外语外贸大学/.test(query)) {
    if (
      /LSE|伦敦|留学|中山大学|华南理工|广州大学(?!城)/i.test(title) &&
      !/广外.{0,8}(?:食堂|饭堂|美食)|文采园|博雅园|风采园/.test(title)
    )
      return false;
    const south = /大学城|南校/.test(query),
      north = /白云|北校/.test(query);
    if (
      south &&
      !north &&
      /白云|北校/.test(title) &&
      !/大学城|南校/.test(title)
    )
      return false;
    if (
      north &&
      !south &&
      /大学城|南校/.test(title) &&
      !/白云|北校/.test(title)
    )
      return false;
  }
  if (focus === "food") {
    const venue =
      /食堂|饭堂|餐厅|餐馆|档口|[一二三四]饭|文采园|博雅园|风采园|云雅园|干饭|美食(?:攻略|推荐|测评)/;
    if (/书展|新书|馆藏|索书号|留学|LSE|伦敦/.test(title) && !venue.test(title))
      return false;
    return (
      venue.test(title) ||
      (venue.test(body) &&
        /好吃|不好吃|推荐|口味|味道|餐饮|菜品|菜单|窗口|楼|人均|价格|元|份|饭|面/.test(
          body,
        ))
    );
  }
  if (focus === "housing")
    return /宿舍|寝室|入住|住宿|南苑\d+栋|北苑\d+栋/.test(title + body);
  return /社团|协会|漫协|二次元|动漫|ACG|cosplay/i.test(
    title + " " + (evidence.sourceName || "") + body,
  );
}
export function hasExperienceEvidence(
  focus: QueryFocus,
  evidence: Evidence,
  query = "",
) {
  if (!matchesQueryFocus(focus, evidence, query)) return false;
  const text =
    (evidence.title || "") +
    " " +
    (evidence.contentSnippet ?? evidence.snippet ?? "");
  return focus === "food"
    ? /好吃|不好吃|难吃|口味|味道|口感|测评|踩雷|亲测|探店|(?:菜品|饭菜|美食|档口|餐品).{0,6}推荐|推荐.{0,6}(?:菜|饭|面|餐)/.test(
        text,
      )
    : /入住体验|住后感|隔音|居住体验|亲测|踩雷/.test(text);
}
/** University Town is the app's default map context, not an inferred GPS position. */
export function campusFoodQuery(query: string) {
  if (queryFocus(query) !== "food") return query;
  if (/广外|广东外语外贸大学/.test(query))
    return /南校|北校|大学城|白云/.test(query)
      ? query
      : "广外大学城校区；" + query;
  if (
    /南校|北校|大学城|白云山/.test(query) &&
    !/中山大学|华南理工|广州大学(?!城)|中大|华工|暨大/.test(query)
  )
    return "广外；" + query;
  if (
    /大学|学院|校区|中大|华工|暨大|北京|上海|深圳|广州|天河|白云|南校|北校/.test(
      query,
    )
  )
    return query;
  return "广外大学城校区；" + query;
}
