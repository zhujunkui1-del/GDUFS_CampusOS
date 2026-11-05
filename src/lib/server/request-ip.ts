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
    const tail = value.slice(value.lastIndexOf(":") + 1);
    if (!isIpv4(tail)) return false;
    return groups.length <= 7;
  }
  return true;
}

export function normalizeClientIp(raw: string | null | undefined) {
  const value = raw?.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  const unwrapped =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return isIpv4(unwrapped) || isIpv6(unwrapped) ? unwrapped : null;
}

function secureEqual(left: string, right: string) {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

/**
 * Trust a client IP forwarded by the Vercel gateway only when it proves
 * possession of the shared proxy secret. Requests hitting the Worker directly
 * always fall back to Cloudflare's unspoofable CF-Connecting-IP.
 */
export function trustedClientIp(
  request: Request,
  proxySecret: string | undefined,
) {
  const token = request.headers.get("x-campusos-proxy-secret");
  if (
    proxySecret &&
    proxySecret.length >= 32 &&
    proxySecret.length <= 128 &&
    token &&
    token.length <= 128 &&
    secureEqual(token, proxySecret)
  ) {
    const forwarded = normalizeClientIp(
      request.headers.get("x-campusos-client-ip"),
    );
    if (forwarded) return forwarded;
  }
  return normalizeClientIp(request.headers.get("cf-connecting-ip"));
}
