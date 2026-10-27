// Owner maintenance only. The cloud provider verifies source identity before saving.
import fs from "node:fs/promises";
const directory = ".map-tools/xhs-provider-eval";
if (process.argv[2] !== "--next-account")
  throw Error(
    "Explicit --next-account is required; original account sync is disabled",
  );
const secrets = JSON.parse(
  await fs.readFile(directory + "/cloud-eval-secrets.json", "utf8"),
);
const state = JSON.parse(
  await fs.readFile(directory + "/next-account-session.json", "utf8"),
);
if (state.authenticatedPlatform !== "xhs")
  throw Error("A confirmed mainland session is required");
const response = await fetch(
  "https://campusos-xhs-redbook-eval.zhujunkui1.workers.dev/session/import",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + secrets.SERVICE_TOKEN,
    },
    body: JSON.stringify({ state }),
    signal: AbortSignal.timeout(90000),
  },
);
const result = await response.json();
const receipt = {
  at: new Date().toISOString(),
  httpStatus: response.status,
  imported: result.imported === true,
  authenticated: result.authenticated === true,
  status: result.status,
  httpRequests: result.httpRequests,
};
await fs.writeFile(
  directory + "/session-sync-receipt.json",
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify(receipt));
if (!receipt.imported) process.exitCode = 2;
