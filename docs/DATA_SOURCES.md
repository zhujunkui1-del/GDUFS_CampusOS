# 数据来源与许可台账

## 2026-10-31｜活动日历公开文章及媒体证据

只处理既有Preview公开文章及现有内容使用范围允许的原文；不重新搜索官网入口、不新增采集来源、不批量保存图片。1,940篇本机快照、D1恢复书签及完整媒体转录在忽略目录。公开回执仅含项目界面截图、原URL、日期/地点字段证据和资源计量。

真实片段标注来源包括社会与公共管理学院MPA会议 https://zg.gdufs.edu.cn/info/1003/14879.htm 、翻译学院会议 https://sits.gdufs.edu.cn/info/1186/7816.htm 、国际商务论坛 https://mp.weixin.qq.com/s/MBcPmO7ocZeNhollx2WrCw 、信息学院院运会 https://mp.weixin.qq.com/s/cEIZoA9sPyrKztGgESfgJA 。会议报到、离会、提交截止与举办日分别核对；完整12例URL见 tests/fixtures/calendar-real-articles.json 与 verification/calendar-2026-10-30/evaluation.json。

真实招聘会海报下载字节SHA256为29db778a97da76929865208173906347032bd56a215f35b6974d943666584749；OCR曾把署名归为主办方，旧转录未作为最终可靠字段保留，已失效重处理。原海报/CDN链接保持来源记录，未复制为正式public资源。现有公开DOCX/XLSX附件实际转换2个，未从这些表格虚构活动。完整来源用途与验证限制见 CALENDAR_ACCEPTANCE_2026_10_30.md。

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

## SRC-031/032｜本地OSM底图与负责人名称基准（2026-10-13）

负责人明确选择本地OSM底图。校园几何优先用其 map.osm；为满足朝北、完整两区及旋转视口，开发中一次性从官方OSM API补充周边。5次成功区域下载链接、哈希、提取范围和准备时间保存在 local-map-manifest.json；大范围请求曾因节点限制400，未用于数据。启动不联网下载/刷新。当前4495地物、2,487,983字节，ODbL署名与可获取的GeoJSON均保留；不包含贡献者用户/uid。周边学校不成为CampusOS地点或导航范围。

广外南校区地图.jpg 由负责人指定为建筑名称基准；20项覆盖名称/别名，6个来源轮廓补回地点，含被旧边界遗漏的南苑13栋。图像自身公开复用许可仍未知，未复制到 public；名称参考授权不等于图像纹理授权。四栋师苑候选逐项询问，教学/实验楼分栋轮廓仍缺。

