# S3-A CampusOS Console 验收

日期：2026-10-17。代码基线：`b71e29e`。范围仅为精简运营后台、来源登记与内容治理基础；不启动采集、RAG、校园雷达或建筑建模。

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

已收到负责人提供的首批管理员邮箱，正式名单将只在服务端配置，不放客户端默认值或本文公开；当前公网尚未配置该认证。公网管理读写 API 在可信认证配置完整前返回 `SERVICE_UNAVAILABLE`，不返回来源、内容或学生信息。

实现两种明确分离的路径：

- 公网 `access`：验证 Cloudflare Access RS256 JWT 的签名、指定团队 issuer、应用 audience、有效期、签发时间、app 类型、subject、邮箱白名单；不信任普通邮箱/角色请求头。JWKS 仅缓存公开验证键，不缓存私人数据。
- `local_key`：仅 `APP_ENV=local` 且回环地址接受独立随机开发密钥；在 workers.dev 不能使用这一模式。密钥仅在忽略目录，以密码框 POST 换取会话，不存 localStorage、URL 或客户端 Bundle。

两者都使用与游客独立的 `campusos_console` HttpOnly/SameSite=Strict Cookie（HTTPS 带 Secure）、1小时 D1 会话、每次实时验证管理员状态；修改还需同源检查与独立 CSRF MAC。CSRF 值不含可还原 Cookie 的签名负载。登录每 IP 5次/分钟，管理请求每管理员120次/分钟，受 D1 约束；登录清理到期会话/撤销票据及旧限流桶。数据库命令还校验会话存活，阻止鉴权后撤销时的迟到写入。

角色为 admin/operator/reviewer：读公开运营数据、编辑、审核、发布/撤销管理员权限分开；审核员不能启用来源或发布。仅管理 Console 管辖的公开知识来源/正文/任务；没有查询学生对话、GPS、课表、成绩或账号表的后台接口。

**实际 Cloudflare 阻塞：**账户尚未激活 Zero Trust。Free 页面虽标价0元，但激活页要求同意服务条款及超额自动扣卡授权。本轮没有勾选、激活或授权扣费。已向负责人提出独立管理员密钥或由负责人处理 Access 开通的选择；在答复和可信配置落地前，不开放公网后台操作，也不假称邮箱登录已完成。

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

原地图/Agent回归的 Mock SSE 与真实确定性五Skill分开记录。发布前发现24小时模型能力凭据过期，先核对原1元预算，再真实完成3次最多256输出Token的诊断验证并只更新预览MODEL_CAPABILITIES_JSON；另有1次真实HTTPS Agent烟测，不能把它们计作后台登录成功。本地手机视口不等于 Android/iPhone真机。公网缺少可信管理员认证时只验收关闭门禁和公共地图，不能将本地登录当成云端 Access 成功。

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

回滚仅应用版本可用 Wrangler版本回滚；0006为兼容新增结构，可保留，不删库/回退表来掩盖问题。来源可以暂停/归档、正文可以撤回，审计保留。Access启用和管理员运行时配置须在负责人确认具体认证路径后完成，配置缺失时持续拒绝管理请求。

完成S3-A后停止，不自动启动S3-B。

## 8. 最终执行结果与性能修复

| 检查 | 结果 |
| --- | --- |
| TypeScript / Lint | 通过 |
| 单元 | 252通过，34文件 |
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

预览在烟测后75段对话、330消息、192Run（新增1段测试对话/2消息/1Run），来源仍220、正文0；没有通过清空或删除掩盖数据。公网管理员/会话/命令/公开内容计数均0，真实导入审计与候选保留。Console公网身份与已认证管理操作仍未验收，须先完成负责人登录方案选择。
