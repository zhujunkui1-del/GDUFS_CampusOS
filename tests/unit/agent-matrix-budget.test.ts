import { expect, it, vi } from "vitest";
import { createMatrixTransport } from "../fixtures/agent-matrix-budget";
it("reserves failed calls and blocks over-budget requests before transport", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("timeout"));
  const budget = createMatrixTransport(6000, transport);
  const init = {
    body: JSON.stringify({
      max_tokens: 1024,
      messages: [{ content: "人工智能" }],
    }),
  };
  await expect(
    budget.transport("https://example.invalid", init),
  ).rejects.toThrow("timeout");
  await expect(
    budget.transport("https://example.invalid", init),
  ).rejects.toMatchObject({ code: "RUN_LIMIT_EXCEEDED" });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(budget.usage()).toMatchObject({ calls: 1, rejected: 1 });
  await expect(
    budget.transport("https://example.invalid", { body: "{}" }),
  ).rejects.toThrow("output cap");
});
