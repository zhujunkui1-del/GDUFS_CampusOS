import fs from "node:fs/promises";
await fs.mkdir("services/xhs-redbook-eval/build", { recursive: true });
await fs.copyFile(
  "scripts/evaluate-redbook.mjs",
  "services/xhs-redbook-eval/build/evaluate-redbook.mjs",
);
