// Leave room under D1 Free's per-invocation query limit for finalization.
export const RECEIPT_QUERY_SOFT_LIMIT = 40;
export function receiptPollDelay(attempt: number, includesRetrieval = false) {
  // RAG uses part of the same 50-query invocation allowance. Leave the
  // existing total guard in place and poll less often while the map mounts.
  const step = includesRetrieval ? 500 : 250;
  return Math.min(
    includesRetrieval ? 1500 : 750,
    step * (Math.max(0, attempt) + 1),
  );
}
