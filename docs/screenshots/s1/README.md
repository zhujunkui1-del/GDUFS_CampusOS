# S1 真实浏览器截图

日期：2026-10-13；地址：http://127.0.0.1:8787/map；Next生产构建 + 本地Cloudflare Workers，真实高德SDK和平台地图凭据。**没有使用测试SDK、生成式概念图或假路线。**

主要桌面视口1440×900，手机390×844，横屏844×390。手机为桌面Chromium的视口检查，不是iPhone/Safari或Android实机，更不是FPS证明。截图中的AI服务尚未接入、入口待核验等是真实阶段状态。

| 文件                      | 功能状态/测试条件                                                  |
| ------------------------- | ------------------------------------------------------------------ |
| desktop-overview-25d.jpg  | 两区全景；原生高德2.5D，保留真实道路/水体/绿地和供应商楼块         |
| desktop-min-zoom.jpg      | 缩小操作受动态下限限制；地图铺满，未露灰边                         |
| desktop-edge-drag.jpg     | 大幅拖动后受限制区域约束，仍满屏                                   |
| rotation-check.jpg        | 旋转操作后地图仍满屏；普通桌面尺寸                                 |
| desktop-teaching.jpg      | 教学区快捷视角与标注                                               |
| desktop-living.jpg        | 生活区快捷视角；宿舍数据来自OSM，未补猜13栋                        |
| desktop-sports-layer.jpg  | 体育图层设置及场地标注；数量是来源对象数，不是当前设施总量         |
| desktop-live-poi.jpg      | 真正返回的高德南校图书馆在线POI；不保存为自有数据库                |
| desktop-place-details.jpg | 图书馆聚焦/高亮、来源与实际缺项、详情按钮                          |
| desktop-ai-open.jpg       | 助理展开，带选中地点上下文；模型服务仍未接入                       |
| desktop-route.jpg         | 高德实际规划的教学区道路选点路线，291米、约4分钟；非建筑入口到入口 |
| mobile-home.jpg           | 手机首页/全屏地图/搜索/底部导航                                    |
| mobile-min-zoom.jpg       | 手机缩小到下限，地图仍铺满                                         |
| mobile-ai-drawer.jpg      | AI底部抽屉；当前地点上下文保留，服务未接入                         |
| mobile-place-details.jpg  | 地点详情底部抽屉与来源/入口缺项                                    |
| mobile-route.jpg          | 同一实际291米路线，窗口变化后按导航抽屉真实尺寸重新避让            |
| mobile-landscape.jpg      | 横屏无水平溢出，控件适配，地图仍满屏                               |

路线回传几何检查包括：有实际路径和正距离/时间、首尾距选点不超过80米、所有路径点位于选定校区分区。不能由此声称门禁/建筑入口或实际校园开放条件已实地验收。跨区隧道未核验，没有提供伪造跨区结果。

这些截图供当前阶段审核；校园完整资料、实机双指手势/键盘/FPS、线上HTTPS及完整Agent/Skill闭环仍有缺项，见 `../../S1_ACCEPTANCE.md`。
