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
    : cssTimeMilliseconds(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--transition-map",
        ),
      );
}
export function cssTimeMilliseconds(value: string) {
  const time = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/);
  return time ? Number(time[1]) * (time[2] === "s" ? 1000 : 1) : 600;
}
