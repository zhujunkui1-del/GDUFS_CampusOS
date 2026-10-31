import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ApiError } from "../errors";
const iterations = 600000;
const bytes = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) =>
  Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));
let nativeSupported = true;
async function deriveRaw(password: string, salt: Uint8Array) {
  if (nativeSupported) {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        bytes(password),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      return new Uint8Array(
        await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            salt: new Uint8Array(salt),
            iterations,
            hash: "SHA-256",
          },
          key,
          256,
        ),
      );
    } catch (error) {
      // Workers may cap its native PBKDF2 count. Keep the same 600k algorithm, never weaken it.
      if (
        !/iterations?|100000|unsupported|not supported/i.test(
          error instanceof Error ? error.message : "",
        )
      )
        throw error;
      nativeSupported = false;
    }
  }
  return pbkdf2Async(sha256, bytes(password), salt, {
    c: iterations,
    dkLen: 32,
    asyncTick: 8,
  });
}
async function derive(password: string, salt: Uint8Array) {
  const start = Date.now();
  const result = await deriveRaw(password, salt);
  // Workers advances its clock across I/O; do not log credential material.
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.info(
    JSON.stringify({
      event: "account.kdf",
      algorithm: "pbkdf2-sha256-v1",
      iterations,
      implementation: nativeSupported ? "webcrypto" : "noble",
      elapsedMs: Date.now() - start,
    }),
  );
  return result;
}
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256-v1$${iterations}$${hex(salt)}$${hex(await derive(password, salt))}`;
}
export async function verifyPassword(password: string, stored: string) {
  const m = /^pbkdf2-sha256-v1\$600000\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(
    stored,
  );
  if (!m) return false;
  const actual = await derive(password, unhex(m[1])),
    expected = unhex(m[2]);
  let different = 0;
  for (let i = 0; i < 32; i++) different |= actual[i] ^ expected[i];
  return different === 0;
}
// Same-cost negative login verification; never a usable credential or account.
export const DUMMY_PASSWORD_HASH =
  "pbkdf2-sha256-v1$600000$83963bafe1a24414b9e7923e00a9bf46$6f2cbb738d68bca1b936fae30e7ad821de1a7bd7e2525fc8cd713bd384d063a0";
const common = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "qwertyuiop",
  "abcdefgh",
  "11111111",
  "00000000",
  "87654321",
  "iloveyou",
  "admin123",
  "campusos",
  "campusos123",
]);
export async function checkPassword(
  password: string,
  username: string,
  transport: typeof fetch = fetch,
) {
  if (
    common.has(password.toLowerCase()) ||
    /^(.)\1+$/.test(password) ||
    password.toLowerCase() === username.toLowerCase()
  )
    throw new ApiError(
      "INVALID_ARGUMENT",
      "密码过于常见，请更换一个更难猜的密码。",
    );
  const digest = hex(
    new Uint8Array(await crypto.subtle.digest("SHA-1", bytes(password))),
  ).toUpperCase();
  let response: Response;
  try {
    response = await transport(
      "https://api.pwnedpasswords.com/range/" + digest.slice(0, 5),
      {
        headers: {
          "Add-Padding": "true",
          "User-Agent": "CampusOS-Password-Safety",
        },
        signal: AbortSignal.timeout(7000),
        redirect: "error",
      },
    );
  } catch {
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "密码安全检查暂不可用，请稍后重试。",
      true,
    );
  }
  if (!response.ok)
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "密码安全检查暂不可用，请稍后重试。",
      true,
    );
  const text = await response.text();
  if (text.length > 300000)
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "密码安全检查暂不可用，请稍后重试。",
      true,
    );
  const lines = text.trim().split(/\r?\n/);
  if (
    lines.length < 100 ||
    lines.some((line) => !/^[A-Fa-f0-9]{35}:\d+$/.test(line))
  )
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "密码安全检查暂不可用，请稍后重试。",
      true,
    );
  if (
    lines.some((line) => {
      const [suffix, count] = line.split(":");
      return suffix.toUpperCase() === digest.slice(5) && Number(count) > 0;
    })
  )
    throw new ApiError(
      "INVALID_ARGUMENT",
      "该密码存在已知泄露记录，请更换密码。",
    );
}
