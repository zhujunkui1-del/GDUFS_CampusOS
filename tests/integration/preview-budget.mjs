// Read-only account balance delta, never a supplier invoice or a top-up.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});
const before = JSON.parse(
  readFileSync(".map-tools/s2-e/balance-before.json", "utf8"),
);
const r = await fetch("https://api.deepseek.com/user/balance", {
  headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
  signal: AbortSignal.timeout(10000),
});
const j = await r.json();
const now = j.balance_infos?.find((x) => x.currency === "CNY");
if (!r.ok || !now)
  throw Error(
    "Cannot verify approved model budget; no further model calls allowed",
  );
const spent = Math.max(
  0,
  Number(before.total_balance) - Number(now.total_balance),
);
const result = {
  recordedAt: new Date().toISOString(),
  budgetCny: 1,
  accountBalanceDecreaseCny: Math.round(spent * 1e8) / 1e8,
  remainingApprovedBudgetCny: Math.max(0, 1 - spent),
  isProjectInvoice: false,
  mayIncludeConcurrentAccountUsage: true,
  chargedExistingBalanceOnly: true,
  topUpPerformed: false,
};
writeFileSync(
  "docs/verification/s2-e/model-budget.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
if (spent >= 1 || !j.is_available) process.exitCode = 1;
