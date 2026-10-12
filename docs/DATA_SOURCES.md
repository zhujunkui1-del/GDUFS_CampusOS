# 数据来源与许可台账

更新时间：2026-10-13（Asia/Shanghai）

规则：发现来源不等于获得许可；每条数据在公开使用前需记录来源 URL、用途、许可状态、核验时间、负责人决定和数据版本。没有许可/地理核验的数据不进入正式地图、RAG 或活动地图标记。

## 已发现的来源

| ID      | 数据/用途                            | 来源                                                                                                                                               | 当前状态                                                                                         | 允许的当前用途/后续动作                                                              |
| ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| SRC-001 | 需求与产品约束                       | `CampusOS_Codex_完整设计文档_v2/PROJECT_SPEC.md`、`AGENTS.md`、`00_README_项目索引.md`、`01`–`12` 模块文档                                         | 原模块已完整阅读，12 为负责人批准的新增模型设置规范；均属于项目内部设计基线                      | 可指导实现；不代表对应功能或外部数据已经存在                                         |
| SRC-002 | 用户提供的大学城 2D 研究图           | `CampusOS_Codex_完整设计文档_v2/assets/source_maps/user_supplied_2d.png`                                                                           | 文件存在；外部来源 URL、作者、可展示/改编/再分发许可、坐标精度未核验                             | 仅内部研究核对；未获权利确认前不得发布、描绘成自有 GIS 或据其自动造路                |
| SRC-003 | 用户提供的鸟瞰研究图                 | `CampusOS_Codex_完整设计文档_v2/assets/source_maps/user_supplied_aerial.png`                                                                       | 文件存在；来源、更新日期、影像许可和数字化权利未核验                                             | 仅内部研究；不得作为可再分发底图/瓦片或精确三维数据                                  |
| SRC-004 | UI 视觉参考                          | `CampusOS_Codex_完整设计文档_v2/assets/ui/desktop_mobile_concept_01.png`                                                                           | 文件存在；设计稿，不是地点/建筑/活动数据                                                         | 可参考布局和视觉；稿中地图细节不进入地图库                                           |
| SRC-005 | UI 视觉参考（索引提及）              | `CampusOS_Codex_完整设计文档_v2/assets/ui/desktop_mobile_concept_02.png`                                                                           | 当前仓库未找到该文件                                                                             | 不可使用；如后续确需此参考，请提供文件                                               |
| SRC-006 | 广外官方大学城校区地址与范围线索     | [2026 年本科招生章程](https://zs.gdufs.edu.cn/info/1020/6720.htm)                                                                                  | 官方来源 URL 已发现，地址信息可支持校区识别；不含可用的校内 GIS 几何                             | 可作为校区身份和地址线索；不能用于生成楼栋/隧道路网                                  |
| SRC-007 | 广外官方迎新网校区地图入口           | [广外迎新网](https://yx.gdufs.edu.cn/)                                                                                                             | 搜索结果显示页面有“大学城校区地图”链接；本次网页读取超时，地图文件、来源字段、精度和许可状态未知 | 作为待人工打开核查的来源候选；拿到图件后仍需确认许可和测绘精度                       |
| SRC-008 | 高德官方大学城校区 POI 页面          | [高德 POI 页面](https://ditu.amap.com/place/B00140UDX9)                                                                                            | 页面可定位到校园主体；第三方 POI 数据保存/再分发许可、API 配额及校内细节未核验                   | 可通过正式授权的高德服务在线核对；不得据页面批量复制 POI 数据库                      |
| SRC-009 | 高德地图 JS API 与在线服务           | [JS API 2.0](https://lbs.amap.com/api/javascript-api-v2/documentation)、[步行路线 Web API](https://lbs.amap.com/api/webservice/guide/api/newroute) | 官方开发文档已核验；项目尚无 Key、账户、域名/安全配置或调用记录                                  | 可作为地图底图/受许可 API 的候选；遵循平台许可与安全要求；不假设覆盖校内连接路和隧道 |
| SRC-010 | 广外官方网页/RAG 知识候选            | 学校及正式部门官网（域名需逐站确认，例如 `gdufs.edu.cn` 下的正式站点）                                                                             | 初始来源白名单尚未审批；采集条款、robots、更新周期和页面结构未核验                               | 先以管理员手动核对原文/链接；自动 Connector 要在 S3 前确认 URL 清单与抓取政策        |
| SRC-011 | 活动、群聊、小红书、其他校园经验     | 负责人指定并具有授权的原文/导出                                                                                                                    | 当前未收到获准的群聊文件、社交来源或活动数据                                                     | 未经审核不得进入公开知识/事件库；非官方内容必须保留原始链接和来源标签                |
| SRC-012 | 大学城建筑、体育设施、宿舍和步行路网 | 尚无已核验且获准使用的数据集                                                                                                                       | 缺少地点名录、坐标/多边形、入口、版本、南校隧道两端及路段来源/许可                               | S1 核心阻塞；需要学校/项目负责人可提供的数据或明确许可的人工测绘方案                 |

## 生产地图的最低数据证明

每个公开地点至少需要：稳定 ID、官方/获准名称、别名（如有）、分类、大学城区域、坐标/几何、地理核验状态、数据来源 URL/文件与日期、许可/使用范围、审核人和版本。

可用于路线的地点入口和路径边还需有：起终节点、坐标系、地面/地下层级、可通行/限制信息、长度/拓扑、来源与核验日期。南校隧道须有两端实际入口和与校内步行网络衔接的证据。只有合法展示许可而无地理核验的数据不能用于导航；只有坐标而无重分发权的数据不能复制到自有库。

## 核验记录

- 2026-10-12：完整扫描本地工作区，确认只有设计文档与 3 张图片；视觉索引提及的 `desktop_mobile_concept_02.png` 未在工作区中找到。
- 2026-10-12：核验高德 JS API 2.0 官方文档及步行路线 API 文档；核验广外招生章程校区地址。未调用高德 API，也未核验校内步行覆盖。
- 2026-10-12：发现迎新网大学城地图入口，但页面读取超时；未下载、复制或发布地图图片。

## S0 新增来源记录（2026-10-12）

- SRC-013：项目域名 `gdufs.ccwu.cc` 由负责人在本次会话明确提供；用于 URL/部署目标配置。未确认实际 DNS zone/账户权限，A/AAAA 和 HTTPS 尚未验证为可用站点。
- SRC-014：图标使用 `lucide-react` 1.55.0，安装包 `package.json` 的 license 字段为 ISC；来源为 [Lucide 官方仓库](https://github.com/lucide-icons/lucide)。品牌“广”字标由本项目 CSS/文本制作，没有复制学校官方校徽。
- 公开 `public/` 目前只有静态资源缓存头配置，没有地图、POI、路线、照片或视觉稿。原始研究附件被 Git 忽略且保持本地。
- 30 张本地业务表为空；数据库约束测试夹具仅在内存 SQLite 中使用。没有把搜索引擎结果、官方地图 POI 或测试坐标写入正式校园数据。

## UI 改版素材（2026-10-12）

- SRC-015：Noto Sans SC 固定界面文案可变 WOFF2 子集，来源 Google Fonts CSS2 API（family=Noto Sans SC，400–600）。本地 `public/fonts/campus-ui-sc.woff2` 58,528 bytes、210 个字符；文件签名确认 WOFF2。许可从 Google Fonts 官方仓库取得并保存在 `public/fonts/OFL-NotoSansSC.txt`，SIL OFL 1.1：[许可原文](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt)。系统字体不打包再分发。
- SRC-016：`@base-ui/react` 1.9.0，无样式 React UI 原语；npm 安装包声明 MIT，使用其非模态 Drawer。来源：[官方组件文档](https://base-ui.com/react/components/drawer)。
- SRC-017：CampusOS 的 C. 网站图标为本项目 SVG 代码，不使用学校校徽或 Apple SF Symbols 资产。玻璃效果由 CSS 构建，不加入地图研究图片或伪造 GIS。

## 模型设置需求与技术资料（2026-10-12）

- SRC-018：负责人在本次会话指定默认模型为 DeepSeek，凭据材料位置为 `CampusOS_Codex_完整设计文档_v2/anykey.md`。只记录位置；文件内容未读取，未验证认证、生成、工具能力或配额。Git 忽略检查确认此路径被排除，当前未被跟踪。不得把凭据文件作为可引用的公开附件。
- SRC-019：负责人明确澄清“游客也可临时使用自定义 API，但不能保存密钥或配置；登录后可持久保存”；已写入 `12_MODEL_API_SETTINGS.md`，替代原冲突句。属于需求决定，不是运行结果。
- SRC-020：官方/原始模型安全资料已查阅：[DeepSeek API](https://api-docs.deepseek.com/)、[工具调用](https://api-docs.deepseek.com/guides/tool_calls/)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)、[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)、[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)。只核对技术依据；没有创建云资源、调用模型或把文档示例当作项目测试成功。

## S1 来源与核验台账（2026-10-12～13）

| ID      | 来源                                                                                                                                                                                                                                              | 用途/许可                                                       | 核验与边界                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SRC-021 | 负责人指定的本地 `anykey.md`                                                                                                                                                                                                                      | 敏感配置材料，仅提取地图 JS Key/安全密钥至忽略文件              | 负责人更新本地域名白名单后真实 SDK 加载；没有输出凭据或使用 DeepSeek                                                                 |
| SRC-022 | [OSM 校园关系 13900183](https://www.openstreetmap.org/relation/13900183)、[官方 OSM API](https://www.openstreetmap.org/api/0.6/map?bbox=113.388,23.060,113.399,23.073)                                                                            | 负责人允许交叉制图；© OpenStreetMap contributors，ODbL-1.0      | 2026-10-12 取得来源几何，派生教学/生活两个分区与 75 条地物；WGS84、稳定源 ID、原文链接及采集时间；不是学校认证或现场核验             |
| SRC-023 | [OSM 许可](https://www.openstreetmap.org/copyright)                                                                                                                                                                                               | 独立数据按 ODbL 再分发/署名，与应用代码许可分开                 | `/api/map/data` 提供完整派生数据；宽范围研究快照保留本地且被忽略；不储存 OSM 用户姓名/UID                                            |
| SRC-024 | [广外南校体育馆](https://www.gdufs.edu.cn/info/1354/59038.htm)、[2025 校园改造报道](https://news.gdufs.edu.cn/info/1002/99562.htm)、[体育部场馆条件](https://tyb.gdufs.edu.cn/tycg/cgtj.htm)                                                      | 官方建筑/场馆/隧道广场存在性与名称线索；不自动获得照片/地图许可 | 历史场馆统计不能当作 2026 数量；网页不能提供隧道两端精确坐标或当前完整通行拓扑                                                       |
| SRC-025 | `assets/source_maps/广外南校区地图.jpg`、`鸟瞰模拟地图.jpg`                                                                                                                                                                                       | 负责人新增参考资料，仅内部核对                                  | 已查看；原作者、原文 URL、发布日期、展示/改编许可未提供。鸟瞰稿不是真实影像或 GIS；未上线、未据图猜坐标/编号                         |
| SRC-026 | [高德安全代理](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)、[POI 搜索](https://lbs.amap.com/api/javascript-api-v2/guide/services/autocomplete)、[路线插件](https://lbs.amap.com/api/javascript-api-v2/guide/services/navigation) | 官方 JS SDK 在线底图、坐标、查询/路线接口                       | 真实域名/坐标请求已核验；库内没有瓦片/模型/整库 POI。图书馆 OSM 地物标签点与高德同名 POI 对照指向同一建筑，不将 POI 点当作已验证入口 |
| SRC-027 | [高德官方类型库](https://github.com/AMap-Web/amap-jsapi-types)、[Workers Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/)、[限流绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)           | 类型/服务端协议及运行时依据                                     | `setzIndex` 与重定向策略经真实接口修正；本地限流不能证明线上跨区域总预算已落实                                                       |

地物分类：校园建筑 9、图书馆 1、教学楼 2、宿舍编号 12、生活服务 12、出入口 1、足球地物 2、体育馆 1、篮球地物 13、游泳地物 2、网球地物 10、类型待复核球场 10。这里的数字是 OSM 对象数，可能存在组成部分或复合场地，不能代替学校场馆总数。

候选路网：18 条道路、46 节点，均 `verified=false`；来源/版本保存在 `research/s1/pending-path-network.json`。未经审核不进入正式自有路由。图片的编号只用于查漏；目前南苑 13 栋、完整教学/实验楼命名、食堂专有名称、排球/跑道分类、建筑入口及隧道连通仍有缺项。

# SRC-028：负责人交付的 OSM XML 与 BBBike GeoPackage（2026-10-13）

- 输入：文档包 `map.osm` 与 `planet_113.388_23.059_80bab6f4.osm.geopackage.zh/`。来源为 [OpenStreetMap](https://www.openstreetmap.org/) 和 [BBBike Extract](https://extract.bbbike.org/)，README、log、checksum 已读取，GeoPackage checksum 相符。
- XML 9,104节点/540道路/76关系；GeoPackage为EPSG:4326，243点/281线/10多线/116多边形/1其他关系。逐个核对现有75地点，全部匹配且锚点坐标未变化。
- 两份文件同源 OSM，不作为独立交叉核验；完整几何可超出导出选区，必须按校园筛选。原包不上传前端，不复制贡献者 user/uid 到派生数据。许可沿用 ODbL及贡献者署名；不自动转为现场已核验。
- 48条 highway 道路触及校园；地下 path way864205124带 `foot=designated`、`layer=-1`，无名称或端点标签。仅登记研究候选；隧道身份、入口与现状待核验，不开放跨区导航。
- 完整文件SHA256、分层范围和来源比对见 `research/s1/supplied-data-audit.json`；可复现脚本 `scripts/inspect-campus-sources.py`。

# SRC-029：高德官方区域掩模和范围限制（2026-10-13）

[JSAPI区域掩模示例](https://lbs.amap.com/demo/javascript-api-v2/example/3d/mask) 与 [Map参考](https://lbs.amap.com/api/maps-javascript-api/reference/amap-map/map) 用于实现校区及必要周边显示、限制拖动与缩放。掩模属于渲染/交互约束，不保证消除全部屏幕外底图请求；未替换地图供应商或抓取其瓦片。

## S1 当前实现修订与建模覆盖（2026-10-13）

SRC-029中的掩模资料作为研究历史保留；当前已取消硬掩模，采用原生限制区域与动态最小缩放，避免灰边。可浏览必要周边由校园来源与真实视口投影确定，不是固定250米截图矩形。

SRC-028离线资料统计：36个闭合建筑标签轮廓，含2个连廊；27有名称、0有height、4有building:levels。四个5层对象是教学楼A/C主体与两个连廊；独立建筑候选34中仅2有楼层，仍缺层高。没有校方全量清单，不能计算实际学校完整覆盖率。审查JSON与建模方案包含逐对象依据。

建模协同与工具依据为高德官方GLCustomLayer/楼块接口、Three.js官方WebGLRenderer/GLTFLoader、Blender官方glTF手册，链接见 `S1_BUILDING_MODEL_PLAN.md`；没有由这些示例生成正式校园模型或复用其纹理。

## SRC-030：负责人补充的苹果地图影像（2026-10-13）

7张PNG：南苑/三食堂、北苑/一二食堂/超市/活动中心、教学实验图书馆、图书馆会堂艺术楼报告厅、办公楼交流中心、体育馆真草场、部分体育设施游泳馆。各图均已视觉读取；来源声明为负责人提供，文本包含 [Apple Maps校园入口](https://maps.apple.com/frame?map=satellite&center=23.067284%2C113.391936&span=0.005359%2C0.009223)。该交互页面未能由网络工具解析，未声称线上3D模型已审查。

用途：内部理解重复院落、斜向连廊、屋顶与体育设施，补充建模方案；不直接生成坐标、楼高、编号或可通行路网。拍摄影像年份、米制高度/立面、对外使用/改编许可仍未知。未复制到 `public/`，未提取苹果地图瓦片、纹理或3D网格。资料观察与缺项见建模方案第9节。
