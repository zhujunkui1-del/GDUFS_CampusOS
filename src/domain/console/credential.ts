// Only public derivation parameters. Neither passwords nor derived keys persist
// in the browser. CPU-heavy stretching runs on the login device, not a Worker.
export type ConsoleCredentialDerivation = {
  version: "pbkdf2-sha256-v1";
  salt: string;
};
export const CONSOLE_PASSWORD_ITERATIONS = 600000;
export async function deriveConsoleCredential(
  password: string,
  parameters: ConsoleCredentialDerivation,
) {
  if (
    parameters.version !== "pbkdf2-sha256-v1" ||
    !/^[a-f0-9]{64}$/.test(parameters.salt) ||
    !password ||
    password.length > 200
  )
    throw Error("管理员登录配置无效，请刷新后重试。");
  const salt = Uint8Array.from(parameters.salt.match(/../g)!, (s) =>
    parseInt(s, 16),
  );
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: CONSOLE_PASSWORD_ITERATIONS,
    },
    material,
    256,
  );
  return [...new Uint8Array(result)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
