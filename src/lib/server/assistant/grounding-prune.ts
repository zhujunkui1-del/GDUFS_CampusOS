// When the evidence judge still reports unsupported details after one repair,
// the answer ships only if those details are removed. Shipping the whole answer
// would turn "the source does not say this" into a campus fact, and refusing
// the whole answer would hide the parts that are supported.
const CITATION = /[\[【](?:来源\s*)?\d+[\]】]/g;
const NUMBER = /\d+(?:\.\d+)?\s*(?:分|个月|月|日|号|年|元|天|周|次|人|%|％)/g;
const QUOTED = /[“"「]([^”"」]{2,40})[”"」]/g;
// Generic wording of the judge itself, not a claim anchor.
const JUDGE_NOISE =
  /本轮资料|资料未|未提及|无此内容|没有提及|未写明|不对应|引用编号|资料编号|答复|原文|缺少|无法核实|归为|混淆/g;

function distinctiveTerms(text: string) {
  const clean = text.replace(CITATION, "").replace(JUDGE_NOISE, "");
  const terms = new Set<string>();
  for (const run of clean.match(/[\p{Script=Han}]{4,}/gu) ?? [])
    for (let i = 0; i + 4 <= run.length; i++) terms.add(run.slice(i, i + 4));
  return [...terms];
}

function anchors(issues: string[]) {
  const quoted = new Set<string>();
  const numbers = new Set<string>();
  const terms = new Set<string>();
  for (const issue of issues) {
    for (const match of issue.matchAll(QUOTED)) quoted.add(match[1]);
    for (const match of issue.replace(CITATION, "").matchAll(NUMBER))
      numbers.add(match[0].replace(/\s+/g, ""));
    for (const term of distinctiveTerms(issue)) terms.add(term);
  }
  return { quoted: [...quoted], numbers: [...numbers], terms: [...terms] };
}

function unsupported(sentence: string, anchor: ReturnType<typeof anchors>) {
  const plain = sentence.replace(CITATION, "");
  const compact = plain.replace(/\s+/g, "");
  if (anchor.quoted.some((quote) => compact.includes(quote))) return true;
  if (
    anchor.numbers.some((number) =>
      compact.includes(number.replace(/\s+/g, "")),
    )
  )
    return true;
  const shared = anchor.terms.filter((term) => compact.includes(term)).length;
  return shared >= 2;
}

export const GROUNDING_GAP_ANSWER =
  "本轮资料不足以核实这条回答里的关键细节，暂时不能给出可靠结论。可以补充具体文件或换一个更具体的问题。";

export function pruneUnsupported(answer: string, issues: string[]) {
  if (!issues.length) return answer;
  const anchor = anchors(issues);
  const sentences = answer.split(/(?<=[。！？；\n])/);
  const kept = sentences.filter(
    (sentence) => !sentence.trim() || !unsupported(sentence, anchor),
  );
  const text = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
  // A list whose every line was unsupported leaves numbering and citations
  // with nothing behind them; an honest gap is better than that shell.
  const substantive = text
    .replace(CITATION, "")
    .replace(/[^\p{Script=Han}A-Za-z]/gu, "");
  return substantive.length < 6 ? GROUNDING_GAP_ANSWER : text;
}
