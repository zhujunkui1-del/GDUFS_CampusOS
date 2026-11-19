/**
 * Student shorthand shared by every consumer of a place name.
 *
 * The map dataset stored only full names, so one module understood
 * 「第一教学楼」 while another matched nothing when a student typed 「一教」.
 * That made the same building two identities depending on which module resolved
 * it. Deriving the aliases from the canonical name keeps the two campus files
 * from drifting apart, and these aliases widen search text only: no place,
 * coordinate or source is added.
 */
const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

function placeAliases(name: string): string[] {
  // 「第一教学楼」 → 「一教」: students never repeat the full name mid-sentence.
  const numbered = name.match(/^第([一二三四五六七八九])教学楼$/) as
    | RegExpMatchArray
    | null;
  if (numbered) {
    const numeral = numbered[1];
    return [`${numeral}教`, `${numeral}教楼`, `${NUMERALS.indexOf(numeral) + 1}教`];
  }
  // 「教学楼A栋」 → 「A栋」: the letter already identifies the building.
  const lettered = name.match(/^教学楼([A-Za-z])栋$/);
  if (lettered) return [`${lettered[1]}栋`, `教学楼${lettered[1]}`];
  // 「云山学1栋」 must keep its prefix: bare 「1栋」 belongs to another site.
  return [];
}

/** Aliases derivable from any canonical name without touching the dataset snapshot. */
export function sharedPlaceAliases(name: string): string[] {
  return placeAliases(name);
}

/** Merge derived aliases with any aliases already stored in the dataset. */
export function mergePlaceAliases(
  name: string,
  stored: readonly string[] = [],
): string[] {
  return [...new Set([...stored, ...sharedPlaceAliases(name)])];
}
