export function referenceChapterOffsets(title: string, text: string) {
  if (text.length < 5400 || !/手册|指南汇编|规章汇编|制度汇编/.test(title))
    return [];
  const byChapter = new Map<string, number>();
  for (const match of text.matchAll(
    /^[ \t]{0,8}(?:#{1,4}[ \t]*)?(第[〇零一二三四五六七八九十百\d]+[章节编篇])[^\n]{0,70}$/gm,
  ))
    byChapter.set(match[1], match.index);
  const offsets = [...byChapter.values()].sort((a, b) => a - b);
  return offsets.length > 1 ? offsets : [];
}
