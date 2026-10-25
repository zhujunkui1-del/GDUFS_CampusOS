const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function sourcePublicationDate(value: string | null) {
  if (!value) return "发布日期未知";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? dateFormat.format(date)
    : "发布日期未知";
}
