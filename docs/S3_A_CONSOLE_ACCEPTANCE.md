# S3-A CampusOS Console 验收

日期：2026-10-17。代码基线：`b71e29e`。范围仅为精简运营后台、来源登记与内容治理基础；不启动采集、RAG、校园雷达或建筑建模。

**当前结论：已按负责人最终选择启用独立HTTPS管理员密钥，真实Cloudflare登录、候选读取、刷新恢复、退出及旧Cookie拒绝通过。入口：https://campusos-preview.zhujunkui1.workers.dev/admin 。不使用Cloudflare Access；公开运营数据的写入正例在隔离本地夹具验证，公网未填假文章或自动核验来源。详情见第9节。**

## 1. 实际状态与范围

后台入口 `/admin`，同一 Next.js/OpenNext/Worker、同一既有 D1，复用全局设计 Token、Base UI 对话框及既有固定校园地点 ID。学生导航没有新增入口；地图、Agent、步行算法、OSM 与南苑7栋模型不变。

| 页面 | 本轮实现 |
| --- | --- |
| 总览 | 候选、已核验、启用、待审核、真实失败任务和索引失效待处理数 |
| 信息源 | 搜索/分页/类型和核验筛选、详情/编辑/证据/原始出处、核验、启用/暂停、归档 |
| 采集任务 | 真实队列/状态/错误码/发现/正文/重复数；仅允许取消排队任务；采集开始/重试明确未启用 |
| 内容审核 | 人工登记真实原文和正文、结构化候选字段、批准/退回/拒绝、发布/撤回 |
| 内容记录 | 版本快照、查看历史、恢复为新草稿；无正文时真实空状态 |
| 审计日志 | 数据库原子记录操作者、动作、对象、版本、审核说明和时间；分页查看 |

不存在 S3-0 成果文件或实现，故没有假称继承 S3-0 Schema。以实际 `knowledge_sources`/`knowledge_documents`/`ingestion_jobs` 为基础扩展，设计差异另记 D-041。学生自有账号仍属后续阶段，不能用原游客 Cookie 作为管理员身份。

## 2. 管理员认证与公网门禁

管理员标识仅配置在服务端，客户端默认值和本文不公开实际邮箱。最终选用admin_key模式：首次登录必须持有独立384bit随机密钥，仅HTTPS且请求站点与CONSOLE_ORIGIN精确匹配；配置只允许一个首批管理员，邮箱作为操作者标签，不冒充邮箱所有权验证。未登录管理API返回401；配置缺失仍503并关闭，不返回任何业务数据。

实现三种互斥、明确配置的路径：

- 公网 `access`：验证 Cloudflare Access RS256 JWT 的签名、指定团队 issuer、应用 audience、有效期、签发时间、app 类型、subject、邮箱白名单；不信任普通邮箱/角色请求头。JWKS 仅缓存公开验证键，不缓存私人数据。
- `local_key`：仅 `APP_ENV=local` 且回环地址接受独立随机开发密钥；在 workers.dev 不能使用这一模式。密钥仅在忽略目录，以密码框 POST 换取会话，不存 localStorage、URL 或客户端 Bundle。
- 公网 `admin_key`（最终使用）：服务端校验密钥，D1会话绑定当前密钥指纹与唯一配置身份；不能复用开发密钥/开发会话，轮换密钥立即使旧Cookie失效。管理员Cookie的CSRF/权限/额度与事务时会话复验同样执行，不依赖Access。

三种模式都使用与游客独立的 `campusos_console` HttpOnly/SameSite=Strict Cookie（HTTPS 带 Secure）、1小时 D1 会话、每次实时验证管理员状态；修改还需同源检查与独立 CSRF MAC。CSRF 值不含可还原 Cookie 的签名负载。登录每 IP 5次/分钟，管理请求每管理员120次/分钟，受 D1 约束；登录清理到期会话/撤销票据及旧限流桶。数据库命令还校验会话存活，阻止鉴权后撤销时的迟到写入。

角色为 admin/operator/reviewer：读公开运营数据、编辑、审核、发布/撤销管理员权限分开；审核员不能启用来源或发布。仅管理 Console 管辖的公开知识来源/正文/任务；没有查询学生对话、GPS、课表、成绩或账号表的后台接口。

