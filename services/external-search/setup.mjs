// Dedicated local XHS session; credentials never enter command arguments.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, "runtime");
await fs.mkdir(path.join(runtime, "data"), { recursive: true });
const configPath = path.join(runtime, "config.json");
let config;
try {
  config = JSON.parse(await fs.readFile(configPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT")
    throw Error(
      "Local configuration is invalid; existing credentials were preserved.",
    );
  config = {
    gatewayToken: randomBytes(32).toString("base64url"),
    upstreamToken: randomBytes(32).toString("base64url"),
    upstreamUrl: "http://127.0.0.1:18060",
    port: 18071,
    xhsProvider: "persistent-edge",
  };
  await fs.writeFile(configPath, JSON.stringify(config), {
    flag: "wx",
    mode: 0o600,
  });
  await fs.writeFile(
    path.join(runtime, "upstream.env"),
    [
      "AUTH_TOKEN=" + config.upstreamToken,
      "COOKIES_PATH=/app/data/cookies.json",
      "HOME=/app/data/home",
      "XDG_CONFIG_HOME=/app/data/config",
    ].join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
const action = process.argv[2] || "init";
if (action === "init") {
  if (config.xhsProvider === "persistent-edge") {
    console.log(
      JSON.stringify({
        provider: "persistent-edge",
        profilePersistent: true,
        requiresDocker: false,
        next: "Start the local gateway and runner, then use login to open the dedicated browser.",
      }),
    );
    process.exit(0);
  }
  const exists =
    spawnSync("docker", ["container", "inspect", "campusos-xhs-search"], {
      stdio: "ignore",
    }).status === 0;
  const result = spawnSync(
    "docker",
    exists
      ? ["start", "campusos-xhs-search"]
      : [
          "run",
          "-d",
          "--name",
          "campusos-xhs-search",
          "--restart",
          "unless-stopped",
          "-p",
          "127.0.0.1:18060:18060",
          "--env-file",
          path.join(runtime, "upstream.env"),
          "--mount",
          "type=bind,source=" +
            path.join(runtime, "data") +
            ",target=/app/data",
          "xpzouying/xiaohongshu-mcp@sha256:5bc690d0c7907f069886ddeb6b37abbe4bdd37bd431975b914c7c27435b1b602",
        ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (result.status !== 0)
    throw Error(
      "Docker service did not start; check Docker Desktop. Raw output withheld.",
    );
  console.log(
    JSON.stringify({
      service: "campusos-xhs-search",
      started: true,
      loopbackOnly: true,
    }),
  );
} else if (action === "status" || action === "login") {
  if (config.xhsProvider === "persistent-edge") {
    const r = await fetch(
      "http://127.0.0.1:" +
        config.port +
        "/v1/session/" +
        (action === "login" ? "open" : "status"),
      {
        method: "POST",
        headers: { Authorization: "Bearer " + config.gatewayToken },
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = await r.json();
    console.log(
      JSON.stringify({
        loggedIn:
          data.state === "logged_in"
            ? true
            : data.state === "login_required"
              ? false
              : null,
        state: data.state || "unknown",
        provider: "persistent-edge",
        profilePersistent: true,
      }),
    );
    process.exit(0);
  }
  const response = await fetch(
    config.upstreamUrl +
      "/api/v1/login/" +
      (action === "login" ? "qrcode" : "status"),
    {
      headers: { Authorization: "Bearer " + config.upstreamToken },
      signal: AbortSignal.timeout(15000),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.success)
    throw Error("XHS login service unavailable.");
  if (action === "status")
    console.log(
      JSON.stringify({ loggedIn: result.data?.is_logged_in === true }),
    );
  else {
    const data = result.data?.img?.split(",")[1];
    if (!data) throw Error("No login QR returned.");
    const target = path.join(runtime, "login-qr.png");
    await fs.writeFile(target, Buffer.from(data, "base64"), { mode: 0o600 });
    console.log(
      JSON.stringify({
        qrPath: target,
        expiresIn: result.data?.timeout,
        loggedIn: result.data?.is_logged_in === true,
      }),
    );
  }
} else throw Error("Use init, status or login.");
