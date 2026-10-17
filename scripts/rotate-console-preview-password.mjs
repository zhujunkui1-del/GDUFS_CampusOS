// Explicit owner-requested preview credential rotation. No plaintext in argv/logs.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pbkdf2Sync, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
const base = "https://campusos-preview.zhujunkui1.workers.dev";
const input = "CampusOS_Codex_完整设计文档_v2/key.md";
const privateFile = ".map-tools/s3-a/preview-secrets.json";
const dir = ".map-tools/console-password";
let phase = "validate";
try {
  assertPreviewTarget(
    parse(readFileSync("wrangler.jsonc", "utf8")),
    process.env.CLOUDFLARE_ACCOUNT_ID,
  );
  const password = readFileSync(input, "utf8")
    .replace(/^\uFEFF/, "")
    .trim();
  if (password.length < 10 || password.length > 200 || /[\r\n]/.test(password))
    throw Error();
  execFileSync("git", ["check-ignore", "--", input], { stdio: "ignore" });
  const values = JSON.parse(readFileSync(privateFile, "utf8"));
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify({
        dryRun: true,
        target: "campusos-preview",
        inputPresent: true,
        passwordPrinted: false,
      }),
    );
  } else {
    mkdirSync(dir, { recursive: true });
    const planFile = dir + "/rotation-plan.json";
    const plan = existsSync(planFile)
      ? JSON.parse(readFileSync(planFile, "utf8"))
      : { salt: randomBytes(32).toString("hex") };
    const derived = pbkdf2Sync(
      password,
      Buffer.from(plan.salt, "hex"),
      600000,
      32,
      "sha256",
    ).toString("hex");
    const verifier = createHash("sha256").update(derived).digest("hex");
    if (plan.verifier && plan.verifier !== verifier) throw Error();
    writeFileSync(planFile, JSON.stringify({ salt: plan.salt, verifier }), {
      mode: 0o600,
    });
    const send = async (path, method = "GET", body, headers = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: base,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    };
    phase = "preflight";
    const initial = await send("/api/console-auth");
    if (initial.status !== 200) throw Error();
    const alreadyApplied =
      initial.data.data.credentialDerivation?.salt === plan.salt;
    if (initial.data.data.credentialDerivation && !alreadyApplied)
      throw Error();
    const oldKey =
      values.CONSOLE_AUTH_MODE === "admin_password"
        ? null
        : values.CONSOLE_ADMIN_ACCESS_KEY;
    const oldLogin =
      !alreadyApplied && oldKey
        ? await send("/api/console-auth", "POST", { key: oldKey })
        : null;
    if (oldLogin && oldLogin.status !== 200) throw Error();
    if (!alreadyApplied) {
      phase = "secret-bulk";
      execFileSync(
        process.execPath,
        [
          "node_modules/wrangler/bin/wrangler.js",
          "secret",
          "bulk",
          "--config",
          "wrangler.jsonc",
          "--env",
          "preview",
        ],
        {
          input: JSON.stringify({
            CONSOLE_AUTH_MODE: "admin_password",
            CONSOLE_CREDENTIAL_SALT: plan.salt,
            CONSOLE_ADMIN_ACCESS_KEY: verifier,
          }),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
          windowsHide: true,
        },
      );
    }
    phase = "verify";
    const meta = await send("/api/console-auth");
    if (meta.data.data.credentialDerivation?.salt !== plan.salt) throw Error();
    const login = await send("/api/console-auth", "POST", { key: derived });
    if (login.status !== 200 || !login.cookie) throw Error();
    const oldKeyStatus = oldKey
      ? (await send("/api/console-auth", "POST", { key: oldKey })).status
      : null;
    const oldSessionStatus = oldLogin?.cookie
      ? (
          await send("/api/admin/content", "GET", undefined, {
            Cookie: oldLogin.cookie,
          })
        ).status
      : null;
    const verifierReplayStatus = (
      await send("/api/console-auth", "POST", { key: verifier })
    ).status;
    if (
      (oldKeyStatus !== null && oldKeyStatus !== 401) ||
      (oldSessionStatus !== null && oldSessionStatus !== 401) ||
      verifierReplayStatus !== 401
    )
      throw Error();
    const logout = await send("/api/console-auth", "DELETE", undefined, {
      Cookie: login.cookie,
      "X-Console-CSRF": login.data.data.csrf,
    });
    if (logout.status !== 200) throw Error();
    phase = "sync-private-config";
    writeFileSync(
      privateFile,
      JSON.stringify(
        {
          ...values,
          CONSOLE_AUTH_MODE: "admin_password",
          CONSOLE_CREDENTIAL_SALT: plan.salt,
          CONSOLE_ADMIN_ACCESS_KEY: verifier,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    const oldHandoff = ".map-tools/s3-b-final/admin-login-key.txt";
    if (existsSync(oldHandoff))
      writeFileSync(oldHandoff, password + "\n", { mode: 0o600 });
    const report = {
      recordedAt: new Date().toISOString(),
      target: "campusos-preview",
      alreadyApplied,
      scheme:
        "PBKDF2-SHA256 (600000, browser) -> SHA256 verifier (Worker Secret)",
      newLoginStatus: login.status,
      oldKeyStatus,
      oldSessionStatus,
      verifierReplayStatus,
      newSessionLogoutStatus: logout.status,
      plaintextStoredInWorkerOrReport: false,
      otherResourcesChanged: false,
    };
    mkdirSync("docs/verification/s3-b-final", { recursive: true });
    const reportFile = "docs/verification/s3-b-final/password-rotation.json";
    writeFileSync(
      existsSync(reportFile)
        ? reportFile.replace(".json", `-recheck-${Date.now()}.json`)
        : reportFile,
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  }
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      phase,
      target: "campusos-preview",
      reason:
        "Rotation/check incomplete; raw secrets and network errors withheld. Do not reset data or weaken login limits.",
    }),
  );
  process.exitCode = 1;
}
