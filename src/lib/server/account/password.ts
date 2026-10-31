import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
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
  const result = await deriveRaw(password, salt);
  // Runtime tail supplies actual CPU/wall duration; the application clock can
  // remain frozen during CPU work. Never report its misleading zero duration.
  console.info(
    JSON.stringify({
      event: "account.kdf",
      algorithm: "pbkdf2-sha256-v1",
      iterations,
      implementation: nativeSupported ? "webcrypto" : "noble",
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
