const campusText = /南校|大学城校区|北校|白云山校区/;
const uncertainty =
  /无法(?:确认|核实|判断)|不能(?:确认|核实|判断|据此)|尚未|未能(?:确认|核实)|未(?:确认|核实)|不代表|没有.*(?:依据|名单)/;
/** Article venues cannot establish a person's campus assignment. */
export function removeUnsupportedPersonnelCampuses(
  answer: string,
  excerpts: string[],
) {
  const supported = (value: string) => {
    const normalize = (s: string) => s.replace(/\[来源\d+\]|[*#\s]/g, "");
    const claim = normalize(value);
    return (
      claim.length > 5 && excerpts.some((e) => normalize(e).includes(claim))
    );
  };
  let removed = false;
  const cleaned = answer
    .replace(/[（(]([^()（）]*)[）)]/g, (whole, inner: string) => {
      if (
        !campusText.test(inner) ||
        uncertainty.test(inner) ||
        supported(inner)
      )
        return whole;
      const fields = inner
        .split(/[,，;；]/)
        .filter((field: string) => !campusText.test(field));
      removed = true;
      return fields.length ? "（" + fields.join("，") + "）" : "";
    })
    .split(/\n/)
    .map((line) =>
      line
        .split(/(?<=[。！？!?])/)
        .filter((sentence) => {
          if (
            !campusText.test(sentence) ||
            uncertainty.test(sentence) ||
            supported(sentence)
          )
            return true;
          removed = true;
          return false;
        })
        .join(""),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!removed) return answer;
  return (
    (cleaned || "已取得相关官方任职资料，请查看下方来源。") +
    "\n\n个人校区归属尚未核实，不能用讲座举办地推断。"
  );
}

export function qualifyCampusRosterAnswer(
  answer: string,
  question: string,
  sources: readonly { title: string; snippet: string; citation: number }[] = [],
) {
  if (
    !/首席专家|校长|院长|书记|教授|院士|导师/.test(question) ||
    !/有哪些|有谁|名单|哪几位/.test(question)
  )
    return answer;
  const campus = /大学城|南校/.test(question)
    ? "南校（大学城校区）"
    : /白云山|北校/.test(question)
      ? "北校（白云山校区）"
      : null;
  if (!campus || !answer.trim()) return answer;
  if (sources.length) {
    const role =
      question.match(/首席专家|校长|院长|书记|教授|院士|导师/)?.[0] ||
      "首席专家";
    const selected = sources
      .filter((source) => source.snippet.includes(role))
      .slice(0, 3);
    if (selected.length)
      return (
        `尚未核实${campus}的独立人员名单。下面仅提供相关官网资料，不把其中人名自动归入该校区或同一种职务名单：\n\n` +
        selected
          .map((source) => {
            const anchor = source.snippet.indexOf(role);
            const start =
              source.snippet.length <= 40 ? 0 : Math.max(0, anchor - 30);
            const quote = source.snippet.slice(start, start + 40);
            return `- ${source.title}[来源${source.citation}]\n  原文节选：“${start ? "…" : ""}${quote}${start + 40 < source.snippet.length ? "…" : ""}”`;
          })
          .join("\n\n")
      );
  }
  return `尚未核实${campus}的独立人员名单。本次未取得足以核实名单的官网正文，不据此列出人选。`;
}
