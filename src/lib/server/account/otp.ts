import { ApiError } from "../errors";
export function emailCode() {
  let n: number;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= 4294000000);
  return String(n % 1000000).padStart(6, "0");
}
export async function codeDigest(
  secret: string,
  purpose: string,
  challenge: string,
  code: string,
) {
  if (secret.length < 32)
    throw new ApiError("SERVICE_UNAVAILABLE", "邮箱验证暂不可用。", true);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${purpose}|${challenge}|${code}`),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function sameDigest(a: string, b: string) {
  if (a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}
