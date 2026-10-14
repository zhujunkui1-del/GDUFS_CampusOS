import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { verifyDefaultModel } from "@/lib/server/models/verify";

test.skipIf(process.env.MODEL_LIVE_TEST !== "1")(
  "real DeepSeek: bounded diagnostic tool loop, stream and validated JSON",
  async () => {
    const result = await verifyDefaultModel({
      apiKey: process.env.MODEL_API_KEY,
      model: process.env.MODEL_NAME,
      baseUrl: process.env.MODEL_BASE_URL,
    });
    expect(result.evidence.requests).toBe(3);
    await mkdir("test-results", { recursive: true });
    await mkdir("docs/verification/s2-a", { recursive: true });
    await writeFile(
      "test-results/model-capability-receipt.json",
      JSON.stringify(result.receipt),
    );
    await writeFile(
      "docs/verification/s2-a/model-live.json",
      JSON.stringify(result.evidence, null, 2) + "\n",
    );
  },
);
