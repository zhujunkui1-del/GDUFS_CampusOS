/**
 * Canonical place-text normalization shared by the map service and the
 * navigation intent parser. Two copies of this rule used to drift: the service
 * converted 南苑七栋 → 南苑7栋 while the intent parser did not, so
 * 「从南苑七栋到假草场」arrived with no origin and fell back to article search.
 */
const DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function chineseNumber(text: string): number | undefined {
  const digits = DIGITS;
  if (text.includes("十")) {
    const value = (digits[text[0]] || 1) * 10 + (digits[text.at(-1)!] || 0);
    return value;
  }
  return digits[text];
}

/** Numeric prefixes that belong to a building name, not to a sentence. */
const BUILDING_NUMBER =
  /([南北师友]苑)([一二三四五六七八九十]+)(?=栋|号楼|楼)/g;

export function normalizePlaceText(input: string) {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(BUILDING_NUMBER, (_all, prefix: string, number: string) => {
      const value = chineseNumber(number);
      return value ? prefix + value : prefix + number;
    });
}
