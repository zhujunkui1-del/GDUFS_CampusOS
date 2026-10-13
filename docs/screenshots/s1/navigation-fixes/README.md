# 导航反馈修复：真实浏览器证据

最终生产构建与本地Workers3000。数据s1-2026-10-14.1 / s1-campus-2026-10-14.1；没有概念图或模拟路线。Chrome最终证据在chrome-release，Edge最终证据在edge-release。

- *-b-to-c.png / *-render.json：608×871窄屏、实际262米B→实验C路线、单个语心桥标签、简洁面板；画布尺寸与视口、DPR和#ECF0EF连续像素检验。不代表原灰框环境的根因已确定。
- *-device-start.png：以既有公开北苑1栋坐标模拟设备位置，虚线到近邻步道后实线跨区，实际本地路网。不是个人GPS或物理手机截图。
- *-motion.json：实际DOM标签每帧位置，生产解析时长600ms，连续中间位置且前快后慢；不是只检查CSS声明，不据此宣称实机FPS。
- desktop/mobile-dorm-to-teaching-route.jpg、navigation-gps-denied.jpg：真实宿舍→教学路径与专注界面，GPS权限拒绝是明确测试配置。
- desktop/mobile-bridges.jpg、parking.jpg、octagonal-building.jpg：实际短名标签/原几何；地图三橋共用一个标签，停车场/八角楼仍保留源位置。
- map-feedback与tunnel-confirmed子目录：其他真实地图操作与隧道回归。

手机390×844/DPR3、桌面1440×900以及反馈窄屏608×871，均是已安装Chrome/Edge的隔离浏览器上下文。没有读取用户原浏览器账号/历史或保存个人位置。核心测试条件文件沿用公开来源路网/受控GPS说明；在线供应商结果仅在明确测试场景有隔离夹具。

校门坐标下一对话讨论。当前地图与路径的可运行验证见../../../S1_NAVIGATION_FIXES_ACCEPTANCE.md。

其他目录/根目录文件为诊断期间的中间回归截图与帧数据，不作为最终交付状态；自动审批阻止批量删除，保留本机可审计记录并在本机Git排除中忽略，不纳入本轮提交。此前里程碑目录已恢复原提交内容。
