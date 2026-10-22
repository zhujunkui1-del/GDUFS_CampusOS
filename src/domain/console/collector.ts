import { z } from "zod";
import { ConsoleIdSchema } from "./contracts";

export const CollectorArticleSchema = z
  .object({
    requestId: z.string().uuid(),
    sourceId: ConsoleIdSchema,
    accountId: z.string().regex(/^MP_WXS_\d+$/),
    title: z.string().trim().min(1).max(300),
    url: z.string().url().max(2000),
    publishedAt: z.iso.datetime({ offset: true }),
    sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    observedAt: z.iso.datetime({ offset: true }),
    readingHtml: z.string().min(1).max(1500000),
    renderingVersion: z.literal(2),
    mediaOmitted: z.boolean().default(false),
    provenance: z.enum(["local_export", "publisher_export"]),
  })
  .strict();

export function canonicalWechatUrl(raw: string) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "mp.weixin.qq.com" ||
    u.port ||
    u.username ||
    u.password
  )
    throw new Error("原文地址必须是微信公众号的 HTTPS 文章链接。");
  const short = u.pathname.match(/^\/s\/([\w~\-]{15,100})$/);
  if (short)
    return "https://mp.weixin.qq.com/s/" + short[1].replaceAll("~", "_");
  if (u.pathname !== "/s") throw new Error("无法识别公众号文章地址。");
  const p = new URLSearchParams();
  for (const key of ["__biz", "mid", "idx", "sn"]) {
    const value = u.searchParams.get(key);
    if (!value || !/^[\w=+/-]{1,150}$/.test(value))
      throw new Error("公众号长链接缺少文章标识。");
    p.set(key, value);
  }
  return "https://mp.weixin.qq.com/s?" + p.toString();
}
