const paymentObject = /(?:费用|(?<!免)费|欠款|账单|购电|充值)/;

export function asksPaymentProcedure(query: string) {
  return (
    /(?:缴费|交费|充值|购电|支付)(?:的)?(?:方式|步骤|渠道|入口|地点|流程)/.test(
      query,
    ) ||
    (paymentObject.test(query) &&
      /(?:怎么|如何|怎样|在哪(?:里|儿)?|到哪(?:里|儿)?|去哪(?:里|儿)?)(?:去|才能|能)?(?:交(?!流|换|接|代)|缴|充值|充(?=$|[\s？?。！!])|付|支付|购电|办理)/.test(
        query,
      ))
  );
}

export function paymentSubjects(query: string, topics: readonly string[]) {
  if (!topics.includes("水电费")) return topics;
  if (/热水/.test(query)) return ["热水"];
  if (/水[、和与及]?电|电[、和与及]?水/.test(query)) return ["水电", "电水"];
  if (/电费|购电/.test(query)) return ["电费", "购电", "水电"];
  if (/水费/.test(query)) return ["冷水", "水电"];
  return topics;
}

export function asksUtilityPayment(query: string) {
  return (
    asksPaymentProcedure(query) &&
    /水电|水费|电费|购电/.test(query) &&
    !/热水|空调|冷气/.test(query)
  );
}

export function campusUtilityQueries(query: string) {
  if (!asksUtilityPayment(query)) return null;
  const south = /大学城|南校/.test(query);
  const north = /白云山|北校/.test(query);
  if (south !== north) return null;
  const subject = query
    .replace(/白云山(?:校区)?|大学城(?:校区)?|南校(?:区)?|北校(?:区)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    `大学城校区 ${subject}`.slice(0, 300),
    `白云山校区 ${subject}`.slice(0, 300),
  ];
}

export function campusUtilityAnswerQuestion(query: string) {
  const queries = campusUtilityQueries(query);
  return queries
    ? `请分别说明大学城校区和白云山校区的办理办法：${queries[0].replace(/^大学城校区 /, "")}`
    : query;
}

const channel =
  /(?:缴费|交费|充值|购电)(?:服务)?(?:地点|地址|渠道|入口|方式)\s*[:：]\s*[^。；\n]{1,42}|(?:到|前往)[^。；\n]{1,42}(?:缴费|交费|充值|购电)|(?:进入|打开|点击|选择)[^。；\n]{1,42}(?:缴费|交费|充值|购电)/g;
const campusName = /白云山(?:校区)?|北校(?:区)?|大学城(?:校区)?|南校(?:区)?/g;

export function paymentChannelEvidence(
  text: string,
  campus: "south" | "north" | null,
  subjects: readonly string[] = [],
) {
  let best = { score: 0, at: 0 };
  for (const match of text.matchAll(channel)) {
    const at = match.index;
    const nearby = text
      .slice(Math.max(0, at - 115), at + match[0].length + 30)
      .replace(/[\s#、]/g, "");
    if (
      subjects.length &&
      !subjects.some((term) => nearby.includes(term.replace(/[\s、]/g, "")))
    )
      continue;
    const explicitlyNamed = match[0].match(campusName)?.[0];
    const heading = [
      ...text.slice(Math.max(0, at - 280), at).matchAll(campusName),
    ].at(-1)?.[0];
    const name = explicitlyNamed || heading;
    const scope = name ? (/大学城|南校/.test(name) ? "south" : "north") : null;
    if (campus && scope && campus !== scope) continue;
    const score = scope && scope === campus ? 2 : 1;
    if (score > best.score) best = { score, at };
  }
  return best;
}
