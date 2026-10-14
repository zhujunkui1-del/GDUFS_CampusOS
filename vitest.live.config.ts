import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/model-live.test.ts"],
    environment: "node",
    testTimeout: 25000,
    fileParallelism: false,
  },
});
