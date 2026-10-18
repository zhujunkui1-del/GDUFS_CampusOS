// Remove presentation tracking only. Identity/signature parameters are retained.
export function canonicalArticleUrl(raw: string) {
  const u = new URL(raw);
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (
      /^utm_/i.test(key) ||
      (u.hostname === "mp.weixin.qq.com" &&
        ["scene", "from", "isappinstalled"].includes(key.toLowerCase()))
    )
      u.searchParams.delete(key);
  if (new Set(u.searchParams.keys()).size === [...u.searchParams.keys()].length)
    u.searchParams.sort();
  return u.toString();
}
