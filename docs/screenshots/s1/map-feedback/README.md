# 本轮地图批注截图（2026-10-13）

全部 JPEG 来自真实网站浏览器渲染，固定本地OSM版本s1-2026-10-13.7；不是生成图。站点为127.0.0.1:3000的Cloudflare Workers生产构建预览。地图加载/拖动及素材截图没有供应商或GPS夹具；受控导航/定位功能测试中的Mock结果未截图作为实际导航。

| 文件                                                   | 状态与测试条件                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| chrome/msedge-desktop-initial、drag                    | 官方安装的Chrome/Edge，1440×900；真实加载、默认朝北、拖动、缩放和边缘约束；启动高德请求0。           |
| chrome/msedge-mobile-initial、drag                     | 手机视口390×844、DPR3，JPEG1170×2532；桌面浏览器移动仿真，非手机硬件FPS/GPS证据。                    |
| desktop/mobile-teaching-labels                         | 教学F栋详情与复合体标签，真实原始轮廓；分栋边界未生成。                                              |
| desktop/mobile-sports-labels                           | 已按负责人批注核对的羽毛球场与周边设施；不包含尚缺几何的北側篮球场。                                 |
| desktop/mobile-dormitory-details                       | 友苑归宿舍楼栋；入口/开放时间缺项如实显示。                                                          |
| desktop/mobile-tunnel-labels                           | 下沉广场、隧道与两端标注；不是已完成跨区导航结果。                                                   |
| desktop/mobile-navigation-form                         | 输入/地图点选/我的位置/交换/确认规划真实界面；空表单没有伪造线路。                                   |
| desktop/mobile-ai-panel                                | 实际全局AI面板/底部抽屉，未接入状态如实显示，未生成假对话。                                          |
| local-map-real-online-route                            | 真实高德Walking：输入图书馆→教学楼D栋，164米约2分钟；1440×900，端点为附近道路，现场入口/开放未核验。 |
| mobile-real-online-route                               | 同一实际路线在390×844重新排布；没有新增规划请求。未点击GPS导航，不宣称现场定位成功。                 |
| desktop-overview、desktop-lab-details、desktop-youyuan | Codex浏览器1280×720实际总览、实验C栋详情和友苑分类补充。                                             |

共25张JPEG。metrics.json为实际初始化/拖动响应计时，不等于FPS；real-online-service-result.json为真实服务摘要，不含凭据/设备个人位置。体育馆北侧篮球场已由负责人考证撤销，改为停车场；停车场/语心湖三桥源几何与现场GPS仍缺。隧道真实路线已另存tunnel-confirmed。

## 通行确认后的更新

下沉隧道通行现已由负责人确认，真实234米走廊路线截图另见../tunnel-confirmed。本目录的隧道标签/详情和导航表单已按最新状态重截图。北侧篮球场经考证不存在，当前停车场；仍缺停车场与语心湖三桥的源几何，原“缺北侧篮球场”结论撤销。