**认证决策记录：**初次检查Access激活页需要条款与超额自动扣卡授权，曾关闭公网后台等待选择。负责人随后明确选用独立管理员密钥、不使用Access，已实施并实测；本次没有开通Access或操作其扣费授权，不推测负责人在其他页面自行完成的账户状态。

API：`/api/console-auth`；`/api/admin/{overview,sources,content,jobs,audit,admins}` 及固定子动作。参数由严格 Zod Schema 验证、请求体上限256KiB；不存在通用 SQL、任意连接器代码、测试种子或调试管理 API。所有响应 `no-store`，错误采用受控中文，不泄露 SQL/凭据/内部路径。安全退出撤销 D1 会话；Access 路径还撤销该 JWT 的 Console 票据并跳转 Access logout。管理员可通过经过鉴权的 `admins/:id/revoke` 撤销其他管理员及其会话；恢复权限仅由可信运维配置，不允许游客自助提升。

## 3. 数据模型、原子性和发布失效

`0006_console_registry.sql` 是已审计的增量迁移，不包含 DROP、业务记录 DELETE 或表重建。由35个业务表扩展至45个，另有SQLite内部自增表不计业务表。

新增管理员/会话/撤销/限流、命令幂等、内容版本/审核、导入批次、审计及失效 outbox。既有来源增加10类载体、别名、机构、官方/核验/许可状态、范围、微信号、网址、证据、原始文件/表/行、目录声明、连接器安全配置、抓取策略、运行状态、优先级及版本等。旧粗粒度 source_type 不代表官方身份；公开运营范围由 console_managed 和数据域共同限定。

