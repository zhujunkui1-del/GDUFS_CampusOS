import { readFile, writeFile } from "node:fs/promises";
const directory = "docs/performance/dormitory-2026-10-15";
const data = JSON.parse(await readFile(directory + "/summary.json", "utf8"));
const colors = { baseline: "#a7afb5", optimized: "#1261bb" };
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="540" viewBox="0 0 1120 540"><rect width="1120" height="540" fill="#fff"/><g font-family="Segoe UI,Microsoft YaHei,sans-serif" fill="#1d1d1f"><text x="38" y="40" font-size="23" font-weight="600">宿舍复制场景：绘制调用与CPU提交</text><text x="38" y="68" font-size="14" fill="#66727a">Edge · RTX4070 Laptop · 三轮对照 · 不是手机实机数据</text>`;
for (let panel = 0; panel < 2; panel++) {
  const x = 65 + panel * 540;
  const title = panel
    ? "模型CPU提交（桌面，ms/帧）"
    : "模型层Draw Calls（桌面，含阴影）";
  const max = panel ? 2.5 : 750;
  svg += `<text x="${x}" y="112" font-size="17" font-weight="600">${title}</text>`;
  for (let t = 0; t <= 5; t++) {
    const y = 420 - t * 52;
    svg += `<line x1="${x}" y1="${y}" x2="${x + 435}" y2="${y}" stroke="#e7ecee"/><text x="${x - 10}" y="${y + 5}" text-anchor="end" font-size="12">${((max * t) / 5).toFixed(panel ? 1 : 0)}</text>`;
  }
  for (const [i, count] of [1, 10, 30, 60].entries())
    for (const [j, variant] of ["baseline", "optimized"].entries()) {
      const row = data.cases.find(
        (r) =>
          r.viewport.name === "desktop" &&
          r.count === count &&
          r.variant === variant,
      );
      const value = panel
        ? row.actions.drag.modelCpuSubmitMsMean
        : row.actions.drag.modelDrawsMean;
      const height = (value / max) * 260,
        bx = x + 30 + i * 105 + j * 32;
      svg += `<rect x="${bx}" y="${420 - height}" width="26" height="${height}" rx="3" fill="${colors[variant]}"/><text x="${bx + 13}" y="${412 - height}" font-size="11" text-anchor="middle">${value.toFixed(panel ? 2 : 0)}</text>`;
      if (j === 0)
        svg += `<text x="${bx + 30}" y="446" font-size="13" text-anchor="middle">${count}栋</text>`;
    }
}
svg += `<rect x="430" y="474" width="18" height="12" fill="#a7afb5"/><text x="456" y="486" font-size="13">优化前</text><rect x="548" y="474" width="18" height="12" fill="#1261bb"/><text x="574" y="486" font-size="13">优化后</text><text x="38" y="520" font-size="12" fill="#66727a">几何与材质不变；优化后采用跨建筑实例批处理及静态阴影缓存。数据来自summary.json。</text></g></svg>`;
await writeFile(directory + "/comparison.svg", svg);
