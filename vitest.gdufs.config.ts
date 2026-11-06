import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/gdufs-live.test.ts"],
    environment: "node",
    testTimeout: 40000,
    fileParallelism: false,
  },
});
