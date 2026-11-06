import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { verifyDefaultModel } from "@/lib/server/models/verify";
import { GDUFS_POLICY_VERSION } from "@/lib/server/models/deepseek";

// Owner-supplied credential lives in the workspace delivery file, never in Git.
function gdufsCredential() {
  const text = readFileSync("CampusOS_Codex_完整设计文档_v2/anykey.md", "utf8");
  const section = text.split("gdufs API")[1] || "";
  const key = section.match(/sk-[A-Za-z0-9_-]{20,}/)?.[0];
  const baseUrl = section.match(
    /https:\/\/modelsq\.gdufs\.edu\.cn\/v1-openai/,
  )?.[0];
  if (!key || !baseUrl) throw new Error("Missing gdufs credential");
  return { provider: "gdufs" as const, apiKey: key, baseUrl, model: "DeepSeek-V4.1-Flash-1017" };
}

test.skipIf(process.env.GDUFS_LIVE_TEST !== "1")(
  "real campus gateway: diagnostic tool loop, streaming and validated JSON",
  async () => {
    const credential = gdufsCredential();
    const result = await verifyDefaultModel(credential);
    expect(result.evidence.requests).toBe(3);
    expect(result.receipt.policyVersion).toBe(GDUFS_POLICY_VERSION);
    await mkdir("docs/verification/s2-a", { recursive: true });
    await writeFile(
      "docs/verification/s2-a/gdufs-model.json",
      JSON.stringify(result.evidence, null, 2) + "\n",
    );
    await writeFile(
      ".tmp/gdufs-model-receipt.json",
      JSON.stringify(result.receipt) + "\n",
    );
  },
  30000,
);
