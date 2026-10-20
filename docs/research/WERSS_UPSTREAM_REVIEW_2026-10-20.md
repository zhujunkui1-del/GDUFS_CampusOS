# WeRSS：指定微信公众号采集能力复核

核查时间：2026-10-20 03:38（Asia/Shanghai）。这是**当前上游的只读研究**；本报告没有登录微信、创建订阅或定时任务、请求真实文章、修改账号密码、操作本地 Docker 或修改 CampusOS 业务代码/云端。运行实例检查由主代理单独记录。

## 1. 结论

**可以指定少数公众号，手动执行或按 Cron 定时采集；其主要机制是轮询，不是微信发文时主动推送的真正实时采集。**消息任务允许多选公众号；可以用一个任务管理这几个号，也可以分开设时间。实际能否稳定抓到这些号，仍取决于微信/微信读书授权有效、所用通道可用以及风控。不能用“后台已登录”或“容器已启动”证明微信授权、真实正文和下一轮增量均成功。[任务表单](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/web_ui/src/views/MessageTaskForm.vue#L183-L204)、[调度到采集的代码](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/mps.py#L251-L313)、[实际采集入口](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/mps.py#L68-L99)。

| 问题 | 当前上游可证明的能力 | 不能由此保证的事 |
| --- | --- | --- |
| 指定几个公众号 | 订阅后，在消息任务中多选这些公众号 | 名称匹配不是组织主体认证；无效选择可能触发全部号回退 |
| 定时 | 5 位/6 位 Cron，任务可以启用/停用；表单默认每 5 分钟 | 不能保证每个时点准时完成；队列、正文请求、风控会增加延迟 |
| 实时 | 可手动刷新；轮询后可 WebHook 通知下游 | 未发现微信服务端“新文事件→直接送进本系统”的机制；WebHook 是采集后的输出 |
| 正文 | 有正文采集、HTML 清洗和新版纯文本兜底 | 不保证图文、表格、附件完整，也不自动获得内容再发布许可 |
| 历史 | 有分页和微信读书列表增量补抓 | 列表通道受限而降级到 cover 时只得最新一篇，不能恢复全历史 |

## 2. 本次固定版本与维护状态

- 当前默认分支 `main`：**`d94db01372105bc479db81a0ac91829dac7f43e4`**；提交时间 **2026-10-19 17:19:05（北京时间）**。GitHub 元数据显示未归档。下文源码链接均固定到此 SHA，不把旧下载包当作当前上游。[本次读取的提交入口](https://api.github.com/repos/rachelos/we-mp-rss/commits/main)、[固定提交](https://github.com/rachelos/we-mp-rss/commit/d94db01372105bc479db81a0ac91829dac7f43e4)、[仓库元数据](https://api.github.com/repos/rachelos/we-mp-rss)。
- **PR #478 已合并**，`merged_at=2026-10-19T09:19:05Z`，合并提交即上述 SHA。它修复公众号授权二维码的 `startlogin` 会话 UUID 流程，并为 `content_noencode` 文章页面增加正文兜底。2026-10-17 旧报告中的“尚未合并”已不适用于当前上游。[PR #478](https://github.com/rachelos/we-mp-rss/pull/478)、[PR 当前元数据](https://api.github.com/repos/rachelos/we-mp-rss/pulls/478)。
- GitHub latest release 仍是 **v1.5.3，发布于 2026-08-13**。发布标签、默认分支和 `latest` Docker 镜像是不同对象，不能仅看 v1.5.3 字样推断本地包含 10 月修复；本地镜像需另查摘要、构建记录或受检源码。[当前 latest release](https://api.github.com/repos/rachelos/we-mp-rss/releases/latest)。
- Issue **#463、#476 本次读取仍 open**。它们是使用者的同步失败报告，说明存在待验证风险；评论中的“官方接口停了”不是微信官方公告，也不能证明所有通道永久失败。#476 在本次最新评论中未给出对 #478 合并后的系统性复验。[#463](https://github.com/rachelos/we-mp-rss/issues/463)、[#476](https://github.com/rachelos/we-mp-rss/issues/476)。

## 3. 如何指定公众号与安排任务

### 添加目标

添加订阅有两条 UI 路径：**搜索公众号名称后选择结果**，或**提供该公众号的一篇文章链接以识别公众号信息**。搜索选择读取 `fakeid`，链接识别读取 `biz`；数据库据此构造 `MP_WXS_*` Feed ID。名称相同的搜索结果仍需人工核对具体账号；不能直接把组织名当成唯一标识。[添加页面 139–190 行](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/web_ui/src/views/AddSubscription.vue#L139-L190)、[链接识别 API 437–453 行](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/mps.py#L437-L453)、[Feed 创建 479–516 行](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/mps.py#L479-L516)。

**添加新号会马上把首次采集放入队列**，不只是保存名称。`max_page` 限制初次页数；当前示例配置为 5。不能为了“只看界面”而提交一个真实公众号，再声称没有触发采集。[首次任务](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/mps.py#L510-L516)、[配置](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/config.example.yaml#L78-L80)。

### 定时规则

消息任务表单有名称、状态、Cron 和公众号选择器，默认启用、默认 `*/5 * * * *`。调度器支持 `分 时 日 月 周` 以及前面增加 `秒` 的 6 位格式。示例：`*/30 * * * *` 每半小时；`0 8,12,18 * * *` 每天 8、12、18 点。调度器未显式指定时区，部署时需核对运行环境时区。[表单默认值](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/web_ui/src/views/MessageTaskForm.vue#L24-L32)、[Cron 解析](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/task/task.py#L47-L143)。

运行定时还需启动参数 `-job True` 与配置 `server.enable_job` 生效；任务查询只选 `status=1`。创建/修改后应确认任务已重载进入实际调度器。[启动门槛](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/main.py#L65-L70)、[启用任务查询](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/taskmsg.py#L19-L28)、[重载入口](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/message_task.py#L347-L358)。

**`SPAN_INTERVAL` 是采集篇目之间的等待，不是检查公众号更新的周期。**决定任务触发时间的是 Cron；当前常规定时采集请求 `MaxPage=1`，微信读书通道另有补抓页数逻辑。[间隔配置 65–66 行](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/config.example.yaml#L65-L66)、[定时调用 39、83 行](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/mps.py#L39-L83)。

**选定少数号时的实现边界：**空选择表示所有启用号；代码在指定 ID 查询结果为零时，也回退到所有启用号。若目标号被删除或任务 ID 失效，实际范围可能扩大。因此应显式选择目标并复核任务记录，不能将这个回退当作严格白名单保证。[选择与回退](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/mps.py#L269-L275)、[全部/指定查询差别](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/db.py#L233-L252)。

## 4. 授权、正文、历史与风控

### 两种登录应分别检查

管理界面的 `admin` 登录是本应用登录；公众号后台采集还依赖微信授权会话，微信读书通道依赖微信读书 Cookie/相关凭据。公众号后台会话失效有单独错误；过期通知能提示重新扫码。不能将应用的登录有效期当作微信授权有效期。[后台采集错误](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/app.py#L65-L86)、[过期通知](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/failauth.py#L10-L34)、[微信读书凭据加载](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread.py#L68-L111)。

当前 `jobs/mps.py` 对非精选的 `MP_WXS_*` Feed 在存在微信读书 Cookie 时自动选择 `weread_mp`，无 Cookie 时跳过并报错；手动单号刷新则直接取全局配置采集器。这意味着**手动刷新与定时任务可能走不同通道**，应分别验证。[定时自动选通道](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/mps.py#L69-L83)、[手动刷新](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/mps.py#L369-L381)。

仓库有宿主机 Chrome 刷新 Cookie 的辅助代码，需共享数据卷、保有登录态与宿主刷新代理；不能推断“只运行 Docker”就自动永久续期。当前说明还包含 macOS 钥匙串/launchd 场景，不能当成已在这台 Windows 部署验证。[宿主刷新架构](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/weread_cookie_refresh.py#L1-L24)、[任务刷新调用](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/jobs/mps.py#L224-L249)。

### 当前源码与自带文档存在差异

`docs/weread-mp.md` 仍说旧列表已废弃，只能获取 cover 最新一篇；**当前固定源码实际先调用 `/web/mp/articles` 做列表增量，列表不可用才回退 `/api/mp/cover`**。本报告按当前源码描述能力，不把文档中的旧断言当作微信官方结论。[旧说明](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/docs/weread-mp.md#L26-L35)、[当前列表请求](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread_mp.py#L223-L250)、[当前主路径/回退](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread_mp.py#L545-L575)。

- 列表路径按已入库文章停止翻页，增量故障补抓有页数上限，默认 `weread.mp_max_pages=20`；正文失败或未追到已存边界会明确报 `content_incomplete` / `backlog_incomplete`。这是有界补抓，不是无限历史保证。[页数控制](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread_mp.py#L203-L217)、[补抓实现](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread_mp.py#L389-L489)。
- cover 路径一次只取得最新一篇；若两次任务之间发了多篇，单靠该路径可能漏掉较早篇。该路径把采集当前时间写入 `create_time/update_time`，**不能将它当作原文真实发布时间**。正文失败仍可能以空正文落库，已存 ID 下一次跳过。[cover 实现](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread_mp.py#L327-L387)。
- #478 的正文兜底从 `content_noencode` 取纯文本并转为段落 HTML，代码明确说明会缺图片类富文本；不能据此声称完整图文恢复。[提取器](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread_mp.py#L153-L187)。
- 微信读书采集默认会把不在书架上的目标号自动加到书架，属于微信账号侧的“关注/书架”写操作。配置 `WEREAD_AUTO_ADD_TO_SHELF` 控制该行为；本轮未触发。[默认配置](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/config.example.yaml#L174-L188)、[书架写入](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread.py#L334-L384)。

风控边界：代码有公众号后台 `200013` 频控及 `200003` 会话失效处理，微信读书有访问配额/登录错误区分；列表和正文有等待配置。短周期轮询增加请求量，不能承诺“每秒抓取且不封禁”。这些是代码处理，不是平台对采集稳定性的担保。[后台处理](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/app.py#L65-L77)、[微信读书请求处理](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/wx/model/weread.py#L167-L241)、[节流配置](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/config.example.yaml#L182-L188)。

## 5. API、RSS 与导出

API 基路径为 `/api/v1/wx`。公众号、文章列表、消息任务等接口使用本应用用户或 Access Key 鉴权；文章列表有 `mp_id`、分页和 `has_content` 筛选。详情提供正文，RSS 提供单号与全号输出。**消费 RSS/API 是读取已采集数据，不会凭空消除采集端授权或覆盖率限制。**[基路径](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/ver.py#L1)、[文章列表参数](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/article.py#L411-L420)、[详情](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/article.py#L574-L591)、[RSS](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/rss.py#L184-L225)。

| 用途 | 当前源码接口/说明 |
| --- | --- |
| 指定号文章列表 | `GET /api/v1/wx/articles?mp_id=…&limit=…&offset=…` |
| 已存文章详情 | `GET /api/v1/wx/articles/{article_id}` |
| 手动单号更新 | `GET /api/v1/wx/mps/update/{mp_id}?start_page=0&end_page=1`，有真实采集副作用 |
| 手动执行消息任务 | `GET /api/v1/wx/message_tasks/{task_id}/run`，不是只读查询；最多等待 60 秒汇总，响应不证明所有队列工作均已完成 |
| 单号 RSS | `/rss/{feed_id}`；`/feed/{feed_id}.{ext}` 输出其他支持格式 |
| 文章导出 | `POST /api/v1/wx/tools/export/articles`；MD、DOCX、PDF、JSON、CSV，异步任务及状态/下载入口 |

接口依据：[单号刷新](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/mps.py#L342-L398)、[任务执行与 60 秒等待](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/message_task.py#L168-L237)、[Feed 路由](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/rss.py#L307-L318)、[导出请求参数](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/tools.py#L27-L49)、[异步导出](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/apis/tools.py#L91-L108)。

导出格式需看实际字段：当前 JSON 文件写 ID、URL、标题、封面、摘要、状态与发布时间，**没有正文 `content`**；MD 使用已有正文；DOCX 经 PDF 转换。需要机器读取正文时应核对详情/API 或专门交换契约，而不能假设 JSON 已包含全文。[JSON/MD/DOCX 导出字段](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/core/exporter.py#L263-L300)。

## 6. 面向本次需求的判断

适合做**独立的、少量指定公众号的定时采集候选**。建议先在现有本地实例核对镜像实际修复版本、微信授权与采集模式；获得明确目标公众号后再安排一个有界首批和第二次增量，分别检查标题、原链接、真实发布日期、正文和失败信息。只有两轮真实结果与下一次计划执行均可核对后，才称该部署对这些目标可用。本次上游研究没有提供真实采集成功率或长期运行证明。

仓库固定 LICENSE 是 MIT；软件许可与第三方文章/平台授权是不同事项。本文没有据此授予 CampusOS 复制、公开全文或调用学校私有系统的权限。[固定 LICENSE](https://github.com/rachelos/we-mp-rss/blob/d94db01372105bc479db81a0ac91829dac7f43e4/LICENSE#L1-L23)。

## 7. 本地 Docker 实例只读检查

本节由主代理在同日通过 Codex 浏览器和 Docker 只读命令核对，地址为 `http://localhost:8001/`。没有修改用户指定的管理账号或密码，也没有创建订阅、执行采集、保存/应用任务、扫码授权或升级容器。表单仅打开查看，随后取消并返回订阅管理。

| 核对项 | 实际观测 |
| --- | --- |
| 应用运行 | 容器 `we-mp-rss` 正在运行，8001 映射到宿主机；浏览器已以 admin 登录 |
| 现有数据 | 订阅管理及系统信息均为公众号 0、文章 0 |
| 微信授权 | 授权管理未显示账号信息；系统信息 TOKEN 过期时间显示“未登录”。这与 admin 管理登录是两件事；未验证微信读书凭据是否有效 |
| 定时配置 | 消息任务列表为空；页面明确提示“只有添加了任务消息才会定时执行更新任务，点击应用按钮后任务才会生效” |
| 定时表单 | Cron 默认 `*/5 * * * *`，有公众号选择器、启用/禁用、Message/WebHook 类型；当前选择器无可选账号 |
| 运行版本 | 系统页与 `/app/docker_version.txt` 都为 `1.0.20260813.1522`，核心版本 `1.5.3` |
| 镜像元数据 | 标签 `ghcr.io/rachelos/we-mp-rss:latest`，创建时间 `2026-08-13T07:25:15.66991483Z`，镜像摘要 `sha256:af771f21b3f7958a5dea16911fba050a6d7b92eac2fb2499c467c1b11f07ef34` |
| 实际采集源码 | 只读检查容器内 `/app/core/wx/model/weread_mp.py`：`get_Articles` 直接走 `_get_mp_cover`，一次仅最新一篇；未见当前上游的 `content_noencode` 或 `ensure_mp_on_shelf` 实现。运行文件与当前上游有差异，不能把 `latest` 标签当作已包含最新修复 |
| 数据持久化 | `docker inspect` 的 `Mounts` 为 `[]`，未见宿主机/命名卷挂载。若数据保存在容器可写层，删除或替换容器会丢失，升级前需先核对并备份实际数据；本轮未变更部署 |

**本地判断：**现有部署可进入管理界面和定时配置，但尚无目标公众号、有效采集结果或实际计划任务的证据。本地微信读书代码的“只抓最新一篇”路径存在漏文边界，也尚未确认正文兼容性。不能据此记作已具备稳定实时/定时采集。下一步需要用户提供目标公众号名称（优先每号一条文章链接以减少同名误选），再核对适用通道、授权和版本，进行有界采集及后续增量验证。

本轮没有新增或运行自动化测试，没有请求微信真实文章，没有更改 CampusOS 业务代码、云端数据或发布版本。
