// Formatting variants of the same title are not different search subjects.
const titleSeparators = [
  " ",
  "\u00a0",
  "“",
  "”",
  "‘",
  "’",
  "《",
  "》",
  "「",
  "」",
  "#",
  "＃",
  "|",
  "｜",
  "，",
  ",",
  "。",
  ".",
  "!",
  "！",
  "?",
  "？",
  ":",
  "：",
  ";",
  "；",
  "、",
  "_",
];
export function articleTitleKey(title: string) {
  return titleSeparators
    .reduce((text, separator) => text.split(separator).join(""), title)
    .toLowerCase();
}
export function articleTitleSql(column: "d.title") {
  return `lower(${titleSeparators.reduce((sql, separator) => `replace(${sql},'${separator}','')`, column as string)})`;
}
