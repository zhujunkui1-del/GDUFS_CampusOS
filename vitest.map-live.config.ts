import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/map-skills-live.test.ts"],
    environment: "node",
    testTimeout: 70000,
    fileParallelism: false,
  },
});
