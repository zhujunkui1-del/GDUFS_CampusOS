# WeChat MP Tools：安装包与历史回补能力复核

日期：2026-10-20 23:18（北京时间）  
本地对象：`D:\WeChat MP Tools`  
目标：广外就业中心 `MP_WXS_3293703638`，2026-07-01 00:00（北京时间，含当天）起的历史文章；后续再评估 81 号。

## 结论

**可以将它保留为微信公众号历史回补候选。它确实实现了历史列表分页、日期范围任务和正文导出，不能概括成“只能下载单篇”。** 本轮进一步核对了实际安装包，而不是只看 README。

本地已有两篇成功导出，分别属于“广外就业”和“广外就业中心”；目标号的一篇记录发布日期为 **2026-09-30 15:27:14**，保存时间为 2026-10-20 23:00:29。已有结果证明正文导出有实际产物，但还不足以证明目标号从七月起的目录已经完整取得。

因此，当前状态为：**支持历史采集的实现已确认；本地正文导出产物已确认；目标日期范围完整覆盖尚未确认；CampusOS 接入尚未实施。** 不需要用户逐篇收集 81 个号的文章链接。

## 1. REA 学习与本轮方法

已阅读用户提供的 `D:\tlydcg\Codex_work\rea逆向工程\rea-main` 中 README、相关 CLI/Evidence 说明，以及已安装的 `reverse-engineer-anything` 技能和打包产物检查说明。本地源码 `package.json` 标版本 6.5.0；技能版本为 42，两者不应混作同一工具版本。

本轮采用其中的调查原则：先确定产物身份，再核对关键代码，最后用已有数据区分实现、实际结果和未确认范围。当前会话没有连接 REA MCP，也没有可直接调用的 `rea` CLI；没有安装或注册 REA，没有生成 REA Evidence ID。

实际检查使用 Python 3.12 标准库离线解析 PyInstaller 的 CArchive/PYZ，再读取选定本地 JSON。只将字节码解码为 code object、编译公开源码进行比较，**没有导入或执行目标模块、启动 EXE 或发起文章抓取**。以下证据属于普通离线分析结果，不冒称 REA 引擎输出。

## 2. 安装包身份与源码对应

