# 地图稳定性与兼容性专项（2026-11-04）

**状态：渲染修复已按负责人后续明确授权同步到主站，线上回归通过；校园网访问链路仍待独立验收。**

## 范围与版本

渲染修复实现提交：9545d63。

从本地8895e9a继续，保留同期4eb9d16图标提交及既有功能。未改GIS、113个地点、547节点/2202边路网、南苑7栋及其他GLB、账号、私人会话或业务D1。无数据库迁移。

实际核实gdufs.ccwu.cc仍指向campusos-preview，D1为18299abc-b38b-4494-8d12-8ab4d482c304。隔离验收阶段没有发布到该共享Worker；后续负责人明确要求“同步到主站”后已完成同步，详见文末。DNS、路由和WAF未改变。独立测试Worker为campusos-map-compat-20261104，仅有ASSETS绑定，无D1、账号、模型凭据及定时任务；按负责人要求增加独立子域名[map-test.gdufs.ccwu.cc/map](https://map-test.gdufs.ccwu.cc/map)。当前版本a9e1b15e-f476-4a05-baa0-90d44f0c8bd5。域名与绑定回执见[deployment-isolation.json](verification/map-stability-2026-11-04/deployment-isolation.json)。

**此测试站只有地图，导航中的雷达、知识、日历、账号等页面没有部署，访问这些入口会404；不代表原站相应模块被删除。**完整校园功能仍在原站。

## 已证明的断点

1. 原适配器将deviceMemory小于4GB直接视为不支持3D，并同时禁用2.5D；与实际WebGL能力无关。
2. 无WebGL2时原页面进入错误状态，没有可用的基础渲染路径。已用同一故障注入测试记录旧版失败、新版可搜索地点。
3. 原2D启动会预取Three.js及南苑7栋GLB，完整GeoJSON加载也是地图ready的前置条件。
4. 原资源到达后重建全校园合批；原始GLB Promise缓存没有容量上限。现改为逐资产只准备一次批次、模式切换复用。
5. 原context-lost/restored仅修改状态标记，缺少恢复失败后的可用路径。
6. 模型哈希URL原响应仍为max-age=0；公共HTML响应包含一年s-maxage。现给验证过的模型配置精确immutable规则，Preview HTML要求重验证；私人no-store/JSON响应保持原策略。

最初工作站12次HTTP采样全部200，没有观察到403/429/5xx；同一Preview地图TTFB约8.96秒与2.25秒，不能由此认定所有打不开都来自WebGL。样本使用工作站及其代理出口，不是国内运营商对照。详细DNS/TLS/TTFB、gzip、ETag和缓存回执见[network-baseline.json](verification/map-stability-2026-11-04/network-baseline.json)。2.56MB底图传输约470KB gzip，静态Worker约143KB gzip，均观察到CDN HIT。

真机测试中临时trycloudflare隧道明确返回Unauthorized: Tunnel not found，曾导致测试地址整体不可达，已停用。workers.dev也被用户报告在其网络需要VPN，因此改用自有域名子域名。不能将这两次测试基础设施问题冒充产品浏览器兼容性结论。

其他设备仍有无法加载的反馈。已有回执证明部分设备取得HTML，但CSS可耗时34秒，尚停在初始化；另一些设备已完整加载。仍需区分DNS/TLS/网络错误、资源传输和JS初始化，尚无证据证明所有失败同因。负责人表示稍后补充失败设备原始提示，本项继续开放。

## 实现

- create-renderer先实际创建WebGL2、绘制并readPixels验证，记录纹理/属性/渲染缓冲上限。内存提示和粗指针只调整并发及像素比。
- Canvas2D适配器与WebGL适配器共用CampusRenderer业务契约、地点ID、搜索、已批准几何、路径服务、路线快照和MapAction。支持拖动、双指/滚轮缩放、地点详情和步行路线；Path2D缓存与视野裁剪避免逐帧重新投影全部底图。此路径不导入MapLibre或Three。
- WebGL在style.load后即提供轻量真实校园几何、地点与操作，完整GeoJSON在后台补齐；2D不加载GLB或Three模型层。模型仅按用户模式选择加载。
- Context Lost时暂停自定义绘制，恢复沿用Three及MapLibre状态；8秒未恢复或连续超过2次丢失，重建为基础地图，恢复路线、选择及图层，不刷新整页。
- GLB缓存最多8MiB，单文件最多4MiB，检查HTTP/HTML错误、尺寸、GLB2头及SHA；失败可由显式操作重试，没有无限循环。批次保留原有几何、材质和实例化，纹理身份参与材质键，卸载释放资源。
- 首个视野LOD方案被负责人实机发现移出中心后退2.5D，**已取消并不属于最终版本**。最终2D/2.5D/3D只随用户选择；完整3D资产保持驻留，平移不改wanted集合，不退白模/2.5D。资源控制改用2/3加载并发、1.5/2像素比上限和实际慢帧时的有限像素比下调，最低1，不改模型几何。

主要文件：adapters/{create-renderer,render-capability,renderer-contract,basic-map-adapter,local-map-adapter}.ts；data/{plan-campus-route,model-budget}.ts；layers/{campus-building-model-layer,nanyuan7-model-layer,model-asset-cache}.ts；campus-map-provider.tsx；map-view-buttons.tsx；map/page.tsx；preview-worker.ts；document-cache.ts；public/_headers。

## 后续模型接入

prepare-map-runtime在启动/构建时调用verify-map-model-assets。当前60项资产检查通过，59个不同URL；主目录轻量模型1,112,912字节/19,141三角面，完整模型4,140,052字节/209,236三角面。三角数从GLTF mesh/索引/实例扩展实际计算，与清单逐项一致；南苑7栋旧资产SHA不变。

新增食堂、门诊部等模型必须使用内容哈希URL、单文件自包含GLB、准确清单及边界，运行`node scripts/verify-map-model-assets.mjs --write`同步精确缓存规则。当前门槛为单模型轻量1万/完整5万三角面，全部轻量4MiB/15万三角面、全部完整8MiB/30万三角面。新纹理需先纳入解码内存预算，当前目录无纹理；不能只凭压缩文件大小默认安全。超过预算会使构建失败，应先优化资产并补同设备回归，不能通过清单数字造假或丢掉已完成建筑。容量门槛不代表所有GPU均达相同FPS。

## 前后对照

Windows无节流、Chrome headless、相同1440×900、独立生产Next服务器、回环网络；每版3组冷/热缓存。不是国内网络、真机GPU或30分钟负载结论。原始数据：[performance-chrome.json](verification/map-stability-2026-11-04/performance-chrome.json)。

| 指标（中位数）   | 旧版8895e9a |     修复版 |
| ---------------- | ----------: | ---------: |
| 冷缓存地图ready  |       616ms |      530ms |
| 热缓存地图ready  |       444ms |      169ms |
| 完整底图冷加载   |       644ms |      828ms |
| 完整底图热加载   |       451ms |      536ms |
| 初始解码JS       |  4,028,253B | 3,397,766B |
| 初始2D GLB请求   |           1 |          0 |
| 首次2.5D就绪     |       353ms |      286ms |
| 首次3D就绪       |       637ms |      436ms |
| 最终完整3D组数   |  28+独立南7 | 28+独立南7 |
| 切换后驻留资产数 |          57 |         57 |
| 观测绘制调用     |         189 |        251 |
| 观测上下文丢失   |           0 |          0 |

地图能提前用不等于完整底图传输更快。逐楼缓存减少重复CPU合批，但绘制调用增加；不能声称所有GPU指标改善。V8 heap不包含GPU/原生内存，受GC影响，当前没有可靠GPU峰值或长时内存泄漏结论。字体三个WOFF2原件合计约13MB，未改变字体，仍是冷启动传输成本。

## 验证与限制

- tsc、改动TS/TSX/MJS ESLint零警告、完整OpenNext Worker构建/1675文件凭据扫描通过。全仓npm run lint扫描.map-tools生成文件后中断，退出1、无成功汇总，**不记为通过**；未修改忽略规则掩盖。
- 单元914/914（130文件）。新增7项覆盖共享请求、HTML冒充GLB、篡改、格式、缓存逐出、公共HTML/私有API缓存边界及预算。
- 最终Chrome桌面+手机视口28/28，Edge桌面14/14：无WebGL2、慢GeoJSON、低内存提示仍可立体、损坏模型、context恢复/基础降级、完整3D平移不降档、南7外观/点选、模式切换、搜索及真实本地路网导航。**手机视口不是实机**。
- 独立子域名最终版完整3D平移测试1/1通过；兼容性5项2通过/3初始化等待5–6秒超时，失败保留。更早workers.dev测试5/5不替代此结果。公网可靠性未通过。
- 用户操作真实Redmi Turbo 3/Android15（Pnp及UA交叉证据），本人手机/电脑Google、Edge、微信直连可显示2.5D/3D，用户确认完整3D平移正常。脱敏回执有28组高细节、pending=0、无脚本错误，移动绘制回调均值约12.1–12.8ms；这是回调间隔，不是屏幕呈现FPS保证。另有Chrome130实机完成渲染，也有其他设备仍在loading。见[real-device-results.json](verification/map-stability-2026-11-04/real-device-results.json)。
- 夸克按负责人最新要求不阻塞；QQ/iPhone Safari未实际验收，移动/联通/电信/校园Wi-Fi未完成独立运营商矩阵，不虚构覆盖。长期运行、热机、GPU峰值仍待测。
- MapAction/路线快照控制器单元及真实路网UI回归通过，未重跑真实LLM对话。隔离站没有账号/AI后台，不把相应404算作原站功能回归。

## 下一步与回退

负责人最新实测已将剩余问题收口为校园网直接无法访问；普通Wi-Fi/流量及推荐浏览器可正常加载。后续继续核实校园网错误码，不能宣称校园网已修复。负责人已明确授权本次共享主站同步，授权不扩展为修改DNS/WAF等其他配置。

代码版本回退使用`git revert 9545d63`，保留4eb9d16及此前账号/Agent等成果；无D1迁移需要回滚。主站已发布后的Cloudflare回退点为089e6478-8157-4cd1-9673-61525083927e，Git与线上版本回退分开操作。独立Worker可按已保存版本回滚；不得通过修改正式域名DNS或重置工作区替代版本回退。

## 主站同步验收（2026-11-04，后续授权）

负责人明确要求“同步到主站”。发布前重新核实主域名指向campusos-preview、D1绑定一致，全部公开变量无差异，也无额外变量将被覆盖。通过既有构建/净化/发布流程同步完整网站，没有把ASSETS地图测试站覆盖到主站。新版本c772f357-fdb6-4654-b5b9-a87f9d50ff66；保留上一版本089e6478-8157-4cd1-9673-61525083927e。没有数据库迁移、DNS/WAF改动、密钥轮换或独立Production Worker部署。

主域名Chrome桌面及手机视口4项通过：完整3D平移保持、导航地图拖拽/缩放。Edge两个视口及Preview别名共11项通过：新renderer、2D零GLB预取、HTML缓存重验证，雷达/知识列表与文章弹窗，11月7日日历活动与原文，账号登录表单。测试账号提交0次、没有调用邮件。这里的手机仍为视口；此前实机反馈保留为独立证据。8条AI反馈仅暂存，校园网错误码仍待负责人提供。发布前后绑定、版本与逐项回执见[发布记录](verification/map-main-release-2026-11-04/release.json)。
