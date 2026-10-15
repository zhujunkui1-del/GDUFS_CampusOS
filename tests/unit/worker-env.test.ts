import { it, expect } from "vitest";
import { publicWorkerEnvironment } from "../../scripts/worker-env.mjs";

const output = (values: Record<string, string>) =>
  ["production", "development", "test"]
    .map((mode) => `export const ${mode} = ${JSON.stringify(values)};`)
    .join("\n");
it("keeps only explicitly public variables in all generated modes", () => {
  const result = publicWorkerEnvironment(
    output({
      MODEL_API_KEY: "private-fixture-key",
      AGENT_SIGNING_SECRET: "private-signing-fixture",
      MODEL_NAME: "model-fixture",
      NEXT_PUBLIC_APP_NAME: "CampusOS",
    }),
  );
  expect(result.content).not.toContain("private");
  expect(result.content).not.toContain("MODEL_NAME");
  expect(result.content.match(/CampusOS/g)).toHaveLength(3);
  expect(result.privateValues).toEqual([
    "private-fixture-key",
    "private-signing-fixture",
  ]);
});
it("accepts empty environments and retains no credential defaults", () => {
  expect(publicWorkerEnvironment(output({}))).toEqual({
    content: output({}) + "\n",
    privateValues: [],
  });
});
it("does not evaluate generated code", () => {
  expect(() =>
    publicWorkerEnvironment("export const production = (() => {throw 1})();"),
  ).toThrow();
});
it("rejects missing or changed adapter exports", () => {
  expect(() =>
    publicWorkerEnvironment(output({}).replace("development", "unexpected")),
  ).toThrow();
});
it("rejects non-string environment values", () => {
  expect(() =>
    publicWorkerEnvironment(output({}).replace("{}", '{"VALUE":123}')),
  ).toThrow();
});
it("fails closed if a secret-like name is placed in a public variable", () => {
  expect(() =>
    publicWorkerEnvironment(
      output({ NEXT_PUBLIC_MODEL_API_KEY: "fixture-secret" }),
    ),
  ).toThrow();
});