| 项目 | 观察结果 |
|---|---|
| EXE | `D:\WeChat MP Tools\WeChat MP Tools.exe` |
| 大小 | 13,296,260 字节 |
| SHA-256 | `b0d2be34d9a6adc3837f0196cf60f1eb6bb8d2b9b72c3b61b89bf4903094d516` |
| 打包形式 | PyInstaller，Python 3.12，内嵌 PYZ 目录 1,827 个模块 |
| 应用版本 | `backend.config` 常量为 `2.2.4`；EXE 未提供 Windows 文件版本字段 |
| 上游固定版本 | [`5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3`](https://github.com/x554960766/wechat-mp-tools/tree/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3) |
| 比较范围 | `config`、`articles`、`downloader`、`auth`、`accounts`、`rss_scheduler`、`refresh_queue` |
| 比较结果 | 7 个模块的递归归一化 code object 全部一致 |

归一化比较包括字节码、常量、名称、参数、栈信息和异常表，忽略文件名、首行号和行号表。它支持这些模块逻辑对应固定源码的判断，**不是整包签名或全部依赖的真实性验证**。

完整摘要、文件散列、代码比较方法见 [离线证据 JSON](wechat-mp-tools-local-review-2026-10-20/evidence.json)。分析脚本和下载的公开源码保存在被 Git 忽略的 `backups/wechat-mp-tools-review-2026-10-20/`，没有覆盖安装目录。

## 3. 实际已有数据

本地 `accounts.json` 有 2 个账号，`download_history.json` 有 4 条记录：成功 2 次、失败 2 次；`articles_full` 有 2 篇文章目录。

| 账号 | 对应标识 | 成功导出 | 已记录的发布时间（北京时间） |
|---|---|---:|---|
| 广外就业 | `MP_WXS_3083007618` | 1 | 2026-10-19 23:19:50 |
| 广外就业中心 | `MP_WXS_3293703638` | 1 | 2026-09-30 15:27:14 |

这两个名称属于不同公众号，不能混为同一目标。目标号成功文章为《【用人单位邀请函】广东省2027届普通高校毕业生系列供需对接活动——外语外贸类专场》，目录内有 `data.json`、`metadata.json`、`content.txt`、HTML、Markdown、PDF 和媒体文件。

- 目标号 `data.json.content` 为 43,403 字符，`content.txt` 为 1,365 字符；这是实际保存文件的长度，不是正文准确率。
- `data.json` 的字段为 `source / author / title / url / cover_url / publish_time / content`，可以作为后续本地转换的输入。
- 发布时间来自已有导出记录，本轮没有联网独立核对原文时间；保存时间与发布时间分开记录。
- 两次失败均为《2027届毕业生生源信息和电子简历填报指南》，保存的短链仍含 `oi~Lh3K0LZ92f~LtQBSljQ`。正确短链应按此前已确认的 WeRead 编码还原为下划线。这一问题仍存在于该安装包，不能沿用 WeRSS 已修好的结论。
- 两个 RSS 订阅处于启用状态、间隔 60 分钟，但本地 `last_fetch_time=0`、`total_articles=0`；这些字段不能证明自动 RSS 已成功运行。

检查结束时，本轮读取过的 EXE 和数据文件散列均保持。未读取 `account_pool.json`、代理凭据、浏览器 Profile；未复制第三方正文和媒体进 CampusOS 仓库。

## 4. 对历史回补有用的实现

| 能力 | 固定源码中的实现 | 对本任务的意义 |
|---|---|---|
| 历史目录 | `_fetch_articles_page` 使用 offset/count、解析目录及 hasMore | 已有分页实现，具体账号的成功页链仍需运行证据 |
| 日期范围 | `start_range_download` 接收起止时间；`_do_range_download` 分页筛选 | 具备七月起回补的任务入口 |
| 正文与文件 | 保存 HTML、纯文本、Markdown、PDF、JSON | 已有本地成功产物可核对和转换 |
| 账号映射 | 支持 `MP_WXS_...` 与 Base64 biz 对应 | 现有 81 号可按 ID 映射，不必人工逐篇找链接 |
| RSS 增量 | 独立调度器、重复判断、文件缓存 | 可作为未来增量候选；不等于历史回补完成 |

源码：[分页](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L110-L297)、[日期入口](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L417-L457)、[日期循环](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1003-L1108)、[账号转换](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/accounts.py#L24-L56)。

## 5. 接入前需要处理的具体问题

1. **短链错误已有实证。** `_resolve_review_doc_url` 和分页 URL 构造仍直接使用 WeRead token，且有 `split('_')[-1]`。需要同时处理 `~` 还原和 token 内下划线保留，使用稳定账号前缀拆分；本轮没有修改 EXE。[位置](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L70-L106)
2. **任务完成不能当完整覆盖。** 首屏 cover 可返回单篇且时间为 0；分页失败可能只剩 cover，`total_count` 又由当前结果估算。日期任务可能因此报告“已扫描全部文章”并标 completed。需要保存成功页链、继续标志、停止原因和七月边界，区分成功、部分完成和失败。[分页及返回](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L184-L297)、[任务结束](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1033-L1091)
3. **未知日期不能自动算进范围。** 日期任务对时间 0 不筛选；下载器未提取到原文时间时默认当前时间，失败历史也会填当前时间。需要把真实原文时间、目录时间、采集时间及未知状态分开，未知日期进入待核对清单。[日期判断](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/articles.py#L1044-L1053)、[下载器时间](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/downloader.py#L1137-L1145)
4. **RSS 有独立上限。** 当前一次最多扫描 5 页，每页 10 条，遇已有文章会停；每号 RSS 缓存保留 200 条。这个缓存上限不等于磁盘下载文件上限，也不能作为全部历史目录。[增量循环](https://github.com/x554960766/wechat-mp-tools/blob/5c0a6b7a3740f1e28087e2cc8577c3059e5a17f3/backend/rss_scheduler.py#L608-L673)
5. **当前请求路径仍受之前的访问限制约束。** 安装包对应的源码遇到 `499/-2041` 会运行模拟终端激活并尝试账号轮换，与前轮已被拒绝的历史访问路径相关。用户授予本地目录使用权限并不解除该限制；本轮因此只检查离线产物，没有调用列表/正文接口或启动新抓取。详见 [此前路径审查](WECHAT_HISTORY_TOOL_AUTH_REVIEW_2026-10-20.md)。

## 6. CampusOS 后续接入顺序

1. 优先处理该号的现有本地导出：按明确账号 ID 对应来源，提取标题、原文链接、可追溯时间和文件散列，保留正文在原目录。
2. 修正链接、日期和任务完整性判定，独立保存每号每页的采集状态；遇访问拒绝停止并标记部分完成。
3. 在允许的访问条件下取得目录运行证据后，核对是否到达 2026-07-01 之前、范围内文章数量、失败/未知日期和缺页。仅看到多篇列表或一个 completed 标签都不足以通过。
4. 单号通过后再映射 81 个账号，按号记录覆盖状态。CampusOS 的来源许可、正文用途、审核/发布与自研 D1 索引流程分别核验，不直接启用该工具的通用远端上传网关。

本轮完成的是候选复核与现有产物盘点，新增采集 0、WeRSS 写入 0、CampusOS 业务写入 0；没有运行测试套件。付费服务保留为备选，本次没有采购或调用收费接口。