写入使用参数化 SQL 和 D1 `batch`：命令触发器检查实时角色、会话、目标范围与乐观版本，业务变更/审核记录/快照/审计在同一批次提交，失败全部回滚。UUID 只是幂等编号，还须匹配真实管理员、动作、对象与内容指纹，不能跨身份复用。每条记录版本上限1000。参考 [D1 batch 原子性](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。

来源编辑自动暂停并退回待核验；启用须核验完成且许可批准或仅入口。非官方不会因导入优先级或年份自动变官方，确认官方主体需要显式证据和人工确认。内容编辑和版本恢复均回到未发布待审核状态。发布须已批准、来源启用/核验/许可通过、未过期；官方政策域还要求已核实官方来源。

活动候选的时间、截止日期、校区地点未人工核验不能发布；大学城地点还需匹配既有真实 placeId。日期使用显式时区、统一 UTC 保存。没有调用 AI 自动提取或索引的假状态。

撤回/拒绝/过期/来源暂停或归档在统一 `console_public_documents` 新鲜视图中失效；`filterPublicContent` 对未来检索候选 ID+版本重新验证，不能信任旧向量命中。变更同时写失效 outbox。**本轮没有实际向量/FTS索引**，因此不声称已运行向量删除；后续索引必须消费 outbox 并执行新鲜过滤。源归档保留出处和审计，不误删其他来源。

HTML/Markdown 正文以 React 纯文本预览，脚本、图片事件、内联 HTML 不解释执行；外链只允许 http(s)，拒绝用户密码、敏感凭据查询参数和主动内容 URL，不执行外部抓取。

## 4. 真实信息源导入

输入为负责人提供的同名2026-10-17 XLSX与Markdown，原始文件未修改。未执行三个第三方采集项目，也未复制到 public。

| 指标 | 实际结果 |
| --- | ---: |
| 主表原始行数 / 规范化候选 | 220 / 220 |
| dry-run 错误 | 0 |
| 待核警告 | 113 |
| 同名但可能不同载体的分组 | 5 |
| 冲突与待核事项原表行数 | 29 |
| 预览首次插入 | 220 |
| 重复导入新增 | 0 |
| 已启用 / 已核验 | 0 / 0 |
| 待核候选 / 失败 | 220 / 0 |
| 采集文章 | 0 |

109官网、89公众号、3服务号、16小程序、1企业微信、2内嵌应用。详细字段映射、缺微信号、同名分组、冲突原文和证据见 [dry-run](verification/s3-a/import/dry-run.json)。113警告没有被当作认证事实或隐藏掉；不代表113条导入失败。目录“2026活跃”、优先级和“官方”声明仅作为原始线索。

公众号证明文章/所属机构官网放 evidence_urls，不能冒充公众号主页；没有可核验主页则 website_url 为 NULL。去重键为载体+规范化网站/微信号，稳定 source_id 保留；无唯一入口时不凭同名强行合并。保存原文件 SHA256、工作表/行号、Markdown行号及原目录引用。已人工修改的记录不因重复导入被覆盖；目录内容改变或稳定ID冲突须重新审计。

复现：

```powershell
node scripts/import-source-catalog.mjs
node scripts/apply-console-catalog.mjs --local
# 只有 dry-run、原文件哈希和目标核对通过才允许执行：
$env:CLOUDFLARE_ACCOUNT_ID='<已确认预览账户>'
node scripts/console-preview.mjs
node scripts/apply-console-catalog.mjs --remote-preview
```

规范化清单 `data/console/source-catalog-2026-10-17.json`；导入工具是可信运维离线入口，没有在浏览器或 Agent 暴露 SQL 功能。在线导入使用绑定参数，不执行表格公式。报告：[本地](verification/s3-a/import/local-import.json)、[真实预览](verification/s3-a/import/preview-import.json)。

## 5. 迁移与云端隔离证据

仅既有 `campusos-preview` D1，UUID `18299abc-b38b-4494-8d12-8ab4d482c304`。执行前核对账户、名称、UUID和待迁移0006；本地空库、有既有账号/对话/公开与私有正文的升级夹具均通过后执行。

实际预览迁移前后：74段对话、328条消息、191个Agent Run、来源0、正文0均保持一致；迁移后真实导入220候选，正文仍0。外键检查0错误。没有清空/重建数据库、复制学生数据、操作其他项目或正式DNS。

证据：[本地迁移](verification/s3-a/database-tests.json)、[预览迁移](verification/s3-a/preview-migration.json)、[预览导入](verification/s3-a/import/preview-import.json)、[发布核验](verification/s3-a/preview-after.json)。

## 6. 测试、截图和运行边界

最终自动化结果和实际版本见 [执行摘要](verification/s3-a/acceptance-results.json)。单元测试包括真实 RSA JWT 正反例、伪造角色/游客身份、跨管理员票据、撤销后迟到写入、来源审批/幂等/版本冲突、非官方升格拒绝、活动字段门禁、内容撤回失效、其他来源保留、220条真实清单重复导入、原始出处和私有数据隔离。

本地浏览器后台验收使用真实 workerd/D1和独立开发密钥，不 Mock 管理 API。只有隔离测试库包含明确标注的测试来源和正文；公网库不填假文章。Chrome/Edge各覆盖桌面1440×900、手机视口390×844。截图按 `verification/s3-a/{chrome,msedge}-{desktop,mobile}-*.png` 保存，全部来自实际浏览器，不是生成图。

原地图/Agent回归的 Mock SSE 与真实确定性五Skill分开记录。发布前发现24小时模型能力凭据过期，先核对原1元预算，再真实完成3次最多256输出Token的诊断验证并只更新预览MODEL_CAPABILITIES_JSON；另有1次真实HTTPS Agent烟测，不能把它们计作后台登录成功。最终密钥鉴权的真实云端测试另列第9节。本地/桌面手机视口不等于 Android/iPhone真机，也没有声称Cloudflare Access登录完成。

本地复现：

```powershell
node scripts/console-local.mjs --prepare
node node_modules/wrangler/bin/wrangler.js d1 migrations apply campusos-console-local --local --config .map-tools/s3-a/wrangler.local.json --persist-to .map-tools/s3-a/worker-state
node node_modules/wrangler/bin/wrangler.js d1 execute campusos-console-local --local --config .map-tools/s3-a/wrangler.local.json --persist-to .map-tools/s3-a/worker-state --file test-results/console-local-catalog.sql
node scripts/console-local.mjs
# 第二个终端，Chrome与Edge依次测试；遵守真实登录/请求限流，不重置额度。
$env:E2E_BASE_URL='http://127.0.0.1:8787'
$env:CONSOLE_LOCAL_E2E='1'
$env:PLAYWRIGHT_CHANNEL='chrome' # 或 msedge
npx playwright test tests/e2e/console.spec.ts --workers=1
```

重复给已含目录的本地库执行 seed SQL 会产生约束错误；已有本地库只启动 Worker，重复导入用幂等工具验证，不重新 seed。

## 7. 安全构建、更新和未验收项

所有预览发布沿用净化构建脚本，扩展扫描独立 Console 私密文件。模型/高德/签名/Console密钥只从运行时读取，不编译默认值。没有新付费资源、Access激活、套餐升级、生产Worker/D1、生产域名或DNS变更。

Cloudflare Free CPU稳定性仍为既有未通过门槛（S2-E最终Agent P50/P95 48/116ms）；本轮不冒充已解决。模型能力凭据24小时有效期与真实手机、多地域、既有开发依赖告警继续列阻塞。尚无抓取正文、自动AI字段提取、定时采集、向量索引和雷达发布消费端，均属后续范围。

回滚仅应用版本可用 Wrangler版本回滚；0006为兼容新增结构，可保留，不删库/回退表来掩盖问题。来源可以暂停/归档、正文可以撤回，审计保留。最终密钥认证已配置；回滚到不支持admin_key的旧版将安全关闭后台，不能误认为可以保留旧版登录。配置缺失时持续拒绝管理请求。

完成S3-A后停止，不自动启动S3-B。

## 8. 最终执行结果与性能修复

| 检查 | 结果 |
| --- | --- |
| TypeScript / Lint | 通过 |
| 单元 | 最初252通过；密钥模式增加4项后256通过，35文件 |
| 空库 / 有历史升级 / 约束 | 45业务表；原私人数据保留；外键0错误 |
| Chrome本地回归 | 66通过/2跳过，含4项Console；最终后台外壳修改后再跑4项通过 |
| Edge本地回归 | 原地图/Agent62通过/2跳过；Console另4项；最终后台重跑见执行摘要 |
| 公网Chrome/Edge | 各4项：门禁、公共地图与五项真实Skills；最终静态外壳复测独立记录 |
| 真实DeepSeek | 3次诊断验证 + 1个云端Agent任务/4次上游；无纠正重试 |
| 生产与Worker构建 | 净化构建、显式preview发布成功；源码/产物实际凭据0命中 |

跳过2项均为需要显式原生窗口调整环境的既有用例，响应式视口与模型拖动/缩放已有独立通过，不据此假称原生外框/手机实机通过。测试过程中修复了退出后登录入口状态、版本查看不应触发保存，以及回归Mock恢复误删其自身fixture的问题；没有放宽业务断言。并行测试输出目录冲突使用独立忽略目录解决，历史S1截图先归档本轮新证据，再恢复原文件，未覆盖旧里程碑记录。

第一版S3-A部署 `108eaf1b-b04e-4e04-94b9-197609c293c6`，Deployment `bf3f39f9-d3ca-4c8e-8ae5-22c2d98600d8`。安全构建压缩2486.02KiB、平台启动校验100ms（非用户请求延迟）。真实Tail发现 `/admin` 动态SSR四次CPU P50/P95=348/374ms，均超10ms；未出现exceededCpu不能视为合格。原始脱敏证据保留 `cloud-invocations-before-static.json`。

据此将仅含界面的六个后台页面预渲染，详情以 `?record=<id>` 选择并通过鉴权API加载。Suspense只缓存不含身份或内容的外壳，所有管理数据继续no-store、每次鉴权、D1限流/CSRF/事务检查。未知页面不按动态详情生成，不做私人SSR/会话缓存。未重构地图或Agent。依据：[Next generateStaticParams](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)、[useSearchParams/Suspense](https://nextjs.org/docs/app/api-reference/functions/use-search-params)。最终实际版本和前后CPU见执行摘要，不能据低频页面样本解除Agent Free容量门槛。

最终版本 `ace425b6-912a-448d-82dc-5fb52e48f678`，Deployment `9ce67e07-2df7-4099-82d5-d0b2d11ff08d`；压缩2486.57KiB、平台启动校验101ms。最终Chrome/Edge后台各4项通过，公网各4项（六个后台页面刷新门禁、地图三模式、五Skill）通过。四次/admin CPU P50/P95=8/14ms，1次仍超10ms；sources四次2/7ms、jobs三次1/3ms。两窗口均0个exceededResources，仅代表有限样本；Tail未捕获每个页面请求的CPU，不推测原因。没有真实已认证管理员CPU、完整内存或长期容量结论。Agent初版S3-A单样本54ms也超过10ms，未解除既有容量阻塞。

本地静态化首测发现直接wrangler dev未填充OpenNext静态缓存而产生NoFallbackError，已将专用本地启动工具改为官方OpenNext preview填充缓存后再运行，Chrome/Edge完整业务重跑通过。没有改回昂贵动态SSR来掩盖兼容问题。

真实模型烟测在第一版S3-A版本完成：`search_places`→`get_place_details`→`control_map`，FOCUS_PLACE和SHOW_PLACE_DETAILS均收到实际执行回执，回答7层/约21米并保留估算属性。4次上游、7877Token、首字6295ms/服务端终态6909ms；诊断验证3次不记录usage，不能把7877作为全部7次请求Token。成本沿用服务端标有2026-10-15日期的估算快照，不冒充最新账单。前后余额显示的原1元授权累计下降均0.74元，本轮变化未达到余额显示精度，不能解释为免费；未充值/提额，余额可能含同期其他使用。后台开发/权限/导入测试不消耗模型。

预览在模型烟测后75段对话、330消息、192Run（新增1段测试对话/2消息/1Run），来源仍220、正文0；没有通过清空或删除掩盖数据。该阶段公网管理员/会话/命令/公开内容计数均0；后续密钥方案已完成，结果如下。

## 9. 负责人选择独立密钥后的最终公网验收

- 当前版本 `f602fa2a-265b-479c-ad73-743c9222f198`，Deployment `f3b9fece-38ee-4af0-851b-a6622881058d`；压缩2487.00KiB，平台启动校验115ms。仍仅既有campusos-preview Worker/D1，不开通Access，不修改正式DNS/其他项目或付费套餐。
- 配置并实际验证5项运行时Secret：CONSOLE_AUTH_MODE、CONSOLE_ADMIN_EMAILS、CONSOLE_ORIGIN、CONSOLE_ADMIN_ACCESS_KEY、CONSOLE_SESSION_SECRET。独立于本地和Agent签名/模型凭据；配置脚本默认只准备，--apply才上传到精确预览目标；重复运行保留原密钥。只有受信任运维可以轮换Cloudflare中的管理员密钥；服务端每次比对密钥指纹，旧会话立即失效。管理员撤销接口与D1状态检查保留。
- Chrome与Edge桌面/手机视口各6项通过：真实密钥登录、220候选/原始出处读取、刷新保持登录、真实空内容/任务、审计登录记录、安全退出、旧Cookie重放401；另含未登录/伪造角色401、缺CSRF/跨域写入403、公开地图与五项真实Skills。没有在公网写入测试来源或文章，也未把任何候选自动核验/启用；正向编辑/审核/发布/撤回仍在隔离本地D1完整验证。
- D1最后核对管理员1、会话4、活跃会话0，4次登录/4次退出有真实审计，业务命令0、公开正文0；220来源、启用0、核验0和75/330/192原会话数字不变。真实截图文件admin-preview-{chrome,msedge}-{desktop,mobile}-source.png，管理员邮箱仅显示遮蔽标签；不提交Cookie/CSRF/密钥。
- 新增4项密钥单元测试：正确配置/CSRF，HTTP和伪造转发协议/错误站点/不完整配置拒绝，轮换/退出/撤销后拒绝，开发会话不能跨至公网。合计256单元通过；两浏览器本地后台各4项重跑通过，安全生产构建与实际密钥扫描通过。
- key-mode-invocations.json受控窗口164条脱敏记录、0资源超限错误。认证API混合方法21样本CPU P50/P95=3/9ms；overview混合200/401共7样本2/4ms；已鉴权来源详情仅捕获1样本3ms。Tail非全部请求/函数/方法归因，没有公网正向内容写入的CPU或长期容量结论；不能解除原Agent Free风险。

负责人取用密钥：本机忽略文件 `.map-tools/s3-a/admin-access-key.txt`（仅密钥）或preview-secrets.json；不在本报告/回复明文展示。打开HTTPS/admin，粘贴密钥登录即可；不要放在URL。该模式证明持有管理员密钥，不代表验证QQ邮箱所有权。正式生产部署、真实手机、来源许可与采集核验、原Free CPU容量门槛仍需后续完成；本轮停在S3-A。
