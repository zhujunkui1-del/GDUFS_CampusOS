# 导航滚动合成异常证据

- `edge-dev-small-before.jpg`：受控608×440视口、2D总览，导航外框滚动时出现地物遮挡。
- `edge-overflow-clip-probe.jpg`：单变量临时关闭外框滚动，地物恢复。
- `edge-overflow-restored.jpg`：恢复外框滚动，异常再次出现。
- `edge-split-scroll-stable.jpg`：固定外框、内部滚动，地物正常。
- `edge-inner-scroll-end.jpg`：内部滚动后标题/关闭按钮仍可见，地物正常。
- `edge-production-final.jpg`：生产构建在同一Edge配置中的最终检查。

图像来自连接浏览器的显示截图；视口覆盖用于控制复现尺寸，不等同于本轮重新测试所有原生窗口缩放组合。没有个人GPS、账号资料或第三方供应商截图。其他探索截图仅保留本地。

底图：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) · ODbL；校园补绘来源见项目DATA_SOURCES.md。
