// Maintenance CLI transport only. Credentials go through stdin, never argv/logs/files.
import { execFileSync } from "node:child_process";
export async function previewCloudflareJson(url, token, body) {
  const target = new URL(url);
  const graphql =
    target.pathname === "/client/v4/graphql" &&
    /^\s*query\b/.test(body?.query || "");
  if (
    target.origin !== "https://api.cloudflare.com" ||
    (!target.pathname.startsWith("/client/v4/accounts/") && !graphql)
  )
    throw Error("Cloudflare maintenance URL refused");
  let result;
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    result = await response.json();
  } catch {
    // Windows TLS/proxy fallback, one attempt. No credential in a shell command.
    const proxy = process.env.HTTPS_PROXY;
    if (
      process.platform !== "win32" ||
      !proxy ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(proxy)
    )
      throw Error("Cloudflare connection unavailable; credentials withheld");
    const lines = [
      `url = ${JSON.stringify(url)}`,
      `request = ${JSON.stringify(body ? "POST" : "GET")}`,
      `header = ${JSON.stringify("Authorization: Bearer " + token)}`,
      `header = ${JSON.stringify("Content-Type: application/json")}`,
    ];
    if (body) lines.push(`data = ${JSON.stringify(JSON.stringify(body))}`);
    try {
      result = JSON.parse(
        execFileSync(
          "curl.exe",
          [
            "--silent",
            "--show-error",
            "--max-time",
            "30",
            "--proxy",
            proxy,
            "--config",
            "-",
          ],
          {
            input: lines.join("\n") + "\n",
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          },
        ),
      );
    } catch {
      throw Error("Cloudflare connection unavailable; raw output withheld");
    }
  }
  if (graphql) {
    if (result.errors?.length)
      throw Error(
        "Cloudflare GraphQL metrics unavailable; raw errors withheld",
      );
    return result.data;
  }
  if (!result.success)
    throw Error(
      "Cloudflare API rejected maintenance request; raw output withheld",
    );
  return result.result;
}
