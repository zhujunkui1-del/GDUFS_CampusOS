# 本地地图修订截图（2026-10-13）

22张JPEG均来自实际运行的网站，固定OSM版本 `s1-2026-10-13.6`，Workers生产构建本地预览 `http://127.0.0.1:3000/map`。未使用生成式图片、地图SDK模拟物或假路线作为截图。原上级目录高德底图图像为历史版本。

| 文件                                                | 状态与条件                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| chrome-desktop-initial / msedge-desktop-initial.jpg | 安装版Chrome/Edge引擎，1440×900；默认朝北、倾斜38°、两区整体入镜，无启动高德请求                              |
| chrome-mobile-initial / msedge-mobile-initial.jpg   | 相同浏览器引擎390×844视口，实际本地地图；不是手机实机                                                         |
| chrome-desktop-drag / msedge-desktop-drag.jpg       | 2D教学区放大后实际拖动，标记位移验证；图像不是路线结果                                                        |
| chrome-mobile-drag / msedge-mobile-drag.jpg         | 小屏实际拖动、缩放验证，独立测试配置                                                                          |
| iab-overview.jpg                                    | 内置浏览器1280×720，默认北向倾斜全校区；模型尚为平面轮廓                                                      |
| iab-teaching.jpg                                    | 教学区放大，真实复合建筑及标注                                                                                |
| iab-living.jpg                                      | 生活区放大，来源宿舍/食堂标注；17栋住宿楼宇可搜索                                                             |
| iab-sports.jpg                                      | 体育館周边放大，场地、泳池、球场来源几何；部分分类仍待核验                                                    |
| iab-shiyuan-search.jpg                              | 四栋师苑名称按负责人逐项回复展示                                                                              |
| iab-shiyuan-details.jpg                             | 师苑3栋真实地物定位、高亮、来源及入口未核验状态                                                               |
| iab-ai-open.jpg                                     | 浮动AI面板展开，地图保持满屏底层；AI服务未接入，禁用聊天，无伪造答复                                          |
| iab-min-zoom-2d / iab-min-zoom-25d.jpg              | 两模式缩至允许下限，固定数据范围；自动化另检查旋转/边缘拖动后的地面四角                                       |
| iab-mobile-home.jpg                                 | 内置浏览器390×844，地图首页和底部导航                                                                         |
| iab-mobile-ai.jpg                                   | AI底部抽屉，无实际模型服务                                                                                    |
| iab-mobile-details.jpg                              | 学术交流中心复合轮廓与小屏详情，内庭保持空洞                                                                  |
| local-map-real-online-route.jpg                     | 实际高德PlaceSearch/Walking受控调用，图书馆附近同区选点，186米/约2分钟；检查端点/校区范围，当前通行未实地核验 |
| mobile-real-online-route.jpg                        | 上述实际路线在同一浏览器调整为390×844后的重排；没有再次请求供应商，不代表手机实机手势/FPS通过                 |

四个 `*-metrics.json` 保存浏览器/视口、加载时间、拖动反馈时间、初始朝向和供应商请求数。计时含本地服务与独立测试配置，不作为公网延迟/FPS承诺。`real-online-service-result.json` 只保留该次路线摘要和测试条件，不含密钥或整库供应商数据。

常规回归只模拟在线服务，真实本地地图渲染没有模拟。真实在线测试仅显式启用 `CAMPUS_LIVE_SERVICES=1`，凭据留在被忽略的本地配置。
