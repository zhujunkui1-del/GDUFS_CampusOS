# WeRSS 与 thu-push 辅助订阅链静态审计

核查日期：2026-10-17。CampusOS 基线：`206e01d`。本轮只读公开 GitHub 和负责人原包，执行隔离合成测试；**未启动 WeRSS/浏览器调试/SMTP，未读取账号或 Cookie，未请求微信文章，未调用模型、修改 D1 或部署。** Dify 已按 D-045 废弃，不属于研究依赖。

## 1. 版本、时间与尚未合并的修复

| 仓库                | 默认分支与本轮固定 SHA                            | 最后提交（UTC）                                                  | `pushed_at` / `updated_at`（UTC）         |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| rachelos/we-mp-rss  | main / `9b40351fd1913e7f74cf88f65740cd67a28baf81` | 2026-10-10 01:45:30，合并 #475；author/committer 时间相同        | 2026-10-10 01:45:31 / 2026-10-17 08:54:01 |
| thu-lawyer/thu-push | main / `19abc55134cf5691e575fbcc74cb88d3801c2b28` | 2026-10-11 16:54:42，凭据扫描误报修正；author/committer 时间相同 | 2026-10-11 16:54:45 / 2026-10-11 16:54:49 |

以上由公开 Git refs 与官方 GitHub 连接器只读 repository/branch/commit 元数据交叉核对；`updated_at` 是仓库元数据变化，不能解释为正文采集修复已提交。先前本地匿名 REST 请求限流后未重试该入口；官方连接器读取成功，没有提取凭据。23 个受检源码/README/LICENSE 与提供的只读原包 SHA 一致。[当前上游证据](../../verification/s3-wechat-resumed/werss-helper-upstream.json)、[代码与原包比对](../../verification/s3-wechat-resumed/werss-helper-code.json)；保留前轮[静态证据](werss-helper-evidence.json)，不覆盖其历史时间。