技术依据：[MapLibre GeoJSON](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-geojson-polygon/)、[MapLibre Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)、[gcoord MIT坐标转换](https://github.com/hujiulong/gcoord)、[高德2.0加载规范](https://lbs.amap.com/api/javascript-api-v2/guide/abc/load)、[高德服务协议](https://lbs.amap.com/pages/terms/)。gcoord只转换在线查询/路线结果，未缓存高德地图。开源运行时代码带原许可证，锁定npm版本。

## SRC-033｜横屏主周边OSM与师苑逐栋确认（2026-10-13）

负责人明确说明 map (1).osm 为横屏校园周边主资料，map.osm 为校园细节资料。新文件完整解析：20,169节点/1,507 ways，bounds 113.38105,23.05813—113.41017,23.07478，按ODbL处理。生成优先级为离线边缘缓冲→map (1).osm→map.osm；原始校园坐标优先保留。当前准备结果4495地物，校园地点82个；更新版本 s1-2026-10-13.5。源文件名/各自SHA与bounds在manifest记录，没有在网页加载原始XML或自动联网提取。

师苑Q1—Q4已由负责人逐项确认：313039037=师苑1栋、313039033=师苑3栋、313039056=师苑4栋、313039038=师苑2栋。共24项规范名称，北/南苑13栋、师苑4栋、3食堂；原OSM编号留作搜索别名。Q2原编号与正式栋号不同，未沿用错误编号。名称已确认不代表入口/高度/当前通行已核验。

## SRC-034｜复合建筑完整审计修订（2026-10-13）

原始XML中的relation 4105730（教学楼整体）、4105911（实验楼整体）、4105910（学术交流中心）、19299170（教学楼D栋）、19299171（教学楼B栋）均已解析，包含闭合外轮廓与内庭各环。此前仅按way统计/导入的范围不足，这5项已进入地点搜索、详情、点击高亮。CampusOS现在87个来源地点，北/南苑13栋与师苑4栋；A/B/C/D有独立源对象，E/F/G及实验A—E仍缺独立划分。

统计修订：36个building way（已含南苑13栋）+5复合relation=41个候选对象，可能相互重叠，不能视为41栋独立学校建筑。直接height 0，building:levels 6，其中2连廊、教学A/B/C/D 4个主体；不能从层数编米制楼高。完整审计匹配87地点，坐标差异/缺失均为0，GeoPackage checksum仍通过。南苑13栋是旧地点导入遗漏；没有把未经确认的边界原因作为确定结论。

## SRC-035｜13条负责人地图批注（2026-10-13）

来源为负责人直接提交的浏览器批注及指定广外南校区地图.jpg。旧DOM第47/46标记映射到way1389859441/1389859440（羽毛球），第32/25/29/27映射到1389859423/1389859416/1389859420/1389859418（排球），已读取旧运行DOM并按catalogue顺序核对。以后标记暴露data-place-id便于准确反馈。

教学E/F/G依次锚定node3125704419/3125704391/3125704356；实验A—E锚定3125808975/3125808984/3125808994/3125809005/3125809014。全部为原始父轮廓的现存节点，名称/排序由负责人确认；锚点不代表入口，不新绘独立栋边界。友苑way313039031归宿舍。图片只内部核验，不进入public；地理几何保持ODbL来源和署名。

当前本地版本s1-2026-10-13.7：4502地物、99地点，2,557,623字节、gzip468,152字节；SHA和源XML校验在manifest。增加place=square解析、保留bridge/tunnel属性。北侧篮球场和语心湖三桥在现有OSM中没有对应几何，未绘制。

## SRC-036｜下沉广场、隧道与设备定位（2026-10-13）

[下沉广场源记录](https://www.openstreetmap.org/way/1410275259)、[下沉隧道候选](https://www.openstreetmap.org/way/864205124)。连接ways651646933/934/935、864205125、1410275260/261均明确foot=yes/designated。共10节点/10边，实际共享节点连接；不合并地面/地下近邻节点、不把周边机动车道自动加入步行图。地面节点6110327053/6110327054作入口标注；当前通行待负责人确认，审核开关false。没有将OSM收录当现场开放证据。

定位依据[Geolocation规范说明](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)；HTTPS/localhost、显式许可、getCurrentPosition/watchPosition/clearWatch，浏览器定位在中国的可用性仍需现场验证。路线点按需传高德，跟随定位保留本页；测试坐标只在tests隔离配置，截图不假称现场GPS。权限标签核对参照[OSM access说明](https://wiki.openstreetmap.org/wiki/Key:access)。

## SRC-037｜负责人通行确认与两张高德截图（2026-10-13）

负责人明确确认下沉隧道及两端台阶正常通行，批准原始OSM ways651646933/934/935、864205124/125、1410275260/261组成的走廊；只这10条边标为verified。隧道及两端地面入口3个地点新增navigationReviewedAt/navigationSource，其他地点仍未标可精确导航。

停车场.png、语心桥.png由负责人提供，来源高德地图，无具体分享链接，SHA与结论见research/s1/new-reference-review.json。北侧篮球场的旧示意图标注已被负责人考证纠正为停车场；三桥存在及排列可佐证。停车场区域的amenity=parking在三个本地OSM XML中没有匹配，三桥无相应源边；未将截图当带地理参考的GIS，不复制到public，公开展示/几何提取许可未确认。仍需合法坐标资料进行绘制/导航。

## SRC-038｜负责人OSM坐标与本地底图批注（2026-10-13确认，2026-10-14实施）

停车场23.072652,113.391957；三桥23.067618,113.393049（E侧）、23.067031,113.393505（F侧）、23.066542,113.393958（G侧）。负责人回复来源OpenStreetMap，按WGS84/输入纬经顺序读取，文件内统一经纬顺序。停车场_.png、语心桥_.png、八角楼.png是在当前CampusOS/OSM图上位置批注；百度导航参考图.jpg仅作UI结构参考，未采其轨迹/距离或复制资产。

停车场红框以真实体育馆轮廓做配准，最大控制影像残差1.109像素；给定停车点在红框南边界，校准相符。残差不是实测地理精度。矢量/方法/源SHA保存在owner-map-review/owner-map-additions与georeference-owner-parking.py，原图未放public。三桥用真实桥位及确认方向与OSM湖岸求交，两岸路按实际岸线连接；八角楼用行政楼原有8顶点。补绘是负责人确认的自有GIS，不宣称OSM已收录这些实体，不抓取供应商瓦片/模型。ODbL地物及署名保留。

## SRC-039｜批准通行策略与离线几何工具

负责人要求整个校园路网默认跨区经隧道、教学实验可穿行、周边就近到达。固定图s1-2026-10-13.8：4511地物、104地点；路网s1-campus-2026-10-13.3：540节点、1432边、39源道路节段。道路与显示底图独立，其他校区/机动车主路/禁止步行/非教学实验建筑内部/非桥水面不成为捷径。区域内路线是批准的简化地面策略，不补假门或室内房间。

[Shapely官方手册](https://shapely.readthedocs.io/en/stable/manual.html)核对离线求交/可见性，固定Shapely2.1.2、NumPy2.5.4，仅本地工具，不打包至浏览器；Pillow12.2.0用于一次性读标注图。相机过渡参照[MapLibre Camera API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)，引擎仍6.14.0，复制投影修正的接缝仅在MapAdapter内部。浏览器不获取任何这些源参考图片/本机目录或GIS工具。

## SRC-040｜本地路线批注与浏览器异常（2026-10-14）

负责人提供“关于教学楼和实验楼之间的路线.png”“异常.png”“无异常.png”，保留在v2/assets/source_maps；为校园本地OSM地图/UI反馈，内部用于连接策略与渲染排查，不复制截图作公开底图。负责人明确教学B至实验C穿过教学A—G连片可穿行空间并经语心桥；计算范围依据原始教学轮廓包络扣除水域/其他建筑/校区外，未从红线像素猜世界坐标。桥西端接入由已批准桥位及真实轮廓最近点推导，支持源码再计算；JSON保留策略审核记录。

CSS时间问题依据生产实际DOM：--transition-map=0.6s，旧读取使lastCameraDuration=0.6。MapLibre6.14.0本地源码确认相机easeTo接受毫秒，且WebGL alpha/depth/stencil固定启用；不能用alpha:false假称关闭透明缓冲。公开主源：[MapLibre Map源码](https://github.com/maplibre/maplibre-gl-js/blob/v6.14.0/src/ui/map.ts)、[相机源码](https://github.com/maplibre/maplibre-gl-js/blob/v6.14.0/src/ui/camera.ts)。截图和逐帧JSON来自真实Chrome/Edge的隔离测试上下文，控制GPS使用既有公开北苑1栋坐标，无个人位置记录。

## SRC-041｜窗口与原生页面缩放检查（2026-10-14）

负责人补充灰框触发与消失条件，作为UI故障反馈；不新增GIS数据。安装的Chrome/Edge临时独立配置目录执行原生缩放与窗口尺寸矩阵，浏览器版本、视口、DPR、画布缓冲、面板/端点位置与像素扫描来自实际DOM和截图，保存在screenshots/s1/window-layout。测试使用公开教学B与实验C，不读取用户常用浏览器配置或个人GPS。仅测试注入的洋红背景不进入产品CSS。原用户截图仍是内部研究资料，不作为公开底图资源。

## SRC-042｜滚动条触发反馈与Edge显示截图（2026-10-14）

负责人回验仍有灰框，确认面板内容超高、垂直滚动条出现时触发。通过已连接的Edge在临时地图标签页复现，608×440视口覆盖控制布局；可见标签页JPEG记录外框滚动开/关/恢复、内部滚动修订后的地物。只使用公开校园总览与地点查询，无定位请求或个人位置记录。像素检查使用现有Pillow12.2.0，读取已有截图，不修改图片或引入GIS数据。截图保存在docs/screenshots/s1/scroll-compositing，底图来源与ODbL署名见其README。

## SRC-043｜负责人校门坐标、充值点与改名（2026-10-14）

九门名称及坐标来自负责人本轮消息，明确来源[OpenStreetMap](https://www.openstreetmap.org/)；用户原纬/经顺序已转换为内部经/纬。原始数值与稳定ID保存在owner-poi-review.json。OSM校园多边形与部分门点相差最多9.77米，未移动点位或改校园多边形；源XML部分门有access/locked/emergency标签，本轮没有用名称确认推断当前通行状态。

充值点为负责人给定23.064485,113.390697及北苑1栋本地地图截图，核对原OSM way313039013轮廓内东南侧；不从像素猜坐标。内部参考保存v2/assets/source_maps/北苑1栋_水电冷充值点.png，SHA256 `63640947450318af1200c30821ccf41ef10fbda8af58d0b349938367700b0890`，不放public。B8学术报告厅/又康超市为负责人浏览器批注明确更名，源ID分别way651642991/node12959101438，原位保留并存旧名别名。自有Point补充与原OSM派生数据署名/ODbL信息保留。

## SRC-044｜南苑7栋单栋高度与外观试点（2026-10-14）

- 负责人明确仅南苑7栋先做2.5D/3D，给定7层、约21米。高度以owner_approximation登记，不称实测，不写回OSM height。稳定来源为[OSM way312536955](https://www.openstreetmap.org/way/312536955)，外轮廓与原地点/底图完全一致，ODbL-1.0及署名保留。
- 再次读取项目苹果参考图“宿舍区_南苑_三食堂.png”和已确认的“广外南校区地图.jpg”，对应南苑7栋顶部左侧的围合中庭/横向翼楼。外轮廓投影尺寸约70.57×41.68米；中庭按可见比例估计，仅模型显示使用，不转为精确GIS/路线边界。窗格、女儿墙、屋顶条带与立面色彩为自有程序化近似，不声称实测细部。
- 按授权在Edge访问小红书并搜索“广外南校 宿舍 南苑”，页面显示“登录后查看搜索结果”，未登录或取得笔记。公开读取[广外学生处署名《广外攻略》](https://www.sohu.com/a/252154047_683738)（2018-09-05）的南校宿舍七层文字；配图CDN被浏览器阻止，没有成功观察照片，不能记为南苑7栋立面证据。没有复制图片、纹理、供应商网格或第三方模型。
- 实际资产为自有生成GLB，包含OSM派生轮廓、自有近似细节及来源声明。手机LOD71432字节/3804三角形/5模型绘制，桌面LOD124024字节/7040三角形/7模型绘制；统计不含底图和运行时阴影。GLB自包含、零图片纹理，哈希与外轮廓SHA记录nanyuan7-model.json；可编辑生成器及owner-model-review保存来源/近似状态。
- Three.js 0.186.1（MIT）与类型0.186.0通过npm官方包源锁定；共享GL及投影以本地MapLibre6.14.0声明/源码验证，GLTFExporter用[官方导出接口](https://threejs.org/docs/pages/GLTFExporter.html)。旧MapLibre示例链接当前返回404，不以搜索缓存示例宣称当前API可用；实际兼容性由本轮渲染回归记录。Three.js许可证复制至public/vendor/three-0.186.1/LICENSE.txt。

## SRC-045｜负责人五张宿舍外观参考与第二版（2026-10-14）

负责人交付宿舍6.png、宿舍5.png、宿舍内测4.png、宿舍3.png、宿舍7.jpg，原文件复制至文档包assets/model_references/nanyuan7-v2并保留原像素。五个SHA256逐文件记录在独立design.json；不进入public或预览照片端点。多图带知乎@禾先生/@广外引路人水印，原发布链接、影像年份和公开再利用许可未提供，不据附件默认可再分发照片。

宿舍3.png可见“南苑七栋 / SOUTH HALL OF RESIDENCE BLOCK7”标识，用于建筑外观对应；内侧参考呈现浅色框架、红砖竖墙、开放走廊和水平栏杆。宿舍7.jpg可见北苑6字样，仅作为同类宿舍风格参考，不当作南苑7栋的全部立面证据。精确立面朝向、开间/楼梯/雨棚位置和中庭尺度仍未标定。

第二版使用原OSM way312536955和原七层/约21米依据，外轮廓SHA为cafc04b8e7f6fe939eaa7728f14fa8be8717088f1642028add614bd8470045da。显示几何近共线点简化误差小于4厘米，原GIS未改。自有程序化框架、凹进阳台和廊道以纯色/实例表达，不复制照片像素或砖纹。独立GLB为80384字节/4748三角面/7调用/5材质/0图片，当前SHA54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a；仅独立评审，未注册到地图。

## SRC-046｜负责人第二版3D接图批准与原2.5D保留（2026-10-15）

负责人本轮明确批准把第二版南苑7栋3D换入地图、保留第一版2.5D，并合并视角按钮。来源仍为SRC-044的OSM/高度和SRC-045的外观研究；本轮无新照片或供应商模型采集。只发布自有零纹理GLB，原参考照片不进入public。批准、版本与精确SHA登记owner-model-review.model3D；公共SOURCE.md更新当前版本及历史资产出处。

发布文件nanyuan7-v2-54cc55342ae5.glb与独立评审nanyuan7-v2.glb二进制完全一致，SHA256仍为54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a。原评审manifest/design保留其2026-10-14快照状态，不能将其中mapIntegrated:false解释为当前地图状态；当前运行清单为src/features/campus-map/data/nanyuan7-model.json。2.5D参数与第一版快照完全一致，底图/地点/路由没有重建。两款真实浏览器隔离测试保存公开校园模型截图及视口/版本/哈希/调用证据，无真实个人定位采集。

## SRC-047｜3D窗口缩放故障与实际GL尺寸（2026-10-15）

来源是负责人故障反馈、Chrome/Edge实际绘制与Three0.186.1本地源码。探针在隔离测试上下文观察七层实例楼板drawArraysInstanced/drawElementsInstanced的GL viewport和drawingBuffer，排除512px阴影，不读取账号/个人GPS/认证请求。修复前1440×900 viewport与780×520 buffer不一致；修复后桌面/手机DPR1/3、真实窗口DPR1.5、调整后拖动均一致。证据在screenshots/s1/nanyuan7-v2-resize，复验和限制见S1_NANYUAN7_MODEL_RESIZE_ACCEPTANCE.md；不新增GIS或影像许可。

## SRC-048｜宿舍视觉验收与实际Edge性能采样（2026-10-15）

负责人明确已验收南苑7栋2.5D/3D作为宿舍模板，并要求性能试验先于全校批量。复用已批准GLB，SHA仍54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a；原2.5D/地图/地点/路由未修改，没有新照片或外部模型采集。

数据来自Edge149.0.4022.80实际ANGLE/D3D11、RTX4070 Laptop/Ryzen7745HX、约15.18GiB RAM。主采样48轮、策略14轮、近景8轮、真实指针16轮及正式地图前后各18条件；原始压缩JSON/摘要/CSV/浏览器PNG在docs/performance/dormitory-2026-10-15。FPS是渲染事件频率，页JS内存为CDP；GPU VRAM/最终呈现FPS/完整进程RAM等未可靠归因。隔离虚拟坐标和编号不能当作真实建筑数据。未采集个人GPS/账号或发送供应商请求，手机视口不等于手机实机，来源口径及异常试跑记录见报告/PROGRESS。

## SRC-049｜S2-A 模型能力与当前代码/数据库审计（2026-10-15）

- 官方接口和协议：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)，实际/api模型列表认证与deepseek-flash三请求诊断通过。原始响应/密钥不归档；仅脱敏事件和测试元数据存docs/verification/s2-a/model-live.json。json_object+本地Zod校验实测，严格JSON Schema未验证。
- 负责人指定的anykey.md仅安全交付，Git忽略；服务端.env.local/.dev.vars也是忽略文件，不复制到public。生产凭据须Cloudflare Secrets，不随构建发布。
- 真实地图数据仍为既有固定campus.json/local-routing与OSM版本，S2-A未联网更新GIS；实际D1只读审计发现30业务表，用户/对话/消息/运行/地点均0，不能将空表视为已接业务数据。
- 压力测试及南苑7栋既有自有资产完整保留；无新增照片、模型或地图素材公开发布。

## SRC-050｜S2-B 地图Skill实际数据与工具证据（2026-10-15）

五项Skill复用已审核campus.json、walking-network.json与原planLocalRoute，mapVersion=s1-2026-10-14.2、networkVersion=s1-campus-2026-10-14.2；无新增地图/模型/照片/在线地图采集。建筑高度只引用原南苑7栋manifest的负责人7层约21米，不补其他栋。

真实DeepSeek受控9请求/25428ms，无强制tool_choice，调用全部五项；正向地点/详情/附近与跨区路线，以及未知999栋拒绝均有完整脱敏记录docs/verification/s2-b/deepseek-live.json。真实Workers输入输出取自该目录HTTP记录并提取inputs-and-outputs.json；仅公共校园数据，不保存Key/Cookie/个人定位。带授权公开坐标仅单元夹具，不当现场定位。OSM原许可/署名与固定手动更新机制不变。

## SRC-051｜S2-C共享状态、真实对话与浏览器证据（2026-10-15）

继续复用SRC-050固定OSM地点/路网和已批准S7资产，无地图、图片、建筑模型新采集或公开发布。真实模型为服务端deepseek-flash；Chrome/Edge A–G、受控公开校园坐标定位、实际动作回执、usage/耗时与截图存docs/verification/s2-c。证据仅保留公共ID/动作与脱敏结果，不含Key/Cookie/签名票据或私人GPS。手机视口非实机，拒绝授权负面分支有显式模拟标记，Mock服务失败另列。

共享D1方案依据官方[D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)，成本范围依据官方[DeepSeek价格](https://api-docs.deepseek.com/quick_start/pricing/)（核对2026-10-15），非实际账单。双workerd/同一受管D1模拟服务用于原子配额/重启恢复实测，隔离SQLite/Mock只在tests，生产迁移无虚假种子。完整条件/限制和首次失败修订见S2_C_AI_MAP_ACCEPTANCE.md。

## SRC-052｜S2-D本地验收、门名确认与云端只读证据（2026-10-15）

负责人浏览器批注确认4号门改为4号门（贝岗门）。只更新canonical名称/别名，不改变owner-gate-4及WGS84坐标、OSM固定几何或路网。S7自有资产SHA仍54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a；无新模型/影像或地图采集。

数据/PNG来自Chrome148与Edge149实际浏览器、本地生产Workers/真实DeepSeek、两个workerd共享受管D1模拟服务，保存docs/verification/s2-d。手机视口/CDP触摸、公开校园定位夹具明确不是实机GPS；故障Mock与真实模型分开。原始秘密/Cookie/签名票据/私人GPS不归档。归档28轮模型请求成本按[DeepSeek官方](https://api-docs.deepseek.com/quick_start/pricing/)核对估算，非账单；累计开发台账包含历史/失败，不作为本阶段总成本。

负责人已登录Edge控制台与CLI只读核查：无CampusOS Worker/D1、目标域名0DNS/证书Active。截图裁去私人账户信息；公共DoH无A记录，本机198.18/15代理地址不视作真实公网解析。来源为[Cloudflare控制台](https://dash.cloudflare.com/5328fbf5ef7ef40f7743723c2c192499/workers-and-pages)、[IANA地址注册表](https://www.iana.org/assignments/iana-ipv4-special-registry/)、[Workers限制](https://developers.cloudflare.com/workers/platform/limits/)。未改账户资源/DNS/HTTPS或公开发布。

构建净化依据锁定OpenNext1.20.10本机extract-project-env-vars/compile-env-files源码及[官方环境变量文档](https://opennext.js.org/cloudflare/howtos/env-vars)，保留无值命中路径前后证据。开发链漏洞核对[GitHub官方公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，当前无补丁；来源检查不等于供应链完整安全证明。

## SRC-053｜S2-E实际Cloudflare预览、SQL兼容与性能（2026-10-16）

来源为负责人预览/1元模型测试明确授权、当前Cloudflare控制台Free套餐、Wrangler4.149/OpenNext1.20.10实际发布、真实workers.dev请求、Cloudflare Tail/GraphQL/D1 meta与Chrome/Edge实际截图。独立预览URL及资源名/非秘密UUID见S2_E_CLOUDFLARE_PREVIEW_ACCEPTANCE.md；不记录账户邮箱/认证Token/Key/签名值/私人GPS，测试Cookie只在忽略目录，不提交。未采集新的地理/照片/模型资源；原OSM、路网及S7许可/资产不变。

技术核对：[Workers限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1限制](https://developers.cloudflare.com/d1/platform/limits/)、[D1价格](https://developers.cloudflare.com/d1/platform/pricing/)、[OpenNext静态缓存](https://opennext.js.org/cloudflare/caching#ssg-site)、[自定义入口](https://opennext.js.org/cloudflare/howtos/custom-worker)、[D1触发器CASE兼容问题](https://github.com/cloudflare/workers-sdk/issues/4727)。复用生成ALS的入口与当前适配器版本绑定，升级时必须回归。

成本来自[DeepSeek官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)与实际usage/余额变化，后者可能包括同期其他调用，不是项目独立账单。同步工具0ms受[Workers只在IO后前进的时钟](https://developers.cloudflare.com/workers/runtime-apis/performance/)限制；CPU采用平台Tail，GraphQL CPU微秒转换不能与墙钟混淆。内存/逐请求完整子请求、真实手机GPS及跨地域明确未验证，未用本地双worker结果替代。

## SRC-054｜负责人预览浏览器批注与真实浏览器故障复现（2026-10-16）

来源：负责人13条浏览器批注、edge使用ai助手.png及campusos-preview公开页面。体育标签以原序号和稳定data-place-id核对，锚点/成员/隐藏ID记录owner-sports-label-review.json；无新坐标、第三方图或模型资源，不从截图推算经纬度。ODbL原几何和署名保持；负责人图片不复制进public。

实际证据为全新Chrome/Edge访问真实workers.dev的DeepSeek工具事件、执行回执及浏览器PNG；模拟公开校园坐标不是私人位置或GPS实机。HTTP Date与客户端时差诊断存在秒级日期量化误差，不作为精确时钟同步服务；最终时间校准及服务端消费/过期约束有单元和真实HTTPS验证。记录在verification/s2-e-fixes及S2_E_BROWSER_FIXES.md。

## SRC-055｜多会话审计与验收（2026-10-16）

来源为当前0001/0004真实外键、既有AssistantStore/SharedRouteStore与负责人多会话要求；0005本地空库/有历史升级、两个workerd共享D1模拟、真实预览迁移和Chrome/Edge截图分别记录于AI_CONVERSATION_MANAGEMENT_ACCEPTANCE.md及verification/conversations。官方D1 batch文档：https://developers.cloudflare.com/d1/worker-api/d1-database/ 。测试夹具/模型流故障明确标Mock，未当真实DeepSeek。

没有新地理、图片或模型数据；实际网页截图来自原许可OSM及已验收模型。登录身份在隔离真实Schema夹具验证，不伪造学生登录/SMS上线；无私人GPS/密钥/用户Cookie进入公开报告。预览迁移只改本项目元数据，既有历史内容数量与外键检查留存。

## SRC-056｜CPU诊断与离线公开道路候选（2026-10-16）

官方技术来源：https://developers.cloudflare.com/workers/platform/limits/ 、https://developers.cloudflare.com/workers/observability/profiling-in-production/ 、https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/ 、https://developers.cloudflare.com/workers/runtime-apis/performance/ 、https://developers.cloudflare.com/workers/platform/pricing/ 。当日核对10ms CPU与网络等待区别、平台弹性、profiling目标限制及计费方案；未升级套餐。

实际指标来自指定预览Worker的Tail/GraphQL、指定预览D1数值聚合及受控真实DeepSeek浏览器任务；本地workerd采样单独标明，不冒充云端函数归因或手机实机。线上Profile只idle/无近期执行的限制保留。公开证据无Key、Cookie、原始SQL参数或私人GPS。

新public-walking-attachments.json完全由已审核固定campus/walking-network及原几何函数离线导出，113地点/445道路候选；沿用原OSM来源与许可，不构成新的建筑入口/道路通行事实。保留原地图/路网版本与所有几何、建筑模型SHA。每次普通构建校验来源哈希，手动重建，不联网更新。数据/截图/比较见S2_E_CPU_ACCEPTANCE.md与verification/s2-e-cpu。

## SRC-057｜负责人220条来源清单及S3-A运营登记（2026-10-17）

原始输入：文档包内CampusOS_广外信息源_去重详表_2026-10-17.xlsx及同名Markdown。只读使用，SHA256见verification/s3-a/import/preview-import.json；109官网、89公众号、3服务号、16小程序、1企业微信、2内嵌应用。规范化清单位于data/console，保留文件/表/行/原目录引用及全部待核声明。

来源是负责人提供的研究目录，不等于学校认证、当前可用性或采集许可。220条均候选/未启用/未核验，0文章；113项警告和29行冲突保留，公众号缺微信号或无主页返回未知，不生成URL。后台逐项核验机构/证据/许可后才能启用；非官方内容人工审核，活动关键时间/地点另有门禁。未把原文件、第三方采集项目或其中图片加入public，未运行三个采集项目。

技术依据：[D1 batch与参数绑定](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Access JWT验证](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。实际证据为本地SQLite/workerd、真实指定预览D1迁移/幂等导入和Chrome/Edge截图，Mock与真实云端分列。运营认证未配置时API关闭；无私人学生数据或凭据进入报告。RAG索引/抓取尚未实施，来源登记不代表内容已采集。

后台界面静态化参照[Next静态参数](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)和[查询参数/Suspense](https://nextjs.org/docs/app/api-reference/functions/use-search-params)，本机16.3.8实际构建及OpenNext1.20.10本地/真实云端验证为准，不据官网更新版本假设升级。只缓存空界面，管理数据保持鉴权/no-store。

## SRC-058｜管理员密钥授权与真实HTTPS验证（2026-10-17）

来源为负责人明确选择独立管理员访问密钥的答复和服务端配置，非QQ邮箱验证/学校统一身份授权。密钥以密码学随机数生成，独立于本地/模型/其他项目，只有忽略文件和指定preview Worker Secrets保存；原值不进入Git、报告、URL或截图。唯一管理员标识仅服务端配置，界面截图遮蔽邮箱，身份不赋予学生私人数据读取权限。

实际证据为Chrome/Edge桌面/手机视口的公网登录、真实220候选读取、刷新恢复、退出与旧Cookie拒绝，D1有4次登录/退出审计且活跃会话0。没有在公网填造内容或把候选核验为事实，没有本次Access/扣费授权操作。详见D-042、S3_A_CONSOLE_ACCEPTANCE.md第9节及verification/s3-a/admin-preview-*；本阶段之后无额外模型请求。

## SRC-059｜S3-0只读审计、参考机制与接口边界（2026-10-17）

输入仍为负责人两份2026-10-17来源清单，文件实际存在/只读SHA一致，主表220行与Markdown220稳定ID对应；组织线索、证据文章和冲突事项不当额外已认证来源。工作表结构与当前45表/外键、preview来源/知识实体只读计数见verification/s3-0，未读取学生私人正文/位置或执行数据写入。

参考[PKU Know首页](https://pkuknow.cn/)与[日历](https://pkuknow.cn/calendar)仅观察聚合、筛选、摘要/原文、日历、来源补充和手机单双列；未提交表单、报名、登录或复制代码/品牌/素材/文章库。Dify仅查官方文档/许可/定价，不连接学校内网或调用真实API。研究事实与推论见research/s3-0/product-and-dify.md。

平台限制依据：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[D1价格](https://developers.cloudflare.com/d1/platform/pricing/)、[D1限制](https://developers.cloudflare.com/d1/platform/limits/)、[D1 FTS5支持](https://developers.cloudflare.com/d1/sql-api/sql-statements/)。仅说明当日官方规格，不当本账户实时剩余配额或长期容量证明。没有新GIS/图片/全文数据入public，也无新增模型/Dify或收费资源操作。

## SRC-060｜首批官网规则核验与真实元数据（2026-10-17）

对[学校官网](https://www.gdufs.edu.cn/)、[学工](https://nstu.gdufs.edu.cn/)、[后勤](https://hqc.gdufs.edu.cn/)、[团委](https://youth.gdufs.edu.cn/)、[图书馆](https://lib.gdufs.edu.cn/)各robots/主页/栏目/详情一次，共20次、间隔≥10秒；15个HTML200，robots404，未见可覆盖全文再分发许可。精确栏目/selector/原日期与失败边界见research/s3-b/official-source-audit.md和verification/s3-b/sources/http-audit.json。

只核验启用原ID GDUFS-SRC-0010/0017/0008的官网元数据，不与公众号同名载体合并。真实preview保存3个标题、链接、原日期/获取时间和HTTP缓存/解析观察，全待审；批准/发布0，未保存正文/图片/附件、未送模型。详情原文为[学工通知](https://nstu.gdufs.edu.cn/info/1056/68721.htm)、[后勤公告](https://hqc.gdufs.edu.cn/info/1006/3098.htm)、[图书馆大赛通知](https://lib.gdufs.edu.cn/info/1134/9648.htm)。图书馆原日期2026-06-30，不是采集日2026-10-17；后勤条件请求304未新增文章。217其他候选状态SHA不变，原始XLSX/MD不改/不重导。没有新增GIS或正式public素材。

## SRC-061｜微信独立PoC与学校Dify依赖核查（2026-10-17）

> 历史证据：学校UI核查记录仅供追溯。D-045已废弃全部Dify技术路线，下文接入依赖不再生效；不删除原时刻事实或将其记为真实API已接通。

三候选仓库、当前HEAD、许可证和开放问题见S3_B_WECHAT_POC.md；源码只读、离线合成输入隔离于tests，robots限制后不抓文章，不使用静态Cookie或登录绕行。实际文章0，率0/0未测，未正式集成或再分发工具/公众号全文。

负责人指定学校比赛Dify http://172.17.1.46/，仅校园网；Edge已登录UI实际只读确认1.17.1与知识库/API入口，未读Key/传文档/调模型，不登记为公开信息源或扩入官网抓取白名单。学校授权、API范围/费用/安全传输与云端可达仍待核验，见research/s3-b/school-dify-readiness.md。CPU聚合单位由真实GraphQL Schema核对，协议来源为[官方Workers metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)，不以客户端Wall Time冒充CPU。

## SRC-062｜自研知识检索路线与中断研究资料（2026-10-17）

依据负责人最新明确决定D-045，知识检索采用自研接口+D1关键词/分类/分段，旧Dify研究仅历史归档，不再是数据/软件供应商或待接依赖。没有新数据采集、模型请求、公开素材、部署或数据库写入；来源/版本/审核/outbox保持。

上轮四项目研究中断现场见research/s3-wechat/README.md；四份原始本地项目包只读，thu-push-main忽略规则按负责人新增目录保留。部分GitHub元数据与只读D1快照为已有研究证据，不当实时公众号采集或完整研究已验收。当前技术调整不续做这些实验。

## SRC-063｜四仓库固定源码、许可与离线研究（2026-10-17）

负责人原包只读：weixin_search_mcp-main、we-mp-rss-main、thu-push-main、wechat-article-exporter-main；本轮当前上游main分别a5a70a2/9b40351/19abc551/c5e56bf，完整SHA/时间/原包一致性和首轮错误见research/S3_WECHAT_OPEN_SOURCE_COMPARISON.md与verification/s3-wechat-resumed。A/B整包前后哈希相同，另两包受检文件哈希/换行归一比对一致；原包不是正式资源，不复制进public或Worker。

GitHub公开源码/元数据/Issue/PR为维护与行为证据，上游自报不当CampusOS成功。Search仅MIT声明缺独立LICENSE；WeRSS/thu固定LICENSE为MIT；Blog为CC BY-NC-SA4.0及附加限制，公开服务用途待明确，不默认比赛免费即获授权。全部源码许可与平台/文章权利分别核验。

合成HTML/JSON/时间/SQLite仅tests/research隔离夹具；18/26/81+17分开记录，CampusOS10严格诊断8通过2失败，均非真实文章准确率。真实微信/搜狗文章、模型、SMTP及本轮公网D1请求0，不采集私人数据，不重写旧云端快照。公开规范参考RFC5545/5546用于ICS字段、时区、UID/版本和取消语义，不代表手机日历实际已验证。

## S3-B最终人工导入与来源证据（2026-10-17）

继续使用现有220来源、其中3个逐站核验官网；不新增微信运行依赖、不批量启用来源。真实3篇记录仅既有公开元数据，正文/图片/附件文件0，发布由负责人逐篇批准。新增人工导入在当前来源登记库保存独立用途范围/证据/管理员/24小时有效期，robots不存在不能当全文授权；metadata_only只登记元数据与原文跳转，摘要须为运营者自有简短说明。

同源规范URL复用文章并记录manual/official_web不同栏目出处；不同URL/年份/机构不凭标题合并。正文完整性为显式声明，旧记录unknown不倒填。举办/截止证据与原文偏移、内容修订/hash、字段精度绑定并待核验，获取时间不替代原发布时间。实际范围和证据见[S3-B最终准入](S3_B_FINAL_ADMISSION.md)。

最终只读快照（负责人后台验收后）：220来源，4核验/4启用、216候选；额外1源由负责人操作，未当新增采集成功。3篇既有元数据均由负责人批准并发布后撤回，当前公开0、全文/图片/事件0。网页解析版本.2需重新确认策略，匹配有效策略0；本轮无新增官网/微信抓取或模型调用。详见verification/s3-b-final/preview-password-final.json与owner-publication-read/owner-withdrawal-read.json。

## Console 来源登记状态更新（2026-10-19）

依据负责人“把信息源全部来源设为启用”的明确要求，通过现有preview Console管理API完成215项启用操作；既有5项保留，最终220/220来源启用。此为登记状态变更，未新增来源或改写关联证据、官方核验、采集许可、正文版权字段；没有把来源启用视为已完成抓取。来源集合与权限/证据hash复验一致，具体命令和前后数量见verification/console-v2/operations/2026-10-19-enable-all.json。

## 五个已登记官网栏目近期元数据（2026-10-19）

负责人指定GDUFS-SRC-0024校团委、0012学校官网、0008图书馆、0017总务后勤部、0010学生工作部，各最近最多10条。实际使用既有tzgg、学校热点讲座、本馆通告及通知公告栏目；每源10条、共50，47条新索引目前公开于雷达/知识，3条旧撤回当前404。按原日期排序并区分栏目范围，不宣称覆盖学校所有新闻频道或公众号。

真实robots/HTTP状态、原文标题/URL/日期、内容hash及解析观察见verification/source-sync-2026-10-19/*-latest.json；仅保存元数据与hash/长度，不保存第三方正文和名单、电话、图片或附件文件。元数据采集政策1日、公开元数据用途30日，5源均按当前学校机构目录/实际官网印证，不授予全文转载。规则.3识别VSB容器差异、置顶日期排序与校团委分页。

一条旧记录初次误公开的事实及恢复原字段/撤回过程单独保留在withdrawal-repair.json，未销毁历史审计。源与文档关系复用原表，无新信息源导入，无Mock真实发布，0模型消费。见FIVE_SOURCE_SYNC_ACCEPTANCE。

## D-053归属修正与有界同步（2026-10-19）

复用上一轮五官网栏目及原元数据证据，原47篇唯一分配46雷达/1知识；逐篇URL和事实hash见verification/article-ui-2026-10-19/classification-results.json，原3撤回未恢复。本轮3个实际web任务完成，额外采集并公开2条元数据：校团委https://youth.gdufs.edu.cn/info/1050/12592.htm（2026-07-14）和学校官网https://www.gdufs.edu.cn/info/1005/255426.htm（2026-06-05），不是新发布日或完整全站新闻增量的声明。学习空间预约指引归知识；讲坛条目按讲座修正。当前48雷达/1知识且无交集，完整索引见同目录public-corpus.json。

官网规则.4绑定唯一归属与讲坛标题分类；管理员续认原五来源的metadata_only访问政策，复用当天已核实robots结果，来源身份/域名和第三方正文许可均未扩大。分类迁移只复制已有效的原文证明，不伪造未采集正文；全部公共接口仍不返回正文。没有下载图片/附件、写入学生名单/联系方式或调用模型。

## D-054明确手动发布（2026-10-20）

负责人对后勤旧文章content-8de39637-4cd5-4eff-8e3d-97ea4d788dc2明确要求能发布，使用原已保存元数据及https://hqc.gdufs.edu.cn/info/1006/3098.htm。真实发布/撤回/再发布验收最终为已发布，原标题、URL、日期、正文等事实hash保持一致；仅公开既有元数据，无新增网站正文采集。图书馆批注仅纠正业务状态/按钮，未当作重发指令，其记录及学工旧撤回保持404和原版本。操作范围、时刻及回执见verification/two-state-2026-10-20/owner-publication.json，不修改旧阶段的历史误公开证据。

## WeChat MP Tools 本地候选与已有导出（2026-10-20）

负责人明确授权检查 `D:\WeChat MP Tools`，公开代码来源为 https://github.com/x554960766/wechat-mp-tools ，固定提交5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3。离线确认安装包2.2.4及七关键模块归一化一致；本地广外就业/广外就业中心各1篇成功导出，后者记录发布时间2026-09-30。此次不将工具代码许可、用户本地备份或成功下载当作文章全文公开/云端检索用途授权，也不新增公开知识来源或扩大现有采集策略。

产物保留用户原目录，仓库仅保存脱敏字段、长度、散列与分析结论。未读取登录凭据、未启动新抓取；目标七月起完整目录未确认，仍保留实际访问路径限制。详见 [安装包与产物复核](research/WECHAT_MP_TOOLS_LOCAL_REVIEW_2026-10-20.md)及其证据JSON；文章主体和元数据许可在正式接入前另行核对。

## 78个仍更新的公众号、服务号：当前名录（2026-10-21，D-055）

负责人声明已人工核对WeRSS当前78个账号仍在正常更新，授权按此名单替换CampusOS公众号/服务号登记并清理旧条目；唯一后续公众号采集器选WeChat MP Tools。名单、MP_WXS、biz和简介见[78账号Markdown](微信公众号与服务号_78个有效账号_2026-10-21.md)。这是人工运营核对及本地订阅名录证据，不是微信平台认证、学校关联或全文再发布许可。

精确映射54项沿用来源ID，24项新建；38个旧行清理。官网109来源、19其他载体来源、52现有官网文章全部保持，未新抓文章或删除官网内容。旧2026-10-17原始目录只作历史参考，不应重新导入恢复被清理条目。当前绑定文件data/console/wechat-source-registry-2026-10-21.json，具体证据和备份边界见[本轮操作记录](WECHAT_SOURCE_RECONCILIATION_2026-10-21.md)。

## 阅读HTML实际接入（2026-10-21，D-056）

负责人现已授权站内阅读与自动发布。本轮使用 `D:\WeChat MP Tools\data\articles_full` 的67份既有成功导出：广外就业53、广外就业中心7、外环东路178号的猫7，均匹配当前78来源并带原文发布时间。清理HTML后真实入库公开，凭据、原始导出及阅读版留本地数据目录；仓库只留散列、计数、接口与运行摘要，不收录第三方完整正文。

本轮新上游网络抓取0，未证明78源9月起目录完整；其余75账号没有本轮导入正文。源站更新/删除在线巡检未验证。原52篇官网文章与206条原来源字段散列保持，细节见[整合记录](WECHAT_COLLECTOR_INTEGRATION.md)。

### D-057图文恢复

负责人提供台湾研修文章的原始HTML、raw HTML与本地media目录，明确要求保留图片与背景。现按本地原HTML恢复67篇图文，图片引用来源为原文中的微信图片CDN，不额外抓取上游文章或复制图片到Cloudflare。目标文章24图及背景已实见；本批HTML3.24MB。本地图片495文件/82.8MB仅为容量评估，不作为已上传资产或全78号覆盖。详见styled-reading-correction-2026-10-21.json与styled-html-storage-sample-2026-10-21.json。

### D-058操作事实（2026-10-21）

使用流程按钮依据为本机安装包_internal/frontend/js/components中的accounts.js、articles.js、settings.js，以及此前只读保留的upstream/rss_scheduler.py；未据此调用上游历史接口。本轮只读rss_subscriptions.json的名称、启用和间隔字段：1个启用账号外环东路178号的猫、720分钟，不复制凭据。线上已观察78来源、当前导入起日2026-10-01、53/7/7文章计数、加粗在线时间及指定阅读页；未获取新上游正文。操作步骤见WECHAT_SYNC_USER_GUIDE.md，运行证据见verification/wechat-sync-usability-2026-10-21.json。

### D-059实际证据（2026-10-21）

使用已授权本机EXE及原审阅包源码离线生成单HTML补丁，安装后文件SHA08731c6c18532dd11ee76d5d6bfb683b9b2ca2dd48812c2642f93170ab6d0763；仅downloader模块变更。旧实际文章仍为3账号67篇，无新增上游来源/正文。线上日期预览使用当前D1中的55篇真实旧文章，展示原标题、原文日期、来源和原文URL，未确认清理。长期连接只取消原有效期、不改变78来源。快照只存清理需要的公共元信息，不收录全文；实际截图用于工程记录、不放入public资源。

### D-060故障与离线素材（2026-10-22）

下载失败依据是用户本机download_history.json中的10条raw_html未赋值记录及实际EXE模块代码。授权回归素材沿用台湾文章本地_raw.html和metadata.json，仅在隔离夹具内重建原文时间字段；不拷贝全文进仓库、不写下载历史、不当作在线下载。回归确认24图片/5背景CDN地址保留，测试阻止网络连接，未新获微信页面、授权或账号信息。

后台接口在旧/新Worker版本均失败，后经只匹配平台公开错误签名的处理明确返回D1日读额度耗尽；本轮未清理真实文章。日额度恢复规则来源为Cloudflare官方：https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ 。查询活动来自wrangler d1 insights，原SQL统计只在忽略备份目录，项目记录保留计数摘要。

### D-061本地目录修正（2026-10-22）

依据用户指定广外青年目录内2份reading.html的公开标题和原文URL进行更名，只改路径不重抓内容。两文件SHA分别为edc2023fa4e736b6757de8a27ffdaf7da541e951f3b921d9307d0d87bce41a59、e30302874136e116e3b154a0329d5f038a6600c6843d122709ff0bc83779b02d，更名后相同。下载历史仅2处路径变化、2条成功状态保持，不涉及公众号登录信息、官网或云端文章数据。原始元信息与历史备份仍留用户data，仓库只记录计数、散列与实现。

## 2026-10-22 MP Tools历史修复依据（D-062）

实际安装EXE中articles/account_pool代码与本机源编译散列一致；以真实安装代码的离线失败重现和运行中localhost目录响应为依据。界面仅本地缓存恢复并明确历史未齐；上游实际HTTP499/-2014，无账号轮换、终端激活或替代受限接口访问。广外就业53篇来自本机CampusOS_collector/reading已保存阅读副本，保留publishedAt/observedAt/URL，不伪造新采集。补丁与凭据备份只留程序data，工程证据不含凭据或全文。详见WECHAT_MP_TOOLS_HISTORY_REPAIR.md。

## 2026-10-22 缺失补抓执行来源（D-063）

原生MP Tools当前注册名录78个、排除三账号后75个；已有412篇范围内HTML由嵌入元信息原文URL/发布时间去重。2026-10-22 13:25:58真实目录响应仍499/-2014，实际返回为本地列表，不计线上成功。续抓日志/状态存程序data，本轮没有下载新原文或引入新上游/付费数据源。

## 2026-10-22 MP Tools历史浏览专项证据（D-065）

来源：实际D盘v5与原始2.2.4 EXE字节对照、原mp/chapters单次请求、原生窗口AX与本机既有阅读HTML。实际请求HTTP499/-2014，未取得新历史列表或文章。新标题HTML输出与分页仅通过授权的离线真实打包函数/界面边界回归，不记作新的采集来源。原CDN图片和背景引用保留，媒体本体不另存；不新增许可或可采集覆盖结论。证据verification/mp-tools-history-browse-2026-10-22.json，含凭据的备份仅留用户data目录。

## 2026-10-22｜WeRSS 与 MP Tools 共享阅读 HTML（D-066）

上游项目：https://github.com/rachelos/we-mp-rss 。本机入口为 http://localhost:8001 ，继续使用现有78个订阅、正常 AK-SK API 与原六小时任务。新增适配器只 GET 已保存文章列表/详情，不调用 refresh、上游微信或终端激活。AK/SK 引用既有本地排除文件，未打印或提交凭据。

文章身份沿用公众号 __biz 与 MP_WXS 数字映射；标题、发布时间、URL 来自实际 WeRSS 记录，已存在于共享目录时按原 URL 跳过，不以同名推断身份。以容器实际 Asia/Shanghai 时区解释 created_at 的无时区存储值，保留记录的真实观察时间，不把新导出时间当作上游新观察。原始 content 经清洗保留安全样式和微信 CDN 引用；不下载图片副本、不复制到 public/ 或 R2。

负责人 D-056 的公开阅读指令和既有78限源权限继续生效，不自动提升学校官方认证或取得独立外部版权证明。WeRSS 状态删除和文件消失均不作为 CampusOS 删除依据（D-066）。本机容器数据库仍无宿主机挂载，本轮没有重建容器或更换存储。真实正文转换仅以已保存文章为验证材料，隔离产物留在 test-results。

## 2026-10-23｜官网多栏目入口勘查（D-067实施）

名录来源为本地 `data/console/source-catalog-2026-10-17.json` 的109条`official_web`候选，不读取当前D1。使用本地安全HTTPS探针只读请求robots、首页、同源sitemap及少量首页栏目候选；请求复用DNS公网地址校验、拒绝重定向、robots路径规则和每源请求间隔，不读取登录态、不收集正文、不写云端文章。

本次勘查计109个来源、640次外网请求：85个首页HTTP 200；发现718个栏目/页面候选，其中207个候选列表页返回200且含至少3个文章样式链接，分布71个来源。29个来源没有发现明显候选，24个首页未成功读取；连接重置、拒绝、HTTP错误、证书错误和私网地址均单独记录。候选发现不等于规则核验、采集许可或自动启用。

逐站证据与全部候选URL见[官网栏目入口发现报告](官网栏目入口发现-2026-10-23.md)，机器回执保留在忽略目录`test-results/official-web-route-discovery-2026-10-23-all.jsonl`。没有将候选入口自动写入D1；需逐站配置入口、文章路径和选择器，并复核访问策略后才能调度。

### 2026-10-23候选入口后台状态核对

使用本地 `官网栏目入口发现` 和 `官网文章路径抽样` 报告生成73个来源、203个入口和217个路径前缀的候选配置。对之前网络失败/未验证的候选再按robots、同源HTTPS及每站节流复采12页，其中12页含至少3条文章链接。代码读取Preview D1时发现相同候选配置已保存；重跑导入预检为73条匹配、0条待写入，因此没有重复更新D1来源版本或许可。新Worker修复严格Schema对`configurationStatus`字段的兼容，现显示为待核对候选。入口和路径样本是公开网页证据，不代表机器人政策、全文版权或许可已批准；本轮未抓文章正文。

## D-069｜MP Tools Docker 迁移数据（2026-10-23）

来源为负责人提供的D:\WeChat MP Tools_v2.3.1及其C:\Users\zhuju\Desktop\WeChat MP Tools_v2.3.1备份；79个收藏公众号、79个订阅、749篇已有HTML均沿用原身份与原文元信息，不新增来源授权。文章库按原位置挂载给本机容器，逐文件散列一致，未复制微信CDN图片或背景文件。唯一新上游取证为原接口/mp/chapters的count=1请求，实际HTTP499/-2014，无文章数组；未把失败结果作为新文章或采集成功。凭据和正文留在本机忽略目录，公开工程记录只保存数量、路径和状态。

## 2026-10-24｜图书馆单栋建模参考

负责人交付文档包assets/source_maps/广外地图/细节中的图书馆正面.jpg、图书馆侧面.png、图书馆正面.png、图书馆正面6.png、图书馆正面2.png及Downloads/图书馆俯视.png；后者原像素复制到文档包assets/model_references/library-v1保存。文件名数字无意义。6个原文件路径、字节和SHA记录docs/model-previews/library-v1/design.json。部分照片有知乎作者水印，原发布链接、拍摄年份和照片公开再利用许可未提供；只作内部几何观察，不进入public、预览图片端点或模型纹理。本轮未新增网络影像、瓦片或供应商模型采集。

平面依据继续为固定OSM图书馆way307250998（https://www.openstreetmap.org/way/307250998），来源map.osm和现行campus.json/mapVersion。原way无height/building:levels，中庭内环也不是源数据。负责人本轮明确确认六层；视觉设计采用约27.25米屋面、约30.65米顶部、14.4米附楼，均未实测。照片近似的中庭与立面仅保存在独立评审数据，不修改地点、路网或OSM高度覆盖率。自有零贴图程序几何包含OSM署名；资产哈希与源轮廓校验见manifest.json/asset-checks.json。

## 2026-10-24｜图书馆、总务后勤部、马克思主义学院官网文章

| 信息源         | 官网                          | 已配置栏目                                                                                                                                                                   |
| -------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 图书馆         | https://lib.gdufs.edu.cn/     | /xwzx/bgtg.htm、/xwzx/twxw.htm、/xwzx/zydt.htm、/xwzx/ztdg.htm、/xwzx/xxgs.htm、/xwzx/xkfwjb.htm、/xwzx/tgzn.htm、/xwzx/cai/cgtz.htm、/xwzx/cai/jggs.htm、/xwzx/cai/fazj.htm |
| 总务后勤部     | https://hqc.gdufs.edu.cn/     | /tzgap.htm、/bszn.htm、/djgz.htm                                                                                                                                             |
| 马克思主义学院 | https://marxism.gdufs.edu.cn/ | /index/xyxw.htm、/index/tzgg.htm、/index/xsdt.htm、/index/mtjj.htm、/index/shsj.htm                                                                                          |

负责人指定抓取2026-09-01至2026-10-24发布日期。三个来源完成36篇正文文本抓取，D1新增32篇、更新4篇；均为草稿，0篇自动发布。原日期来自详情页或栏目列表，所有结果在日期界限内。三个robots.txt响应404；本次栏目页和文章详情均为HTTP 200。逐篇标题、链接、日期和字符数见 verification/official-web-collection-2026-10-24/articles.md；抓取/执行记录见同目录README.md。

本次遵照负责人指示采集全文文本并保存在Cloudflare D1，后台不自动公开。内容为去脚本/样式后的纯文本，未复制原网站HTML/CSS、图像文件或外链资源。

2026-10-24负责人随后要求发布上述36篇；管理员发布接口36/36成功。Preview后台公开可见筛选复核为图书馆22篇、总务后勤部2篇、马克思主义学院12篇。负责人指定的自动发布只作用于`official_web`，公众号仍由本地工具采集。

## 2026-10-24｜10个既有官网入口文章及D1查询证据

只使用既有已配置入口，没有继续入口查找。抓取范围为2026-10-01至2026-10-24。管理员文章接口返回公开68篇：广东外语外贸大学18、广外新闻网23、学生工作部14、校团委6、研究生招生信息网7。教务部、招标采购中心、本科招生网、学生就业创业服务平台、人力资源部通过现有配置路径未返回范围内文章。六月份图书馆文章回填另列，不计入该68篇。

新增手动登记验证证据：Preview `/api/admin/v2/sync`对已选10站之一教务部返回HTTP200、`registered=1`；对应D1作业随后completed，0篇、0错误。其余全站来源未因该验证而启动。

Rows read基线来自Cloudflare Wrangler只读命令`wrangler d1 insights campusos-preview --env preview --time-period 1d --sort-by reads --limit 15 --json`，应用新Worker/0039前记录的前列语句与累计行数写在[D1读取优化记录](D1_READ_OPTIMIZATION.md)。0039和0040迁移已成功应用Preview数据库，Preview公开分类、已选单源文章、总览、公众号统计接口在部署后均HTTP200。新分组SQL早期Insights为分类计数22,964行/2次、分类取前N篇9,020行/7次；来源限定文章计数新查询平均1,080行/16次，旧查询平均1,488行/98次。1日窗口混合部署前后、调用数不同，只作为初步结果，不推算全站正式降幅。没有执行生产数据库迁移。

`EXPLAIN QUERY PLAN`通过同一Preview数据库只读执行，0039的10个新索引及0040的雷达分类索引均出现在相关查询计划；每条Explain的D1 `rows_read=0`、`rows_written=0`。该执行计划只证明寻址方式已改变，并不代表实际线上读取总量。


## 2026-10-24｜艺术楼建模资料

负责人指定文档包assets/source_maps/广外地图/细节中的艺术楼2.png、艺术楼0.png、艺术楼1.png、艺术楼右侧面1.jpg、艺术楼背面3.png，并提供Downloads/艺术楼俯视.png；俯视图原像素另存文档包assets/model_references/art-building-v1。六图路径/字节/SHA保存docs/model-previews/art-building-v1/design.json，文件名数字不参与建筑推断。原发布URL、作者/拍摄年份和图片公开再利用许可未提供，原图只作内部观察，不进入public、预览图片端点或GLB纹理。本轮无外网影像/供应商模型采集。

地理轮廓沿用负责人map.osm及固定campus.json的OpenStreetMap way1389970391（https://www.openstreetmap.org/way/1389970391），原way没有height/building:levels。负责人本轮确认艺术楼主体5层，不沿用图书馆6层或宿舍21米。屋面21.55米、女儿墙22.15米、灰色附楼11.8米、最高顶部通风构件23.65米及立面/采光顶尺寸均为显示估算。开放院落属于原外轮廓凹口，不新增内环；模型几何自有生成、零照片纹理并保留OSM署名，不把显示参数写成导航或实测事实。

## 2026-10-24｜官网正文中的VSB媒体附件

官网详情页可能不含HTML正文，而是通过VSB iframe或固定`showVsbpdfIframe`/`showVsbVideo`调用呈现附件。采集器从这些节点只提取同源HTTPS的`/virtual_attach_file.vsb`链接，校验`afc/oid/tid/nid/e`参数后，PDF以文章内链接展示，MP4以视频播放器展示。此数据来自官网已配置文章详情页，不是新入口发现；未执行页面脚本，也未下载外站附件文件。实见样例为信息公开网站 `/info/1224/3438.htm`、`/info/1224/3261.htm`、`/info/1224/2983.htm` 和中国语言文化学院 `/info/1133/9057.htm`。


## 2026-10-25｜大会堂单栋建模资料

负责人交付文档包assets/source_maps/广外地图/细节中的大会堂正面1.jpg、大会堂右侧298.png、大会堂8.png、大会堂2.png、大会堂1.png、大会堂正面29.png和Downloads/大会堂俯视.png；后者原像素复制到文档包assets/model_references/auditorium-v1。七图字节、原路径、SHA记录docs/model-previews/auditorium-v1/design.json，文件名数字无层数/尺寸意义。原发布链接、年份和照片公开再利用许可尚未补齐；仅内部几何参考，原图不进入public、预览端点或GLB纹理。本轮未采集外网影像、地图瓦片或供应商模型。

平面继续使用负责人map.osm及现行campus.json的OpenStreetMap way307250997（https://www.openstreetmap.org/way/307250997），原对象无height/building:levels。负责人4层楼高为外观体量描述，不作为已核验室内层数。照片近似拱顶/层高/低翼和院落尺寸保存在显示稿，最高约22.4米等不是实测事实。两院落原OSM无内环，显示开洞不写回地理/导航数据。自有零照片纹理几何保留OSM署名，哈希及外环面积核对见manifest.json/asset-checks.json。


## 2026-10-25｜B8学术报告厅建模资料

负责人提供文档包assets/source_maps/广外地图/细节中的学术报告厅234.png、学术报告厅背面29.png、学术报告厅1.png、学术报告厅2.png、B8学术报告厅正门.jpg及Downloads/报告厅俯视.png，后者原像素复制到文档包assets/model_references/b8-lecture-hall-v1。六图路径/字节/SHA记录docs/model-previews/b8-lecture-hall-v1/design.json。文件名数字不代表建筑参数或拍摄先后；参考图中的施工状态不据此解释为当前状态，临时脚手架/残料未制作成永久构件。原发布链接、年份和照片公开再利用许可待补，只内部观察，不复制到public、预览图片端点或GLB纹理；本轮无外网影像/瓦片/供应商模型采集。

平面继续使用负责人map.osm及固定campus.json的OpenStreetMap way651642991（https://www.openstreetmap.org/way/651642991），名称沿用负责人确认的B8学术报告厅。原way无height/building:levels。负责人2层楼高是外部体量依据；屋檐7.05米/浅脊7.5米、屏墙8.9米、后部高体块10.6米/女儿墙10.95米、前厅5.6米等为视觉估算，不是实测楼高或室内分层证据。原矩形轮廓保持，曲墙/分部为照片近似显示，零图片纹理的自有程序几何保留OSM署名，不写入正式GIS/导航入口。


## 2026-10-25｜行政楼与八角楼建模资料

负责人提供文档包assets/source_maps/广外地图/细节中的校行政办公楼123.jpg、校行政办公楼正面99.png、校行政办公楼34.png、校行政办公楼.png、八角楼9.png，以及Downloads/校行政办公楼和八角楼俯视.png；后者原像素复制到文档包assets/model_references/administration-complex-v1。六图路径/字节/SHA见docs/model-previews/administration-complex-v1/design.json，文件名数字无建筑参数意义。原发布链接、拍摄年份和照片公开再利用许可待补，只内部观察，不放入public、预览图片端点或GLB纹理；本轮无外网图像/瓦片/供应商模型采集。

平面为固定campus.json/map.osm的OpenStreetMap way307437432（https://www.openstreetmap.org/way/307437432）及既有负责人确认owner-bajiaolou原8顶点/父ID。八角楼来自父轮廓，不虚构独立OSM way。父/子原GIS和标签坐标保持；主楼/低附楼/门廊/连接段的内部切分是显示近似。行政4层/八角1层高度依据为本轮负责人说明；米制层高、坡顶峰值、门廊/角塔/连接段尺寸未实测，原height覆盖率不提升。自有几何零照片纹理，保留OSM署名；六文件共用父楼WGS84原点，以清单origin加载，避免子楼二次偏移。


## 2026-10-25｜院系办公楼建模资料

负责人交付文档包assets/source_maps/广外地图/细节中的院系办公楼.png、院系办公楼正面11.png、院系办公楼89.png和Downloads/院系办公楼俯视.png；后者原像素存文档包assets/model_references/faculty-office-v1。四图路径/字节/SHA在docs/model-previews/faculty-office-v1/design.json，文件名数字不代表层数、尺寸或时序。原发布URL、拍摄年份、照片公开再利用许可待补，仅内部观察，不放入public、预览图片端点或GLB纹理。本轮无外网影像/瓦片/供应商模型采集。

地理依据为负责人map.osm及固定campus.json的OpenStreetMap way307437431（https://www.openstreetmap.org/way/307437431），原E形轮廓、名称、原点和两处庭院凹口保持，原way无height/building:levels。负责人本轮4层楼高为外部体量依据，层间距、屋檐14.75米、主坡顶17.85米/角塔18.1米、门廊峰13米等为视觉设计参数；内部楼层布局未核验。门廊/台阶/轻型连接为显示近似，不新增正式GIS分部、通行事实或入口。自有零照片纹理几何保留OSM署名，原资料和模型SHA见manifest/asset-checks。


## 2026-10-25｜实验楼A—E建筑群建模资料

负责人提供文档包assets/source_maps/广外地图/细节中的实验楼侧面1.png、实验楼1.jpg、实验楼2.jpg、实验楼3.png、实验楼A-B栋.png、实验楼D-E连接处.png、实验楼E栋11.png及Downloads/实验楼A-E栋俯视.png；后者原像素复制到文档包assets/model_references/laboratory-a-e-v1。八图路径/大小/SHA见docs/model-previews/laboratory-a-e-v1/design.json，文件名数字不表示层数、尺寸或时序。原发布URL/拍摄年份/公开再利用许可待补，仅内部观察；不放入public、预览图片端点或GLB纹理。本轮无外网影像、瓦片或供应商模型采集。

地理依据为负责人map.osm及现行campus.json中的OpenStreetMap relation4105911（https://www.openstreetmap.org/relation/4105911），外环/三个真实中庭内环及A—E五标签保持。标签已绑定父楼，不能视作精确分栋边界。负责人5层楼高为外部体量依据，层间距/屋架18.45米/服务房最高20米及各立面内部切分是视觉估算，不回写高度或室内楼层事实。自有程序几何零图片纹理，保留OSM署名；照片不提供新的GIS/导航入口或通行事实。


## 2026-10-25｜教学楼A—D与C栋钟楼建模资料

负责人提供文档包assets/source_maps/广外地图/细节的教学楼c栋1.jpg、教学楼c栋.jpg、教学楼A栋正面.png、教学楼C栋左部分.png、教学楼C栋2093.png、教学楼C栋及其与D栋连接处.png、教学楼B、C栋.png、教学楼A栋.png、教学楼D栋.png、教学楼C、D栋.png、教学楼整体.png，以及Downloads/教学楼C-D栋俯视.png、教学楼A-B栋.png；两俯视原像素副本保留文档包assets/model_references/teaching-a-d-v1，13图路径/大小/SHA见docs/model-previews/teaching-a-d-v1/design.json。文件名数字无参数/时序意义，整体照片不扩大E/F/G范围。原发布URL/年份/公开再利用许可待补，只内部观察；不放入public、图片端点或GLB纹理，本轮无外网影像/瓦片/供应商模型采集。

地理依据为负责人map.osm与现行campus.json中的OSM way1410412694（A，https://www.openstreetmap.org/way/1410412694）、relation19299171（B，https://www.openstreetmap.org/relation/19299171）、way1410412691（C，https://www.openstreetmap.org/way/1410412691）、relation19299170（D，https://www.openstreetmap.org/relation/19299170）。四外环与B/D真实内环保留；C原北侧五顶点凸出处按照片匹配为钟楼、和主体分部面积保持，不另造独立clock ID。

主体5层/钟楼8层楼高来自负责人说明，米制主屋面18.1米/构架21.4米/钟楼顶31.2米/侧鳍32.05米等为视觉参数；钟楼位置匹配、架空门洞/廊道与两跨栋连接细部不是实测新GIS。十GLB共用C原点，组件位置已编码。自有纯几何模型保留OSM署名，双面钟刻度/固定指针不使用照片或实时校钟数据，不宣称室内楼层/入口/通行核验。


## 2026-10-25｜B栋钟楼位置与朝向负责人更正

负责人新提供Downloads中的钟楼2.jpg、钟楼1.jpg、b栋钟楼.png、b栋钟楼位置.png、b栋钟楼俯视.png，以及消息内主钟面向外箭头，明确钟楼属于B栋红框外侧转角，撤销此前C凸出处照片匹配。五图原像素副本存文档包assets/model_references/teaching-a-d-v2，与旧13图共18条SHA见docs/model-previews/teaching-a-d-v2/design.json。旧照片文件名C栋字样不作为归属依据。图片仍仅内部参考，不上传public、预览图片服务或GLB纹理。

当前clock实体绑定B osm-relation-19299171（https://www.openstreetmap.org/relation/19299171），沿原转角边界切出估算6.4×9米体量，B剩余外环与塔体面积之和保持，两个院落不封顶；C osm-way-1410412691原高塔恢复五层。主钟面/下方玻璃面按箭头朝外，局部平面法向约[0.99994,0.01111]。米制尺寸和现场精度未实测，不把红框当成新增精确GIS。十GLB继续共用既有C坐标原点。原V1留作错误位置历史，当前3021服务为V2。


## 2026-10-25｜教学楼E—G建模资料

负责人交付文档包细节目录的教学楼G栋.png、教学楼E栋43.png、教学楼E栋.png、教学楼整体.png、教学楼F栋.png、教学楼F-G栋连接处及G栋.png、教学楼EFG.png，及Downloads/教学楼EFG栋俯视.png。俯视原像素副本存文档包assets/model_references/teaching-e-f-g-v1，八图路径/字节/SHA见docs/model-previews/teaching-e-f-g-v1/design.json。文件名数字无尺寸/层数/时序意义；原URL/年份/公开复用许可待补，仅内部参考，不公开原图或用作纹理。无新增外网图像/瓦片/供应商模型采集。

平面沿用现行campus.json/map.osm的OpenStreetMap relation4105730（https://www.openstreetmap.org/relation/4105730），原四环及E/F/G三个节点/父关系保持，不把节点当分栋足迹。主楼5层为负责人本轮依据；米制高度/院落廊道退让/前部体块高低和架空/屋顶构架/入口/梯均为照片近似显示。内部显示分部面积与原父净面积保持，不改正式GIS或导航。整体照片中钟楼只作上下文，现有B栋钟楼修正不变。本组自有零照片纹理几何保留OSM署名。


## 2026-10-25｜体育馆建模资料

负责人交付文档包细节目录的体育馆3.png、体育馆.png、体育馆19283.png和Downloads/体育馆俯视.png；俯视原像素副本存文档包assets/model_references/gymnasium-v1，四图路径/字节/SHA见docs/model-previews/gymnasium-v1/design.json。文件名数字无层数/尺寸/时序意义，原URL/年份/公开复用许可仍待补，仅内部观察；不公开原图/瓦片或作为GLB纹理。本轮无外网影像/供应商模型采集。

地理依据为现行campus.json/map.osm的OpenStreetMap way1389756844（https://www.openstreetmap.org/way/1389756844），原80点椭圆和名称体育馆（羽毛球场）保持。负责人5层楼高为外部尺度依据；主屋面24.4米/拱带25.55米、墙顶随曲面变化、东西尖端悬挑/入口尺寸为视觉估算，不能回填为实测GIS。南北各五条采光条来自俯视观察；前景杆索归属未核验。原点沿用体育馆WGS84标签点，自有纯几何模型保留OSM署名，无室内平面或新增通行事实。


## 2026-10-25｜统一内容分析的真实语料与报名标记

只读快照来自现有Preview D1官网/公众号文章1773篇，保留既有来源用途权限，没有新增抓取平台或下载图片至D1；原reading HTML/CDN不改。真实标注/核对样本只提交有限摘录、标题、ID和原文地址，不将全量文章正文放入测试仓库；本地分析语料在忽略目录。

同源双栏目例：国际学院官网 https://ic.gdufs.edu.cn/info/1558/6887.htm （参访动态）与 https://ic.gdufs.edu.cn/info/1486/4730.htm （生活指南）；广外就业 https://mp.weixin.qq.com/s/yzCQHsCBVXaXTmdd4NIyeQ （招聘宣讲）与 https://mp.weixin.qq.com/s/2lvGVw97fFI_sg2ZBqrjSQ （就业协议指南）。金融大赛报名证据来自 https://mp.weixin.qq.com/s/yyaRAenHDPn8OtRXYLKCCw 。来源许可沿用已有入库/公开依据，不把分类视作新增正文授权。

负责人提供pkuknow.cn“报”字截图为交互样式参考；实际使用自有CSS/文本，不复制原站图片/代码。公开截图和当前源站新增5篇实测记录见docs/verification/article-analysis-2026-10-25。

## 2026-10-26｜S3-D真实检索验收语料

复用Preview中已有、当前可公开且正文用途允许的官网/公众号文章，未重新抓取入口或改变来源许可。实例：广外图书馆《新生入馆指南》https://mp.weixin.qq.com/s/Z8GsLRQptG8Pa3lQFbpTEw；《金秋阅新》https://mp.weixin.qq.com/s/NBtUOT9gSaFqSSM4BImKIQ（原文书展日期2026.9.22—9.24，技术验收明确历史，不当作当前可参加）；既有官网研究生奖学金通知。具体documentId、来源、发布日期、正文片段与当前分类见docs/verification/s3-d各真实查询JSON。来源使用权限沿现有公开与正文范围复核，不把检索命中升级为新的来源许可。

## 2026-10-26｜按需外部搜索来源及使用边界

负责人授权参考https://github.com/xpzouying/xiaohongshu-mcp及https://github.com/Panniantong/Agent-Reach。采用专用小红书只读本地会话，不导入社交正文至公开D1语料，不下载图片或作为地图资料。实际镜像v2.5.5、固定digest见services/external-search/setup.mjs；本轮未登录、未取得真实笔记，不声称平台授权或公开检索成功。

通用网页适配Exa MCP（https://exa.ai/docs/get-started/exa-mcp），官方文档说明免Key限流及x-api-key认证。本机真实搜索得到https://lib.gdufs.edu.cn/fwzn/fwqykfsj/dzjyqxb.htm与https://lib.gdufs.edu.cn/fwzn/fwqykfsj/tsjygz.htm，结果仅搜索摘录，不冒充全文/当前有效性。Preview被403拒绝，尚无公网外部证据。来源分级、真实响应与网络边界见docs/verification/external-search。

## 2026-10-26｜小红书实际登录与公网外部引用

负责人本人扫码，专用本机会话确认登录；通过xpzouying/xiaohongshu-mcp实际搜索20条笔记并取得正文。公网Agent真实引用《广外居然还有四饭！》《广外｜饭堂和周边美食由夯到拉排名！》等，仅作学生经验；具体URL、发布日期和有限证据见docs/verification/external-search/xhs-logged-in/acceptance.json及关联浏览器回执，不下载/发布笔记图片或地图，不自动入公共文章语料。

Exa免Key接口由本机执行，出站回传既有Preview。真实官方借阅权限表、规则和MDN来源已在回答中显示；只搜索摘录时保留search_excerpt，不冒充取得全文/政策现行。原入站Tunnel仍失败、第三方偶发失败与本机在线依赖均保留说明，没有购买额外服务。

## 2026-10-26｜持久Edge小红书来源

当前来源通过用户已授权的专用Edge会话正常访问公开搜索/笔记；真实南校食堂帖子含一饭文采园及具体个人推荐，URL、日期、有限摘录见docs/verification/xhs-persistent-session/south-canteen.json。不是校方菜单，未据此确认当前营业/价格。源码只读页面公开状态，不读取私信/收藏或日常浏览器资料，不批量复制图片，不自动入公共文章语料。参考xpzouying/xiaohongshu-mcp的公开数据形状，Apache-2.0通知与许可证见services/external-search/THIRD_PARTY_NOTICES.md；工具许可不等于帖子再分发授权。

## 2026-10-26｜总览统计和小红书登录状态

访问量来自CampusOS自身前台客户端真实导航及D1服务端日期聚合，自2026/10/26 19:27:02起记录；参考截图与https://pkuknow.cn仅供卡片/图表视觉参考，未复制其统计数字或资源。小红书登录状态及二维码来自现有专用Edge中的https://www.xiaohongshu.com/explore真实页面；只向管理员提供短期登录维护，不公开账户Cookie。隔离匿名profile提取PNG成功；真人扫码未在本轮重复执行。证据见docs/verification/admin-dashboard。
# 2026-10-27｜云端联网搜索与管理员来源会话

负责人授权的普通联网搜索沿用Exa免Key模式，在Cloudflare Node Container执行；代表性真实来源为 https://lib.gdufs.edu.cn/fwzn/fwqykfsj/tsjygz.htm 与 https://lib.gdufs.edu.cn/fwzn/fwqykfsj/dzjyqxb.htm ，Agent公开引用已验证。外部片段仅即时问答，未入公开文章库或批量复制图片；search_excerpt不冒充已独立读取整页。

小红书/Rednote使用本人授权的专用云端浏览器正常登录页，实际出现 www.xiaohongshu.com、edith.xiaohongshu.com、webapi.rednote.com。加密存储仅用于该会话；没有上传Windows日常profile。原生搜索当前login_required，0结果，不新增“云端已可用”来源声明。禁止以社交经验确认学校政策或申请时限。

Cloudflare Live View接管依据：https://developers.cloudflare.com/browser-run/features/live-view/ 。短期链接只向管理员返回，不能公开、入引用或入Git。没有抓取/再分发第三方地图；原来源分级与许可边界保留。详 docs/CLOUD_SEARCH_MIGRATION_2026_10_27.md。


## 2026-10-27｜体育场看台建模资料

负责人提供细节目录的体育场.jpg、体育场背面.png、体育场侧面19238.png、体育场203.png、体育场.png、体育场正面345.png、体育场5.png，以及Downloads/体育场俯视.png；俯视原像素副本存文档包assets/model_references/stadium-v1。八图路径/字节/SHA见docs/model-previews/stadium-v1/design.json，文件名数字无层数/尺寸/时序意义。原URL/年份/公开复用许可仍待补，仅内部观察，不公开原图、瓦片或用作GLB纹理。

几何取固定s1-2026-10-14.2当前/maps/campus-15060d099418.geojson的OpenStreetMap way1389756836（https://www.openstreetmap.org/way/1389756836）独立看台建筑轮廓，原地点真草场way1389756837与跑道relation19176025只作关联/方向依据并保持几何。看台位于场地西侧，模型座席朝向源场地一侧；GLB原点用原体育场地点坐标，映射/旋转记录manifest，不能重复平移或将看台轮廓写成球场足迹。

本轮未提供层数/米制高，雨棚/桁架/双高杆、拉索锚点、排距/席位及后部楼梯为照片近似，约20/22/35.5米不是实测事实，合成席位数不作容量发布。当前八图支持本次看台杆索外观制作，不据此改动已有体育馆模型。自有零图片几何保留OSM署名，无新增导航入口或室内结构核验。
## 2026-10-27｜redbook0.8.2 候选实现核验

只读测试依赖 https://github.com/lucasygu/redbook 的已发布npm包@lucasygu/redbook@0.8.2（MIT），安装脚本禁用，未复制其算法进产品。仅通过本人专用来源会话验证固定的身份/搜索/笔记详情接口，未读取日常浏览器。全球访客实际搜索code=-104，0笔记、0正文；无新增校园文章或地图数据。真实输出与Fixture分开，见 verification/redbook-evaluation-2026-10-27/；不将软件兼容性或HTTP200标为内容获取成功。
## 2026-10-27｜redbook新授权后的真实公开笔记证据

本人在专用浏览器正常登录授权后，redbook0.8.2在本机与独立Cloudflare容器使用同一份独立加密快照；原站身份/搜索/正文API实际成功，不自行改签名、换代理或处理验证码。关键词包括广外南校一饭、南苑宿舍、南校食堂推荐。真实来源示例为 https://www.xiaohongshu.com/explore/68d40b05000000001300e27a （公开个人饭堂推/雷体验，2025年）与 https://www.xiaohongshu.com/explore/6a9d2b560000000012024de5 （公开食堂体验，2026年）。完整可打开的原文链接随回执保留，接口实际公布时间与取得时间独立。

仅作为学生经验/线索，不验证作者学生身份、不确认政策时限或当前营业。模型真实调用并引用两篇正文，精确引句核对通过；未将笔记、图片或评论入公开文章库/官方RAG，不改地图。公开交付保留文本哈希/长度与最短引句节选，完整临时验收材料留忽略目录，运行时不回读冒充搜索。Cookie及密钥不在回执/Git/模型输入。精确范围、版本和未完成项见 verification/redbook-evaluation-2026-10-27/README.md。

## 2026-10-27｜小红书新账号云端授权与临时经验引用

负责人本人在全新Edge资料目录完成新账号授权，源站非游客确认后仅导出必要会话，私有API再次复核后AES-GCM存私有R2；不记录身份或Cookie到本文件。主账号停用，旧Browser Run自动恢复路径已关闭。真实Preview使用redbook0.8.2只读搜索及最多2篇正文片段；最终样本引用真实笔记6aae9346000000002a02e1f5，原文链接保留在verification/redbook-switch-2026-10-27/next-account/rendered-citations.json。

学生口味只属作者体验，不确认官方规定、现行营业或地理坐标，不入公共文章库。源码依据https://github.com/lucasygu/redbook；账号授权不等于平台提供官方通用API或永久稳定许可。原文长片段及完整模型输出只留本机忽略目录，公开验收保留哈希/长度；运行时不使用这些回执生成搜索结果。

## 2026-10-27｜官方任职依据与公开站内检索

实际依据包括学校网上校史馆https://history.gdufs.edu.cn/dsb1/dxyr.htm、聘任报道https://www.gdufs.edu.cn/info/1106/59757.htm、学院介绍https://zwxy.gdufs.edu.cn/info/1333/9068.htm及教师目录https://bcdlab.gdufs.edu.cn/ry/js.htm。任职头衔与科研项目负责人不是同一类别；举办讲座的校区不证明任职校区，未建立按校区的权威人员名册。

公开站内搜索协议取自官网首页及/aop_views/search/modules/resultpc/js/soso.js，调用公开tourist模式、全文范围3，保留原公开过滤，最多首页10条/4结果/2正文，不使用学校账号、Cookie或私有接口、不执行脚本或处理验证码。只有HTTPS官方域静态HTML可作直接正文，访问失败/只有摘要如实标示。原文链接及证据保留，临时读取不自动入公开知识库；没有据公开访问宣称获得通用商业API许可。失败和最终真实验收见verification/agent-official-facts-2026-10-27/。


## 2026-10-28｜Agent工程与大肥鱼风格参考

- https://github.com/ERUIHNIYHBKBNF/dafeiyu-persona ，固定5b08af8353fcfcc1378ea73f33686d669d61703f；完整读六份指定文件，MIT，归属及原文许可证保留。只参考表达方法，不采用厂商/社区身份和攻击台词，不作为校园事实资料。
- 工程资料来自OpenAI/Anthropic官方Agent、评测和上下文文档，链接见AGENT_RELIABILITY_RESEARCH_2026_10_27.md。
- 对照证据为实时读取的广外中国语言文化学院戴建业介绍（2023-09-06，https://zwxy.gdufs.edu.cn/info/1333/9068.htm）；不能据旧介绍确认2026完整名单/个人校区。
- Preview真实检索来源、日期和URL见验收JSON；小红书源站本次返回3笔记但未通过指定日期筛选，不作本周事实。只存验收回执，不新增公共文章或复制CDN图片。


## 2026-10-28 MP Tools当前账号清单

来源为负责人提供的D:\WeChat MP Tools_v2.3.1\data\articles_full、同级accounts.json/rss_subscriptions.json及已有HTML公开元数据。81目录排除.campusos-locks后80个，80个公开账号ID唯一；后台78公众号+2服务号匹配，无名称猜测合并。GW情报鹅沿原source-3c191a80-ca79-4fc6-a3bc-be9c3289cdf8恢复启用，广外无限漫协南校为GDUFS-WX-3073977870。正文仍来自已有本地导出并保留原链接/CDN；来源事实状态不伪造已核验，自动公开基于负责人指示而非宣称平台许可。回执见verification/wechat-discovery-2026-10-28/。


## 2026-10-28 校园餐饮问答真实来源与误引对照

受控复现仅输入用户公开原话，未读取其他用户会话。原误引为LSE留学经历、生活主题书展与新书标题中的味道词；未删除这些文章，只排除其作为本次广外饭堂推荐证据。正确内部候选含“信息i生活｜代码跑通前，先去食堂跑个图”等真实餐饮文章，原文写有一饭13元牛杂面/10.5元小火锅等；外部通过原有云端小红书/网页服务读到真实饭堂推荐、南校食堂攻略与食宿指南。

来源URL、作者名称、原发布日期、证据类型与片段哈希见verification/agent-food-2026-10-28/desktop.json、mobile.json。小红书公开笔记作为学生分享，不作学校政策最终依据；标题不冒充正文。未更改账号、购买数据服务、复制CDN图片或将第三方笔记自动写入公共文章库。

## 2026-10-28｜通用检索验收的真实来源与隔离样本

原Preview真实体育问题返回信息素养、信息安全和CFA竞赛；本轮修复后实际使用体育部羽毛球 https://tyb.gdufs.edu.cn/info/1032/2918.htm （比赛2026-10-31）和运动会 https://tyb.gdufs.edu.cn/info/1032/2948.htm （2026-11-20至21）。未来比赛日期不证明报名开放，规程附件未读取则报名/名额/对象未知。不同赛事/列表日期不混为一项。

其他真实依据为图书馆借阅规则 https://lib.gdufs.edu.cn/fwzn/fwqykfsj/tsjygz.htm 、借还说明 https://lib.gdufs.edu.cn/info/1207/5233.htm 、已存公众号《2027届毕业生电子就业协议书签订操作指南》 https://mp.weixin.qq.com/s/2lvGVw97fFI_sg2ZBqrjSQ 。保留原发布信息/届别/来源权威不确定性，不从不同版本拼出单套现行规定。标题线索《云山学术沙龙414期：学术论文写作全过程》无正文时仅提供元数据，不冒充全文。

22题标注集和8组检查器证据对均在隔离测试，不入D1；与真实Preview/API/Agent回执分开。公开交付只保留标题、原URL、时间、计量及文本哈希，完整受控片段留本机忽略目录，不作为运行时语料。小红书本轮真实搜索返回verification_required、0笔记/0正文，旧成功笔记不回读假冒本次结果；没有新增公开文章、批量复制图片、学校私有系统或来源登录操作。

## 2026-10-31｜负责人提供的 AI 悬浮球图案

负责人本轮明确要求将“蓝白长发徽章女仆少女22.png”用于校园助理悬浮入口，作为此处使用授权依据。原文件 C:/Users/zhuju/Downloads/广外奶龙娘/蓝白长发徽章女仆少女22.png；公开资源 /images/assistant/assistant-orb-e106e8f5026d.png，1254×1043透明PNG，1,425,767字节。SHA256 e106e8f5026da9a53887f52b5e210432e1571a521391e1b2f5c42b2d00e0c532，逐字节复制，未重绘或移除元素；圆形显示与蓝色光晕由CSS实现。该授权用于本轮入口图案，不据此宣称是学校官方吉祥物或扩展到其他来源素材。

实际悬浮球加载204×170透明WebP展示副本 `/images/assistant/assistant-orb-e106e8f5026d-204.webp`，47,828字节，SHA256 6e3edc9ce7f91e3d102bdc68789e5a8b60aa19b0627f855e67c16e58713f953f。仅缩小展示尺寸并使用无损WebP编码，保留透明通道，不重绘角色；原始PNG保持不变。此调整解决首屏直接加载1.4MB原图偏慢的问题。

## 2026-11-01｜S4事务邮件与密码安全检查

负责人指定腾讯云SES及自有发件域mail.zhiyuapp.site，凭据保存在私有anykey.md及Cloudflare Secrets。实际ap-hongkong API确认域名可发信，验证码模板228818和安全通知模板228817批准；SPF TXT为include:qcloudmail.com。以负责人授权QQ地址本人输入6位码完成真实验证及密码重置，验收后已解绑；不公开邮箱码、真实密码、Cookie、主密钥或发件凭据。没有购买套餐，发送配额不作为免费余额证明。

技术依据：[腾讯云SendEmail](https://cloud.tencent.com/document/product/1288/51034)、[Cloudflare Request及重定向](https://developers.cloudflare.com/workers/runtime-apis/request/)、[Workers crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)、[HIBP密码k匿名查询](https://haveibeenpwned.com/API/v3#PwnedPasswords)、[OWASP密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。HIBP仅发送SHA1前5位并请求padding，匹配与丢弃返回数据在服务端完成；不发送原密码或完整哈希。@noble/hashes锁定2.4.0，作为同成本PBKDF2兼容实现；不是新模型供应商、付费服务或用户密码快速哈希存储。
