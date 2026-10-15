# S2-E｜Cloudflare隔离预览部署与云端验收

日期：2026-10-16（北京时间）。基线：`8ef2faa`。这是实际Cloudflare公网测试，localhost结果另列。本文的最终统计见末尾及`verification/s2-e/`，未测项不按通过处理。

## 1. 授权、套餐与隔离

负责人本轮明确允许仅创建`campusos-preview` Worker/D1、workers.dev公开预览、对新预览库迁移和配置Secrets。未授权生产库、正式DNS/域名、其他项目修改或Cloudflare付费升级。中途确认DeepSeek赠送余额为0后，负责人另外明确允许使用现有充值余额**最多人民币1元**，未充值。

Wrangler认证仍有效，账号与负责人指定账户一致。订阅API返回403，未扩大权限；从已登录Edge的Workers plans核实**Free / $0 / Current plan**。API`default_usage_model=standard`不能单独判定为付费。发布前：3个其他Worker、2个其他D1，无同名预览资源；D1总存储311296字节，当日UTC账户Workers125请求、D1读3694行/写0行。免费容量足够创建一个独立预览。

当前核对的[Workers限制](https://developers.cloudflare.com/workers/platform/limits/)：100000请求/天、CPU10ms/请求、128MB/isolate、50子请求/请求、未压缩Worker64MiB、启动1秒。当前[D1价格与额度](https://developers.cloudflare.com/d1/platform/pricing/)为每日500万行读/10万行写、总5GB；[D1限制](https://developers.cloudflare.com/d1/platform/limits/)为Free10库、单库500MB、每请求50查询。免费套餐可能安全拒绝超额，不等于所有代码天然满足CPU限制。

## 2. 实际资源与发布

| 项目          | 结果                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| Worker        | `campusos-preview`，已创建并实际发布                                    |
| D1            | `campusos-preview`，独立新空库，APAC                                    |
| D1 UUID       | `18299abc-b38b-4494-8d12-8ab4d482c304`，仅写入`env.preview`             |
| HTTPS URL     | **https://campusos-preview.zhujunkui1.workers.dev**，取自实际部署输出   |
| 当前版本      | `3545d51c-e112-4e4f-bce2-774951f9609c`                                  |
| Deployment ID | `5f922422-a1b8-4837-b310-9e028aa57fd5`，由实际部署API确认               |
| 发布入口      | `npm run deploy:preview`，显式`--config wrangler.jsonc --env preview`   |
| 绑定          | DB=预览UUID；WORKER_SELF_REFERENCE=同名预览；ASSETS；原MAP_RATE_LIMITER |
| 正式域名      | 未绑定gdufs.ccwu.cc，未改DNS/HTTPS/生产Worker/D1                        |

`env.preview.name`明确设置，`workers_dev=true`、`preview_urls=false`、`routes=[]`；生产段保持原值。预览专用`main=preview-worker.ts`复用原API处理函数，页面仍由OpenNext生成处理器承接。部署前本地守卫检查名称、入口、独立DB、无域名路由和自引用；防止误发布`campusos-preview-preview`。

中途Tail命令曾因“位置参数Worker名+env”尝试只读访问带双后缀名称，返回10007；改用仅`--env preview`从配置取名称，没有创建该错误名称的资源。部署始终是正确名称。

最初版本`5eeb6684-feda-4423-9868-e43e68deec86`；优化后`707b4a07-db97-4b21-b6fd-3c7c869ade4f`；当前版本进一步合并回执校验并限制查询等待。首次实际启动校验27ms，优化包最终117ms；这是部署时平台启动验证值，不是每个用户的冷启动延迟。最终包14762.03KiB（gzip2398.74KiB），98个资产文件，未使用R2/KV/DO/收费缓存或额外辅助Worker。

## 3. D1迁移与恢复

按顺序执行0001–0004，只对新预览UUID远程执行；未导入旧库/真实用户数据。审计无立即DROP/清库或业务种子；已有DELETE仅为路线容量触发器定义与已批准的到期保留策略。

首次0001–0003成功，0004返回7500 `incomplete input`。核查迁移表及sqlite_schema确认0004整体回滚，没有半套表，未删除或重建数据库。真实远程`EXPLAIN CREATE TRIGGER`最小对照显示：裸`SELECT CASE…END`失败，加括号后成功；本地SQLite两者都接受。修复仅在12个CASE外加括号，阈值、权限、触发器及表含义不变；与[Cloudflare SDK问题记录](https://github.com/cloudflare/workers-sdk/issues/4727)一致。历史已应用的本地0004不重跑；新预览首次应用修正版，哈希记录在`migrations.json`。

随后0004成功：**4迁移、34业务表、11触发器、外键检查0错误**。迁移后users/sessions均0。实际会话建立、路线保存/读取完成最小读写；另用拒绝的缺失外键INSERT检查约束，不留下虚构用户或业务种子。

云端实测：

- 游客随机Secure/HttpOnly Cookie，会话恢复；不同Cookie隔离。
- 自己的真实建筑路线可恢复，另一游客读取返回404。
- 只修改新建的自有测试路线元数据：错误地图版本返回422/ROUTE_UNAVAILABLE；明确过期返回404/NOT_FOUND。首次用本机“当前时间减1秒”得到200，且当时未断言fixture UPDATE成功，不能据此判定服务端过期检查失效；改用明确已过期值并断言UPDATE确实影响1行后返回404，未修改服务端有效期判断。
- 实际Worker版本更新后，用此前保存在本机忽略目录的测试Cookie恢复原对话和合法路线，未重新调用模型。
- 同一真实请求ID并发重发返回429，取消后无迟到路线/端点。请求次数与Token额度没有重置或放宽。

以上是实际云端D1；HKG边缘/NRT主库元数据不等于不同地区客户端验收，**真实多地域实例一致性尚未验证**。

## 4. Secrets与模型

预览5项均为`secret_text`：MODEL_API_KEY、MODEL_NAME、MODEL_BASE_URL、MODEL_CAPABILITIES_JSON、AGENT_SIGNING_SECRET。签名密钥新随机生成，与本地不同；其他项目密钥未读取/复制。仅复用负责人授权的DeepSeek凭据。秘密通过Wrangler stdin批量写入，未出现在命令参数/文档/截图/客户端。

管理员模型能力用真实API重新验证：3个受限请求，工具回传、最终流式和JSON Object+Schema通过；仍不声称严格JSON Schema。运行时status同时确认模型ready、storageReady，实际浏览器工具调用证明云端能够连接供应商。模型/签名密钥缺失仍安全拒绝，未引入Mock生产回退。

模型能力凭证24小时有效，本轮刷新时间见`model-capabilities/model-live.json`。正式试用前必须明确人工刷新运维；到期不能假装AI可用。刷新流程：管理员执行`model:verify`取得当前凭据绑定的真实回执，通过`wrangler secret put MODEL_CAPABILITIES_JSON --config wrangler.jsonc --env preview`受控stdin更新；改模型/密钥时同步更新相应Secret，**不轮换预览签名密钥**。不得从聊天或前端提交Secret明文。

## 5. 构建与凭据检查

标准安全包装器保留S2-D的三模式环境净化，只允许公开变量进入next-env默认值。预览额外先Wrangler dry-run编译实际自定义入口，再扫描`.open-next`和最终Worker bundle；发现秘密则构建失败、部署不继续。独立扫描另包含实际Cloudflare OAuth Token、MODEL密钥、本地/预览独立签名密钥和高德服务端安全值，不输出值。

固定OSM、547节点/2202边路网、原算法与S7几何/外观不改；GLB SHA仍`54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a`。公开资源只来自原已批准public，未发布参考照片或测试夹具。

## 6. 免费计划实际问题与最小优化

初包真实浏览器前7轮完成，第8轮连续追问触发`exceededCpu`；随后取消也有一次CPU超限。原始Tail只保存数值/路径模式，不记录头、正文、异常内容或SQL。不能用本地通过、首轮成功或部署成功覆盖这个失败。

实际观察初包页面CPU约32–501ms，Agent chat41–364ms。工具规划阶段原本已非流式，未重复实现该优化。实施：

1. 使用OpenNext官方[只读静态资产缓存及拦截](https://opennext.js.org/cloudflare/caching#ssg-site)，预渲染页面复用原ASSETS，无新收费资源，私有API/SSE不缓存。
2. 同一Worker中预览专用轻量分发器调用**原有**Assistant/Skill HTTP处理函数，使用OpenNext原请求AsyncLocalStorage绑定环境，保留Origin/身份/Schema/权限/额度/回执。页面继续使用Next/OpenNext；不是重写地图或Agent。安全头、Cookie、no-store和流体原样保留，未知路径不开放为工具。
3. 按不可变Schema对象复用冻结的JSON Schema元数据，并复用结果校验Schema；工具执行器/权限/业务结果不跨请求共享，原S2-D五秒读结果边界保持。
4. 将回执和运行中租约/所有权校验合成单个JOIN，保留两者条件；轮询250→500→750ms封顶，15秒约21次检查。chat统计到40条SQL语句时安全超时，留出最终化余量，避免无回执客户端耗尽Free50查询上限。

优化后初轮页面CPU约2–12ms，Chrome桌面/Edge手机完整业务链通过。**部分Agent请求仍大于10ms，不能据短期无错误宣称Free稳定容量达标。** 最终版本的具体分布与观测错误见末尾；CPU不是墙钟等待时间，Cloudflare允许偶发弹性不代表可长期依赖。未升级套餐。

## 7. 验收方法及边界

所有S2-E E2E的E2E_BASE_URL均为实际workers.dev HTTPS。Chrome148/Edge149桌面1440×900、手机视口390×844；手机视口和CDP触摸不是手机实机或Safari。真实模型与Mock故障测试分开归档。

真实Agent A–G加单独图书馆查询：搜索/候选、详情、附近食堂、S7→图书馆848.032639m/约12分钟/下沉隧道、实际路线、3D模型就绪、清路线、未知地点NOT_FOUND无动作、上下文连续追问。成功回执等待镜头/模型实际完成。手机图书馆查询初次测试在抽屉自动收起后直接查卡片失败；改由可见“问AI”入口重开，不用force或伪造终态。

公开API不存在任意SQL/调试管理入口，个人Skills未开放；客户端userId无效，未注册工具和无效地图动作拒绝。已有助手历史和路线均受可信Cookie主体约束。应用更新恢复、过期、版本、重复ID/并发和取消均有独立证据。

## 8. 性能和费用口径

Tail的CPU/wallTime是平台实际数值，路径中UUID脱敏；GraphQL提供账户/本Worker窗口汇总。D1 query meta提供实际行读写/SQL耗时。chat统计是结束前快照，不包含之后finish和独立claim/receipt HTTP。模型首字含工具规划、真实地图回执，再到最终文字；不是供应商网络TTFT。

**无法可靠逐次归因**：完整Worker/isolate内存、每个Agent请求全部外部/内部子请求。不会把128MB额度当实测内存，或将D1 await时长当CPU。提供窗口子请求总数、chat中的上游次数/SQL语句数，保留缺项。无高并发压测；浏览器按1worker串行执行。

模型费用按真实usage及[官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)估算，缺失usage的取消不按0；另只读比较授权前后账户余额，可能包含同期其他调用，不当项目独立账单。额外授权上限1元，未充值；Cloudflare始终Free，没有升级或新付费服务。

## 9. 真机验收入口和步骤（待负责人执行）

入口：https://campusos-preview.zhujunkui1.workers.dev/map 。请分别用Android Chrome和iPhone Safari，不要在聊天或仓库提交个人精确轨迹。

1. 首次打开应朝北/2D；搜索南苑7栋，循环2D→2.5D→3D→2D，拖图/缩放/旋转，观察模型对齐和发热。
2. 问AI“从南苑7栋去图书馆”，确认路线/端点可见、可清除、可再显示；点“开始导航”再退出，检查全部标记清理。
3. 问“从我现在的位置去图书馆”，分别允许/拒绝GPS。拒绝后输入起点；校园外或定位差时应提示并允许手动起点，不能假装成功。
4. 在校园室外核对定位精度、虚线接入实际道路、正常步行与隧道弱信号后的恢复。不要只用浏览器模拟坐标代替此项。
5. 上下拖动步行面板：最小档保留标题/X，只有X关闭，整条路线避让；检查内部滚动、AI抽屉、地图触控。
6. 中文输入法输入/确认候选、键盘弹出/收起；横竖屏及系统大字体，输入框/退出导航按钮仍可见。
7. 切后台/锁屏30秒再恢复；断网/弱网后重连，中止回复后不能突然执行旧地图动作。
8. 返回本任务只反馈设备/浏览器、步骤、是否通过和脱敏截图；真实GPS/位置轨迹无需交付。

## 10. 更新、回滚与正式上线前置

更新只用显式preview流程，检查当前数据库UUID/无正式路由→类型/Lint/单元→安全构建及实际bundle扫描→OpenNext deploy→HTTPS回归；保留版本ID。可用`wrangler rollback <已验证版本ID> --config wrangler.jsonc --env preview`回退应用，先确认该版本的路由/Secret/迁移兼容性。不要把应用回滚当D1回滚，不清空或重建数据库；本轮仅同义SQL括号修复，无需删除表恢复。

生产仍需另行批准：专用生产Worker/D1、迁移与备份恢复、gdufs.ccwu.cc绑定及DNS/HTTPS、相应Secret/模型刷新与预算、套餐或CPU解决方案。本轮preview轻量入口尚未应用到生产配置，不能直接认定生产已具备相同运行条件。

## 11. 最终结果

| 检查                   | 结果                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| TypeScript / Lint      | 通过，零警告                                                                                                              |
| 单元                   | 194项/25文件通过，含配置隔离、原处理函数转交、Schema元数据、回执SQL及等待策略                                             |
| 数据库                 | 本地34空表约束、两workerd回归通过并明确local-only；真实预览4迁移/34表/11触发器、FK与读写/隔离/过期/版本通过               |
| Chrome/Edge常规公网E2E | 最终各61通过/3跳过，9spec；每浏览器2worker，两个浏览器顺序执行；未调用付费模型                                            |
| 真实模型               | 23轮最终归档：19完成、2预期NOT_FOUND、2取消缺usage；51已知上游请求/70055 Token，0纠正；5项Skill均实际被模型调用           |
| Worker更新恢复         | 实际707b→3545版本更新后，原测试Cookie的对话/路线恢复通过，0模型调用                                                       |
| HTTPS与定位            | Chrome手机视口受控公开坐标授权/拒绝/导航/取消通过；不是实机GPS                                                            |
| 公开资产及三模式       | Chrome/Edge各4项通过；请求主机仅当前workers.dev、OSM版本一致、无高德下载；地图/字体/GLB均有ETag，条件请求304，GLB哈希一致 |
| 安全                   | 已知实际Key/签名/OAuth及服务端/客户端产物无明文命中；其他3 Worker修改时间/其他2 D1总大小保持，当前预览无自定义域名        |
| 依赖                   | 生产audit0；全依赖仍5high开发链告警，未全通过                                                                             |

3项跳过为2个需显式开启的原生外框测试及1个桌面不适用手机AI用例，不记作通过。常规初轮两浏览器各60通过/1失败/3跳过，失败为3D懒加载真正发出GLB请求前就取消，模型正常保留idle；增加真实请求屏障后保留原全部状态断言，专项与完整整套已重跑通过，没有修改模型外观或加载逻辑。

私密文件/调试/SQL维护路径7项实际HTTPS请求全部404，无已知秘密值；公开29个文本构建资产无私有会话SQL命中。本机预览Secret备份、测试Cookie和余额基线均确认Git忽略，不进入public或提交。静态缓存只适用于当前构建时公共页面；未来加入服务端个人内容须重新审核缓存边界。

### 实际最终性能

| 口径                             | 样本 |    P50 |    P95 |
| -------------------------------- | ---: | -----: | -----: |
| 浏览器响应头                     |   21 |  555ms |  732ms |
| 用户可见首字（含工具与地图回执） |   19 | 4776ms | 5467ms |
| 用户请求完成                     |   21 | 5149ms | 5953ms |
| 模型上游单请求                   |   51 |  816ms | 1190ms |
| 地图动作→成功回执                |   15 | 1793ms | 1851ms |
| chat内D1 await总时长             |   21 | 1227ms | 1508ms |
| 最终窗口页面CPU                  |  459 |    2ms |   11ms |
| 最终窗口chat CPU                 |   24 |   25ms |  170ms |

最终Tail窗口542调用、0次exceededCpu，chat最大173ms。初包窗口31调用/2次exceededCpu、页面P50/P9549/501ms、chat69/364ms。窗口样本/冷暖条件不同，表格是实际观测，不是控制变量并发基准或承载保证；最终chat仍高于Free10ms，**免费计划长期稳定性没有通过验收**。本轮未再扩大架构或升级付费套餐；可选下一步是专项压缩路由计算/流处理CPU，或由负责人另批Paid并再测。

纯同步Skill计时出现0ms，因为[Workers计时器仅IO后推进](https://developers.cloudflare.com/workers/runtime-apis/performance/)，不能解释成零CPU；plan_route执行墙钟P50/P95132/149ms也不是纯CPU。采用平台Tail/GraphQL作CPU依据；GraphQL的CPU字段为微秒，与Tail毫秒区分。完整内存和单次全部子请求仍未可靠测量。

公网串行三模式采样：地图ready1422–2024ms；2.5D切换936–951ms，3D659–676ms；前台rAF间隔P954.3–8.2ms。首个2D只是当前默认状态检查，不是模式切换。客户端高刷视口结果不是呈现FPS、手机硬件或云端渲染表现。

最近成功的GraphQL窗口记录见`cloud-analytics.json`（明确时间戳）：本预览143请求/202子请求/0错误；账户D1读24423行/写1477行，低于免费每日额度。后续扩大分析查询触发GraphQL自身5分钟预算限流，保留`final-usage.json`，**不把该错误称为应用429或D1额度耗尽**。没有扩大分析权限、套餐或执行高并发耗尽测试；后续补充快照以文件实际状态为准。

已知23轮矩阵模型费约CNY0.04224–0.08448；包含诊断、调试重跑和取消的账户余额变化为**0.11元**（快照见`model-budget.json`），在授权1元内，非项目独立账单。未充值，Cloudflare没有套餐/新增服务费。公开试用期间的持续模型预算仍须负责人确定；原调用额度没有放宽。

### 结论和剩余项

- **资源与功能：通过。** 实际HTTPS、真实模型→Skill→地图链路、D1隔离/恢复已完成，可供负责人低频实机验收。
- **完整S2-E：尚未全部通过。** Free CPU稳定容量、真实手机、跨地域及完整内存/子请求归因仍缺证据；开发链漏洞和24h模型能力刷新运维未关闭。
- 真实手机还需检查校园Wi-Fi/移动网络能否直达workers.dev，桌面成功不能替代手机网络可达性。详情回答偶尔带living/source_mapped等内部枚举词，已保留实际截图，后续需做中文措辞收敛；未将该截图描述为全部文案已打磨完成。
- **生产：不具备完整放行条件。** 配置/资源/正式域名/迁移/预算都需另批，并先解决CPU与实机门槛。DNS读取API403未重新读取当前记录，未扩大权限；配置与资源API确认预览无自定义域名，本轮没有DNS/正式域名变更操作。
- **S3：可做官方资料整理和独立设计；建议资源方案与S2发布门槛确定后再扩展公网AI/RAG/雷达。** 本轮没有实施这些模块或建筑批量。

截图：[桌面真实详情](verification/s2-e/live/msedge-desktop-verified-details.png)、[手机真实路线](verification/s2-e/live/msedge-mobile-B-route.png)、[更新后恢复](verification/s2-e/screenshots/msedge-mobile-after-worker-update.png)、[手机步行面板](verification/s2-e/screenshots/msedge-mobile-library-route-expanded.png)。均为真实浏览器PNG，不是生成图。完整索引及复验环境变量见`verification/s2-e/README.md`。
