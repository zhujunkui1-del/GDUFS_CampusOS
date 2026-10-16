// Calibrate a fresh browser sample to the challenge response's server clock.
// This is only a timestamp calculation: the server still enforces the owned,
// single-use nonce, 30s expiry, accuracy and campus bounds on every request.
export function locationCaptureTime(
  serverTime: number,
  elapsedMs: number,
  sampleAgeMs: number,
) {
  if (
    ![serverTime, elapsedMs, sampleAgeMs].every(Number.isFinite) ||
    serverTime <= 0 ||
    elapsedMs < 0 ||
    elapsedMs > 30000 ||
    sampleAgeMs < -1000 ||
    sampleAgeMs > 30000
  )
    throw new Error("定位已过期，请重新定位。");
  return Math.round(serverTime + elapsedMs - Math.max(0, sampleAgeMs));
}
