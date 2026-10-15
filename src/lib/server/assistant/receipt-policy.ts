// Leave room under D1 Free's per-invocation query limit for finalization.
export const RECEIPT_QUERY_SOFT_LIMIT = 40;
export function receiptPollDelay(attempt: number) {
  return Math.min(750, 250 * (Math.max(0, attempt) + 1));
}
