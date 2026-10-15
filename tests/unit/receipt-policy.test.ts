import { it, expect } from "vitest";
import {
  receiptPollDelay,
  RECEIPT_QUERY_SOFT_LIMIT,
} from "@/lib/server/assistant/receipt-policy";
it("bounds slow-client receipt checks while reserving D1 finalization headroom", () => {
  let elapsed = 0,
    polls = 0;
  while (elapsed < 15000) elapsed += receiptPollDelay(polls++);
  expect(polls).toBeLessThanOrEqual(22);
  expect(RECEIPT_QUERY_SOFT_LIMIT).toBeLessThan(45);
  expect(receiptPollDelay(0)).toBe(250);
  expect(receiptPollDelay(99)).toBe(750);
});
