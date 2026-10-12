# 数据来源与许可台账

更新时间：2026-10-12（Asia/Shanghai）

规则：发现来源不等于获得许可；每条数据在公开使用前需记录来源 URL、用途、许可状态、核验时间、负责人决定和数据版本。没有许可/地理核验的数据不进入正式地图、RAG 或活动地图标记。

## 已发现的来源

| ID      | 数据/用途                            | 来源                                                                                                                                               | 当前状态                                                                                         | 允许的当前用途/后续动作                                                              |
| ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| SRC-001 | 需求与产品约束                       | `CampusOS_Codex_完整设计文档_v2/PROJECT_SPEC.md`、`AGENTS.md`、`00_README_项目索引.md`、`01`–`12` 模块文档                                         | 原模块已完整阅读，12 为负责人批准的新增模型设置规范；均属于项目内部设计基线                         | 可指导实现；不代表对应功能或外部数据已经存在                                         |
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
