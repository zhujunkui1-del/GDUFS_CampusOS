# 剩余建筑模型上线验收

2026-11-13，负责人要求把剩余已完成2.5D/3D模型放入网站。

## 发布范围和目标

发布前逐项请求清单中的82个GLB：74个与本地SHA256一致，二饭、三饭、门诊部、后勤楼的8个资源为404。友苑、师苑、学生活动中心、学术交流中心及一饭等已上线资源保持原字节。

本次更新现有 `campusos-preview` 共享Worker，网站入口为 `https://gdufs.zhiyuapp.site/map`；没有新建Production Worker/D1，也没有执行数据库迁移或修改DNS、业务凭据。发布前已确认该域名与Workers入口引用相同页面脚本和模型来源文件。

| 建筑 | 既有地点ID | 本次上线 |
| --- | --- | --- |
| 博雅园（二饭） | osm-way-313039061 | 2.5D纯白模、4层3D |
| 风采园（三饭） | osm-way-313039057 | 2.5D纯白模、3层3D |
| 门诊部 | osm-way-313039046 | 2.5D纯白模、3层3D |
| 后勤楼 | osm-way-313039029 | 6/2/3层白模及3D组合，保留院落 |

清单版本为 `campus-building-models-2026-11-13.6`，含40个建筑展示单元和1个教学连接段；不表示全校所有实体建筑均已建模。没有重建、减面或改变既有GLB。

## 构建和发布证据

- 发布前版本：`d035e871-fe6b-4fc0-a30f-3542b0ba6abe`；已保留为回滚点。
- 本次发布版本：`e2a2429f-3c4a-4f92-a65e-b375e5a0cfd5`。
- Git基线：`a4703b602250b1d41692c47415ba60a3f52804e0`，包含工作区中的门诊部/后勤楼接入和下述校验修正。
- `node scripts/build-worker.mjs --config wrangler.jsonc --env preview` 完成Next生产构建/TypeScript、最终入口dry-run及环境净化；1719个生成文件扫描通过。未绕过发布包凭据检查。
- `.open-next/assets` 中82个清单GLB的哈希全部匹配，新8个URL均已编入客户端清单。
- 经 `assertPreviewTarget` 核对账号、Worker、专用D1和既有路由后，用同一OpenNext deploy入口发布；Worker/D1/路由目标未更换。
- 本地模型资源门禁84项通过；3D总量317,024面/4,993,256字节，现有320,000面/8MiB预算未扩大。

## 工程检查中的小修正

全量单测首次默认并发运行时，`public-feed-jump` 在5秒限时内超时；单独复验通过，随后 `npx vitest run tests/unit --maxWorkers=4` 得到156文件/1109项全通过，没有提高测试超时或修改断言。

静态检查修正均不改变功能：学术交流中心生成器删除未使用参数/辅助函数，将局部 `module` 改名；账号模型设置的普通点击处理函数由 `usePlatform` 改名，避免误判成React Hook；模型优先级局部变量改为const；测试移除未用导入/解构，CommonJS回归入口明确使用require。保留原文件格式，没有重建模型。相关4文件37项测试复验通过。

ESLint排除Git已忽略的生成缓存、验证输出、备份和本地私有KB脚本目录，避免检查运行时生成的诊断包；没有忽略应用源码或单元测试。最终 `npm run lint` 全仓检查通过。类型检查及发布构建通过。

## 线上实际验证

发布后对 `gdufs.zhiyuapp.site` 清单82个模型文件重新下载并校验SHA256：全部HTTP 200且与本地一致，包括新增8个；既有74个文件哈希保持。

真实Chrome浏览器逐组打开二饭、三饭、门诊部和后勤楼并执行2D→2.5D→3D、平移及旋转：

- 2.5D共享层活动41/41，细节数0；纯白模已目视核对。
- 3D共享层活动及细节40/40，切换后81个模式资源驻留，pending 0、失败0。
- 每个新模型移动视角后没有新增该模型GLB请求，没有退回白模；页面JS错误0，模型响应失败0。
- 390×844 Chrome窄屏模拟也通过两种模式加载；3D活动40/40、81个模式资源驻留、82绘制批次/45,248面。仅代表视口模拟，不宣称真实手机FPS或现场定位验收。

`/map`、`/radar`、`/knowledge`、`/calendar`、`/account`、`/api/health`、`/api/public/traffic` 均HTTP 200；Workers入口和 `gdufs.ccwu.cc/map` 也HTTP 200。该检查不是全部业务功能的实测，没有登录管理员、提交真实个人位置或发起收费AI探测。

资产、发布前后版本、线上截图和浏览器回执在 `output/playwright/completed-models-online-2026-11-13/`。核心回执为 `before-all-assets.json`、`after-all-assets.json`、`release-artifact-check.json`、`online-browser-report.json` 和 `release-summary.json`。

## 来源和边界

沿用现有审核后的OSM轮廓、程序模型和原公共署名。未新增地图来源、未修改校园GIS/路网；参考照片仍在文档/下载目录，未作为纹理或网站图片公开。楼层确认及米制近似边界沿用各模型清单。回滚应用版本不影响D1数据，本轮也没有修改数据库结构。
