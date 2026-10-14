# 浏览器窗口检查截图

- `chrome-production/`、`msedge-production/`：本地生产Workers的最终原生缩放/窗口矩阵，每组尺寸、DPR、画布/物理缓冲、面板及端点位置和像素扫描值在`measurements.json`。
- `short-window-final.png`：普通窗口1000×650、页面缩放150%的最终正常界面。
- `short-window-closed.png`：同一窗口关闭导航后的界面。
- 其他矩阵PNG启用了仅供测试的洋红背景探针，正常渲染会完全盖住它；最终正常界面截图已移除探针。
- `camera-before/short-450.png`与`measurements.json`：最终视角约束修订前，路线端点底部154px越过面板顶部148.65px的实际失败证据。
- `copyright-before/short-450-selection.png`与`measurements.json`：短窗口中署名被遮挡的实际命中检查失败证据。

测试使用公开校园地点教学B与实验C，不是用户设备定位。探索阶段其他文件夹只保留本地，不纳入本次正式证据。

底图：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) · ODbL；校园补绘来源见项目DATA_SOURCES.md。
