export function routePadding(width: number, height: number) {
  const box = (selector: string) =>
    Array.from(document.querySelectorAll(selector))
      .map((el) => el.getBoundingClientRect())
      .find((rect) => rect.width > 0 && rect.height > 0);
  const top = box(".navigation-direction") || box(".map-top"),
    panel = box(".route-planner"),
    summary = box(".navigation-summary"),
    footer = box(".mobile-navigation"),
    controls = box(".navigation-controls") || box(".map-controls"),
    sidebar = box(".sidebar");
  let t = (top?.height ? top.bottom : 20) + 18;
  let b = Math.max(
      30,
      footer?.height ? height - footer.top + 15 : 0,
      summary?.height ? height - summary.top + 15 : 0,
    ),
    l = sidebar?.width ? sidebar.right + 20 : 20;
  const r = controls?.width ? width - controls.left + 15 : 30;
  if (height <= 500 && summary?.height && top?.height) {
    l = Math.max(l, top.right + 20, summary.right + 20);
    t = 20;
    b = 20;
  }
  if (panel?.height) {
    if (panel.width > width * 0.6) b = Math.max(b, height - panel.top + 20);
    else l = Math.max(l, panel.right + 20);
  }
  if (t + b > height - 80) b = Math.max(20, height - t - 80);
  if (l + r > width - 80) l = Math.max(20, width - r - 80);
  return { top: t, bottom: b, left: l, right: r };
}
