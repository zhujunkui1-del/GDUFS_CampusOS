// Matches the existing --ease-out token: cubic-bezier(.23, 1, .32, 1).
export function mapEase(t: number) {
  let low = 0,
    high = 1;
  for (let i = 0; i < 20; i++) {
    const u = (low + high) / 2,
      x =
        3 * (1 - u) * (1 - u) * u * 0.23 +
        3 * (1 - u) * u * u * 0.32 +
        u * u * u;
    if (x < t) low = u;
    else high = u;
  }
  return 1 - (1 - (low + high) / 2) ** 3;
}
export function cameraDuration() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--transition-normal",
        ),
      ) || 220;
}
