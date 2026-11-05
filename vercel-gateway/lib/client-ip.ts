const MAX_LENGTH = 64;

function isIpv4(value: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  return value.split(".").every((part) => Number(part) <= 255);
}

function isIpv6(value: string) {
  if (value.length > 45 || !value.includes(":")) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
  const double = value.indexOf("::");
  if (double !== -1 && value.indexOf("::", double + 2) !== -1) return false;
  const groups = value.split(":").filter(Boolean);
  if (groups.length > 8) return false;
  if (value.includes(".")) {
    return isIpv4(value.slice(value.lastIndexOf(":") + 1));
  }
  return true;
}

export function normalizeClientIp(raw: string | null | undefined) {
  const value = raw?.split(",")[0]?.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  const unwrapped =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return isIpv4(unwrapped) || isIpv6(unwrapped) ? unwrapped : null;
}

/** Vercel overwrites X-Forwarded-For; prefer its dedicated header. */
export function clientIpFromRequest(request: Request) {
  return normalizeClientIp(
    request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("x-forwarded-for"),
  );
}
