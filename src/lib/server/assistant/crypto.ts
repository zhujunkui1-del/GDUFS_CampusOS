import { ApiError } from "../errors";
export async function tokenHash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(text: string) {
  return Uint8Array.from(
    atob(text.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
}
export function randomToken() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signData(value: unknown, secret: string) {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), body);
  return encode(body) + "." + encode(new Uint8Array(signature));
}
export async function verifyData(
  ticket: string,
  secret: string,
): Promise<unknown> {
  try {
    if (ticket.length > 60000) throw new Error();
    const [payload, signature, extra] = ticket.split(".");
    if (!payload || !signature || extra) throw new Error();
    const bytes = decode(payload);
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(signature),
        bytes,
      ))
    )
      throw new Error();
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ApiError("FORBIDDEN", "路线凭证无效，请重新规划。");
  }
}