| 对象                                                           | 当前官方元数据                                                                                                  | 证据边界                                                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Issue #463](https://github.com/rachelos/we-mp-rss/issues/463) | open，2026-09-07 创建、10-09 更新，closed_at=NULL                                                               | 用户报告授权后仍不能同步，未见官方已关闭结论                                                                                                                        |
| [Issue #476](https://github.com/rachelos/we-mp-rss/issues/476) | open，2026-10-05 创建、10-14 更新，closed_at=NULL                                                               | 用户报告授权公众号/微信读书后无内容；评论称“接口停了”不是微信官方公告，不能推断所有模式永久失效                                                                     |
| [PR #478](https://github.com/rachelos/we-mp-rss/pull/478)      | open、merged=false、merged_at=NULL；base=`9b40351`，head=`a76517ba5682a83c184916037daa6116ac15bf98`；10-14 更新 | 报告二维码和新版正文提取修复；作者测试不计 CampusOS 实测。默认源码仍走旧二维码解析，`extract_mp_content` 没有 `content_noencode` 分支，未发现相应修复已进入默认实现 |

对照代码：[二维码流程](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/driver/wx_api.py#L73)、[正文提取器](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/wx/model/weread_mp.py#L109)。未套用 PR，也没有为验证它运行登录或文章请求。

## 2. 七层验证结论：不能用启动代替可持续采集

| 层次            | 文档/代码证据                                                  | 本轮离线证据                                           | 当前实时结论                                                    |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| 1 启动          | README 提供 Python/FastAPI、Docker；声明 Python≥3.13.1         | 只读取源码，未安装依赖或 import 应用                   | **未启动、未验证**                                              |
| 2 登录/授权     | 有公众号扫码、微信读书登录态、凭据失效处理                     | 只能证明相关分支存在；#478 尚未合并                    | **未授权、未验证**；不读取负责人现有会话                        |
| 3 添加订阅      | POST mps 按 faker_id 查重，写 feeds；新号立即启动抓取任务      | 合成标识可展示字段映射，不能证明账号真实主体           | **未添加**；成功登记不等于可发现文章                            |
| 4 发现真实文章  | weread_mp 列表路径、已存文章检查、cover 降级                   | 平台错误可以产生明确异常；未访问外站                   | **0 条实际样本，未验证**；降级仅最新一篇不等于完整历史          |
| 5 获取真实正文  | 支持旧 js_content/rich_media_content、web/api 模式与可用性检查 | 旧壳移除 script 成功；JS-only 新壳复现 invalid_content | **0 篇真实正文，完整率0/0未测**；非空或 has_content=1不证明完整 |
| 6 下一轮新增    | 有按已存 ID 停止翻页、跨次补抓与定时任务                       | 交换格式草案的重复/变更探针通过，未跑引擎数据库        | **未运行第二轮，不宣称持续增量成功**                            |
| 7 稳定 API 数据 | REST 列表/详情、RSS、任务、Webhook，进程内任务状态             | 仅合成响应格式、限制和拒绝测试通过                     | **未启动 API，未证明长时间稳定**；无真实吞吐/错误率/延迟        |

源码入口：[README](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/README.zh-CN.md)、[mps](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/apis/mps.py)、[文章列表](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/apis/article.py#L411)、[采集主流程](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/wx/model/weread_mp.py#L420)。历史 S3-B 的 robots 阻塞记录继续有效；本轮没有重新探测微信、搜狗或更换路径规避它。

## 3. WeRSS 真实数据与执行语义

### 3.1 数据库、元数据、正文

[Article 模型](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/models/article.py)有文章 ID、mp_id、URL、标题、publish_time（整数秒）、created_at（数据库记录时间）、updated_at_millis、正文和 has_content；[Feed 模型](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/models/feed.py)另存 faker_id。CampusOS 不照搬其 SQLite Schema：外部 publish_time 必须确认含义和时区；0/未知转为 unknown，created_at 不补成原发布时间，源观察/获取时间与 CampusOS updated_at 分开。

[Db.add_article](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/db.py)会按 URL 或归一化文章 ID 查已有记录。这属于引擎去重，不代替 CampusOS 来源/规范 URL/input_hash/content_revision/审批/outbox。API has_content 只表示引擎记录，不是版权或完整性证明；照片、表格、附件及新版正文是否缺失，仍需合法原文对照。

### 3.2 增量、回退与失败

`get_Articles`要求有效微信读书凭据，尝试 `ensure_mp_on_shelf`，该操作可能更改书架关注状态。列表不可用时可能继续请求 cover，仅取最新一篇；已经有有效列表后正文失败则继续上抛。这些上游容错路径不符合“遭身份/风控限制即停”的 CampusOS 接入条件，不能原样自动运行。旧列表停在首个已见文章，也不证明文章修改、置顶、时间相同或顺序变化时完整发现。

[正文执行器](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/article_content.py#L103)有进程超时、web/api 两模式回退及失败计数，默认最多3次后改变失败状态；但它可吞掉某模式异常再尝试另一模式。未来网关需单独把401/403/429、验证码、身份失效和许可拒绝映射为暂停，不能当无新文章、不能换账号/路径继续。错误信息也须脱敏后才入 Console。

[jobs/mps.py](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/jobs/mps.py)会运行采集并可能执行 Webhook。追踪器的成功判断还结合 count>0；因此“0新增”不是可靠的错误/健康判据。上游队列去重不能作为 CampusOS 的租约/fence、原子提交、来源预算或重复通知安全证明。

### 3.3 REST/RSS 的只读边界

只允许经过验证、部署内网隔离的精确路由，不能把“GET请求”整体列为只读：

| 路径/操作                          | 实际语义                                                       | CampusOS 建议                                                         |
| ---------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET mps / articles / articles/{id} | 列表/详情读取；列表最多100、offset分页，业务状态在响应体code中 | 条件性的元数据读取候选；检查当前来源映射、字段、大小、权限、时间/版本 |
| POST mps                           | 写入/更新订阅；新订阅立刻入队采集，可能下载头像                | 不是只登记；不得由发现器直接调用                                      |
| GET mps/update/{id}                | 同步获取文章，有频率和授权错误                                 | 写/抓取控制域，不能进只读网关                                         |
| GET message_tasks/{id}/run         | 启动队列，最多等待约60秒汇总，后续任务可能仍运行               | 不是查询；不得由 Worker 请求触发批量执行                              |
| PUT message_tasks/{id} / job/fresh | 改任务、重载调度                                               | 不给 CampusOS 公开 API 或 Agent 使用                                  |
| POST articles/{id}/refresh         | 启动正文刷新，状态存进程内字典                                 | 不是读取；重启恢复没有等同 D1 的一致性保证                            |
| RSS / feed                         | 有不要求身份依赖的路由，部分支持刷新/缓存写入，可能含全文      | 不直接暴露为 CampusOS 公共来源；先看字段许可和副作用                  |

证据：[任务 API](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/apis/message_task.py#L168)、[新增订阅](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/apis/mps.py#L464)、[RSS 路由](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/apis/rss.py)、[Web 装配](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/web.py#L40)。当前详情函数没有身份 Depends，Web 的 AK 中间件只保存头，并未为所有路径统一鉴权；不能按管理员列表 API 有鉴权推断全部服务私密。该结论来自代码，不是本轮公网漏洞复现。未来保持 loopback/私网、最小读路由和独立可信交换，不转发管理凭据到浏览器。

## 4. thu-push 的辅助导入与 CDP 权限

[weread-push README](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/README.md)描述引擎订阅、定时同步、查询和邮件工具链；[主 README](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/README.md)明确当前主要消费 WeRSS/微信读书数据，旧 pkuknow 通知抓取只是保留的可选组件，不是当前主要数据来源。日摘要可读 SQLite，不代表其整个辅助目录都是只读。

### 4.1 身份映射不是认证主体核验

`mp_searchbiz.py`输出 fakeid/nickname/alias 等候选；名称去空格后恰好一个匹配就记 hit，多个放 multi。没有核验学校认证主体，也不能证明公众号的全文抓取、转载或公开服务授权。

在这个引擎路径下：传入的 mp_id（base64形式的 biz/fakeid）写入 `Feed.faker_id`；解码后的字符串组成 `Feed.id=MP_WXS_<decoded>`。文章接口里的 mp_id通常指该 Feed.id，而非原 base64；API文档“base64(biz)”文字容易误读，必须以示例解码代码和当前服务实现为准。公开标识不等于访问凭据；fakeid与文章__biz的对应必须有核对证据，不能推广成所有平台情形都可互换。

CampusOS保留自己的 source_id；映射应记录 `source_id + engine_instance + feed_id + observed_biz + evidence + verified_at + policy_version`，不凭昵称或base64生成学校身份、不批量覆盖现有来源核验。引擎迁移、WeRead ID或多载体同名时回待核。

### 4.2 CDP 与停止条件

[mp_searchbiz.py](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/import/mp_searchbiz.py)访问9222调试接口，选择已登录公众号页，从URL取得token，用 WebSocket `Runtime.evaluate` 在该会话内 fetch searchbiz。CDP 能控制浏览器与已登录身份，不能把它当普通公开搜索 API。筛选仅检查URL子串，并非精确可信host；未来即使获批实验，也需独立受控浏览器、明确账号归属/平台授权、精确origin、禁止调试端口公网开放，不能连接负责人任意日常浏览器。

代码每条 sleep(2.8) 并定期保存结果，属于有限速线索；但非零ret或异常被记 fail 后仍会继续下一账号，没有“风控/身份限制即全局停止”。这不满足本轮规则。`websocket`是动态外部依赖，不能把 README 的简化部署描述理解为所有工具只需标准库。没有运行该脚本、连接CDP、取得token、导入订阅或使用任何历史授权材料。

### 4.3 辅助 API 与运维记录

[api.md](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/docs/api.md)记录本机 v1.5.3 契约：Bearer认证、表单登录、列表data.list、消息任务mps_id为JSON字符串、任务PUT需完整message_template/web_hook_url等。没有携带身份直接照抄请求；也不能在schema升级后假设永久兼容。

[RUNBOOK](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/docs/RUNBOOK.md)是作者Ubuntu/systemd环境的历史操作说明，含30分钟任务、08:15邮件、服务器路径与配置步骤，不是 CampusOS 运行证明。其“手动与定时重叠但重复无害”不能直接采用：URL去重不保证网络请求、授权尝试、Webhook、邮件、额度和并发提交没有副作用。CampusOS仍需原D1租约、fence、预算和审核，不复制systemd/SMTP/定时任务进入Workers。

“只读SQLite”应使用mode=ro、受限SELECT和有界列/行，正确处理WAL一致快照及秒/毫秒/文本时间；不共享可写库、管理员Cookie或通用SQL。公开交换只包含已批准source_id的白名单元数据及有许可的内容，保留出处/版本/撤回语义；WeRSS的已采状态不等于Console已审核、已发布。

## 5. 132 个公众号历史记录的上限

固定版本的 `feeds-132.json`静态数为132行、132个不同名称与biz，已核SHA但未请求这些账号。作者文档报告2026-10-10首轮132/132、607新增、数据库4341行及132个distinct mp_id；这是作者某次实例的历史观察，未取得其原数据库/逐号正文与后续增量证据。本轮未复制该数据库或清单到CampusOS。[历史记录](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/docs/api.md)。

不能由此推出：132号都有全文、每篇日期准确、每号全部历史完整、下一次更新成功、今天相同版本仍工作，或CampusOS已获得广外账号授权。计数也不是其七层验证全通过，更不能算作广外三目标的实测样本。

## 6. 本轮可复现的离线证据

脚本：[werss_helper_probe.py](../../../tests/research/werss_helper_probe.py)。执行：`python tests/research/werss_helper_probe.py --output docs/verification/s3-wechat-resumed/werss-helper-offline.json`。只读取原包AST选出的纯函数，禁止应用模块初始化、socket/DNS/监听、子进程和SMTP；不安装依赖，正文仅使用自写合成夹具。

**26/26符合预期**：实际上游函数5项（3项正常行为、2项局限复现），文档标识映射的合成检查1项，自有交换网关/内存账本草案20项。七层均未做本轮实机端到端验证，不能用这26项离线结果替代。分清验证对象：

- 上游纯函数：旧正文容器清洗、错误对象上抛、名称归一化；新版JS-only正文不支持与同名不能核验主体属于成功复现的局限。
- 交换格式草案：真实API形状的合成data.list、来源白名单、日期未知、URL限制；GET执行任务/POST订阅/PUT调度不可作为只读。
- 研究用内存账本：同URL/相同输入重复不增、同URL变更新修订、不同URL同标题不误合并。
- 停止草案：401/403/429和HTTP200业务错误暂停，之后“成功响应”也不会自动继续；没有任何网络请求。

后两类是未来适配器应满足的设计探针，**不是WeRSS已修复，更不是CampusOS产品功能已实现或D1事务测试**。3个受测源码文件前后SHA不变，网络/进程/SMTP尝试0，所有账号/文章样本0。[离线结果](../../verification/s3-wechat-resumed/werss-helper-offline.json)。

## 7. 集成建议与许可

两项目固定[WeRSS LICENSE](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/LICENSE)、[thu-push LICENSE](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/LICENSE)文本均为MIT，使用复制代码需保留声明；GitHub对WeRSS的自动分类是NOASSERTION，不能代替许可文本核查。代码许可不授予文章版权、账号权限、微信平台接口许可或邮件发送授权。

**WeRSS保留为长期订阅候选，本轮不正式集成；thu-push辅助链只作契约参考。** 若未来逐项授权并具备合法访问条件，再在现有独立本地环境验证七层与三广外目标，每工具每目标≤10篇；遇限制立即停止。正式试点前还需关闭自动关注/导入抓取等非必要副作用、阻断回退绕过、最小只读网关、发布/撤回映射及持久任务恢复，不能只运行README命令。

不新增服务器仍可先用CampusOS既有官网Connector、人工合法链接/元数据和Console审核，足够搭建初版信息入口；不能据此许诺24小时WeRSS订阅。后续若需要长期Python/浏览器/systemd运行，另行批准运行地点和成本。Workers Free仍只接有界结果，继续复用D1来源/版本/审核/任务/outbox；不引入第二套正式来源/审批库、不新增付费模型、不发真实邮件、不提前进入S3-C。
