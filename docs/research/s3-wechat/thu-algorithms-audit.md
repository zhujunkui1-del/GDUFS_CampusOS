# thu-push 时间、排序、日历与反馈算法审计

日期：2026-10-17（Asia/Shanghai）。CampusOS 续接基线：`206e01d`。本文件是独立研究证据，不是 S3-C 功能实施或生产验收。

## 1. 版本、许可和维护证据

- 上游：[thu-lawyer/thu-push](https://github.com/thu-lawyer/thu-push)，默认分支 `main`，本轮 `git ls-remote --symref` 及本机克隆一致钉到 **`19abc55134cf5691e575fbcc74cb88d3801c2b28`**，提交时间 **2026-10-12 00:54:42 +08:00**。续接后再次只读检查 HEAD，仍为该 SHA。
- [当前钉版 README](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/README.md)明确当前主链路消费 WeRSS 的本地只读 SQLite；早期 pkuknow 通知抓取保留为可选组件。中文时间、通知侧可解释排序及 ICS 主要属于通知组件，不能据此宣称当前微信文章链路已抽取完整活动。
- [钉版 LICENSE](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/LICENSE)为 **MIT**：允许软件使用、修改和再分发；复制或实质移植时保留版权与许可声明。该许可不授予公众号内容版权、平台会话使用权、学校来源认证或私人数据处理权。没有发现本仓库额外的非商业许可。
- 已有2026-10-17同日公开页快照（原元数据文件的检查时刻，非本轮重新取得问题计数）显示 GitHub Issues未关闭 Issue **0**，Pull Requests 页显示 open **0**、closed **0**。这是当时网页快照，不是无缺陷证明；未认证 GitHub REST API 返回 403 `rate limit exceeded` 后未使用凭据或规避限额，改用正常公开 GitHub 页面与 git 协议取证。[Issues](https://github.com/thu-lawyer/thu-push/issues)、[PR](https://github.com/thu-lawyer/thu-push/pulls)。网页元数据与哈希见 [thu-repository-metadata.json](thu-repository-metadata.json)。
- 仅近数日提交活跃的早期项目，当前发布版本仍为 Python 包 `0.1.0`；不能从“持续维护”推出广外账号采集稳定。
- 负责人本地原包实际为 `CampusOS_Codex_完整设计文档_v2/thu-push-main/thu-push-main/`。对 README、LICENSE、6 个核心模块、3 个指定测试、依赖、enrich/store/cli 和 weread-push 4 个文件共 **20 个文件**只读比对，**CRLF 归一后全部相同**；原始字节有换行差异，不宣称原包字节完全相同（JSON 同时记录逐文件字节哈希及归一比较）。原包没有 Git 元数据，文件匹配不等于能证明整个压缩包的提交身份；原包未修改、未安装依赖。

## 2. 安全审查和本机离线试验

完整阅读 `timeparse.py`、`score.py`、`render.py`、`gzh_source.py`、`mailer.py`、`feedback.py`、3 个指定测试及相关调用点后，才执行以下范围。所有上游源码留在被忽略的 `.map-tools/wechat-research/`，没有复制上游程序进 CampusOS 运行代码。

| 层级         | 本轮事实                                                                                                                       | 不能替代的验收                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 依赖与运行   | 独立 Python **3.12.5** venv，`--without-pip`；本次 **0 安装包**，仅标准库                                                      | 未验证完整安装和常驻部署                                                 |
| 上游指定测试 | `test_timeparse` **32/32**、`test_score` **38/38**、`GzhSourceTests` **5/5**、`RenderGzhMergeTests` **6/6**，合计 **81/81**    | 未运行全部上游测试；通过不表示符合 CampusOS 时间/安全契约                |
| 排除测试     | `FeedbackIcsHttpTests` 5 项会真实绑定本地 HTTP 端口，本轮没有运行                                                              | 不声称反馈 HTTP 服务实测成功                                             |
| 自有探针     | **17/17 组完成观察**，包含不合要求的输出，不能称为 17 项产品验收通过                                                           | 合成输入不证明真实校园通知解析准确率                                     |
| 约束         | 清除 `ND_*`、SMTP、MAIL 等运行环境；审计钩子拒绝网络连接、DNS、监听、SMTP 和后续子进程；临时 SQLite/文件仅在忽略的本地 scratch | 非操作系统级沙箱，不是未知恶意软件安全保证                               |
| 实际外部操作 | 真实文章请求 **0**、模型请求 **0**、SMTP 投递 **0**、CDP/微信账号/WeRSS 服务启动 **0**；网络等禁止操作尝试 **0**               | 微信发现率、URL 正确率、正文完整率、发布时间准确率和增量成功率均 **N/A** |

机器结果：[thu-offline.json](../../verification/s3-wechat-resumed/thu-offline.json)。自有复现程序：[thu_algorithms_probe.py](../../../tests/research/thu_algorithms_probe.py)。复现只执行钉版源码，非测试业务数据，不导入 D1：

```powershell
# 预先完成源码/许可审计，再在隔离目录准备固定 SHA 克隆。
# 原始文档包只用于下方 --local-archive 只读比较，不在其中运行。
git -c http.proxy=http://127.0.0.1:12451 clone --depth 1 https://github.com/thu-lawyer/thu-push.git .map-tools/wechat-research/thu-push
git -C .map-tools/wechat-research/thu-push rev-parse HEAD
# 必须等于19abc55134cf5691e575fbcc74cb88d3801c2b28；不同版本先重新审计。
python -m venv --without-pip .map-tools/wechat-research/thu-venv
.map-tools/wechat-research/thu-venv/Scripts/python.exe tests/research/thu_algorithms_probe.py --upstream .map-tools/wechat-research/thu-push --local-archive CampusOS_Codex_完整设计文档_v2/thu-push-main --output docs/verification/s3-wechat-resumed/thu-offline.json
```

已有克隆/venv直接运行最后一行，不重复 clone、不覆盖源码。脚本检查 `.git/HEAD` 是否为审计 SHA，并保存被执行文件 SHA-256。81 个上游测试成功、17 组探针正常返回且无禁止行为尝试时退出 0；这个退出码仅证明研究执行完成。

## 3. 中文时间：值得参考词法，不能原样作发布核验器

上游核心见 [timeparse.py](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/timeparse.py)、[enrich.py 的 parsed_for_item](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/enrich.py#L246)。全角数字归一、中文月日/星期/相对词/截止关键词、正文扫描 20000 字符上限、解析失败保留文本及时间桶，都可作后续 TypeScript 规则参考。

### 3.1 本机观察的语义问题

| 合成输入/条件                                    | 钉版实际行为                                                                                             | CampusOS 处理要求                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `报名截止2026年10月20日`                         | `deadline` 和 `start` 都写成当日 `00:00+08:00`；`time_status=ok`；渲染出 1 个全天 VEVENT                 | 报名截止不能当举办开始；仅保留 date 精度，时刻 NULL。不自动补 00:00 或 23:59 为已知截止时刻 |
| `2026年10月20日至2026年10月22日`，无报名语句     | 自动令 `deadline=end`，出现不存在的报名截止；全天 ICS 的 DTEND 为 22 日                                  | 活动区间和报名区间分开；中文“至”末日含义需要保留，不直接套非包含 DTEND                      |
| `1月5日`、锚点 2026-10-17                        | 180 天规则推成 **2027-01-05**，结果没有 `inferred` 标识                                                  | 缺年推断必须携带证据、锚点和推断标志，未经审核不当确定事实                                  |
| `下周五14:00`，原文 10 月 1 日、执行 10 月 17 日 | 按原发布日期锚定为 10 月 9 日；现有 `parsed_for_item` 却用执行 `now` 得 10 月 23 日，忽略 `published_at` | 必须绑定真实原文时间/上下文锚点；采集时间不能取代发布日期。没有可信锚点则待核               |
| `今晚`                                           | 擅自生成 **19:00**，`time_status=ok`                                                                     | “晚上”只证明时段，不构造精确开始时刻                                                        |
| `2026年2月30日`                                  | 绝对日期失败后按“日号”规则退化，生成 **2026-10-30**                                                      | 明确非法完整日期应报无法解析；不可通过低精度 fallback 改写事实                              |
| `2026年10月20日（周五）14:00`                    | 接受 20 日，不拒绝与实际星期二矛盾                                                                       | 日期与星期冲突入待核，保留两条证据                                                          |
| `2026年10月20日14:00-16:00`                      | 仅 start=14:00，end=NULL                                                                                 | 时钟区间需独立规则；未知结束保持未知，不能宣称完整提取                                      |
| 一文中 10 月 20 日、21 日两场活动                | 只返回首个点时间                                                                                         | 每场有独立候选、证据和序号，不把整文压成一个活动                                            |
| 已知 10 月 25 日活动、10 月 20 日 17:00 报名截止 | structured 分支把正常提前截止判不可信，deadline=NULL                                                     | 报名截止通常早于活动开始；上游该“可信性”规则不适合 CampusOS                                 |

证据缺口：`ParsedTime` 只有 start/end/deadline/bucket/evidence，没有时间精度、是否推断、锚点、字段类型、文章版本、原始 offsets、核验身份/状态。`evidence` 常只保留日期，不含随后解析到的时刻；区间证据甚至是重拼的字符串，不能直接当原文精确 span。

### 3.2 负责人要求的十类边界：thu 能证明什么

| 边界                  | 本轮证据                                                           | 结论                                                           |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 发布时间/举办时间分离 | 只有 `published_at`、没有活动字段时 start=NULL                     | 该例安全；相对词调用链仍错误用 `now`                           |
| 截止不当开始          | 日期型截止同时成为 start，且可出 ICS                               | 不满足                                                         |
| 日期无时刻            | 00:00 占位且有 deadline/end 时标 ok；无 precision                  | 不满足                                                         |
| 相对时间无锚点        | 直接传 anchor=None 时返回 undated 并保留文本；真实调用链传执行 now | 失败 fallback 可参考，锚点契约需重写                           |
| 多活动                | 只取一条 ParsedTime                                                | 不满足                                                         |
| 多来源重复            | raw URL md5 相同会去重；同标题/标点被合并                          | 不能作为文章或活动的权威去重；会丢来源关系                     |
| 取消/改期             | 传 cancelled/postponed，ICS 仍 `CONFIRMED`                         | 不满足                                                         |
| 缺正文/发布日期       | 普通无时间信息不生成 start；仅带 AI 时间字符串却仍接受精确时间     | 不能证明 AI 字段有原文证据，需要 CampusOS 门禁                 |
| 同 URL 多发现器       | 合成两个来源相同 URL 最终留 1 条；投影无 origins 列表              | 身份可合并，发现出处必须另存，不能丢证据                       |
| 平台阻断即停          | gzh_source 只读 SQLite，不负责微信 HTTP；本轮未发真实平台请求      | 不适用此模块/未验证；不能据它声称 403、429、验证码停止策略合格 |

### 3.3 建议的窄移植边界

后续可写独立、纯函数的 TypeScript 时间**候选**解析器，输出字段类型、raw span+offset、`date`/`time|null`、date/exact/period/unknown 精度、推断原因、可信原文锚点及已冻结的文档修订引用。对不同字段分开调用，允许一文多候选，返回 pending，不由模型或解析器自填 verified。沿用 CampusOS 的 `published_at/fetched_at/source_updated_at/updated_at` 分离、审核记录及版本门禁，不移植上游 `time_status=ok` 作为发布许可。

## 4. ICS：格式处理有价值，公开导出和取消机制尚不够

代码见 [render.py 的转义和 UID](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/render.py#L716)、[批量导出](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/render.py#L927)、[单项导出](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/render.py#L1018)。RFC 核查：[RFC 5545 内容行/折行](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.1)、[VEVENT 非包含结束语义](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6.1)、[SEQUENCE](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.7.4)、[RFC 5546 取消](https://www.rfc-editor.org/rfc/rfc5546.html#section-3.2.5)。

本机证明：

- CRLF 输出、按 UTF-8 字节不切坏汉字的 75 字节折行、分号/逗号/反斜线及换行转义均有可参考实现。合成标题/地点/URL 含 CRLF 时没有注入额外 VEVENT；这不是完整模糊测试或对任意恶意输入的安全证明。
- 定时事件带 `TZID=Asia/Shanghai` 及同名 VTIMEZONE；全天用 VALUE=DATE。UID 基于固定命名空间+item_id，同一 ID 改时后不变。
- 批量导出能使用调用者提供的 sequence/revision 与更新时间写入 `SEQUENCE`、`LAST-MODIFIED`。没有这些字段时序号默认 0，并非自行管理事件版本。

不能直接复用的部分：

1. 单项 `build_single_event_ics` 不写 `SEQUENCE`、`LAST-MODIFIED`，与批量路径不同；两条路径都固定 `METHOD:PUBLISH` 和 `STATUS:CONFIRMED`，不支持业务取消。
2. renderer 没有“当前已审核来源/文章版本/活动证据”校验。只要 start 存在就导出，日期型截止、缺证据的 AI 时间也能进入日历。无 start 时不出 VEVENT 只是必要条件。
3. `is_all_day` 靠 00:00 和文字猜精度，不能可靠区分真实午夜、日期占位与未知时刻。中文日期区间结束日直接作为非包含 DTEND，可能少覆盖最后一天。
4. 每次下载是静态文件，不等于日历订阅。即便 UID/SEQUENCE 正确，也不能保证已手工导入的各手机日历会自动获取取消/改期；本轮没有 Android/iOS 日历客户端验收。

CampusOS 后续无需学生登录即可提供**只读公开、已核验活动** ICS，但生成前必须复验统一公开门禁、活动版本和时间精度。UID 使用稳定 `event_id`，同事件改期递增可信版本；取消策略和静态再导入/未来订阅分别设计、真机核对。日历下载不写 `user_schedules`、不自动代表参加活动，也不产生个性化正反馈。

## 5. 排序与 fallback：优先确定性，保留“全部/时间排序”

代码见 [score.py](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/score.py)、[gzh_source 的排序](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/gzh_source.py#L227)。

- 通知侧：分类、关键词、来源、活动时间桶、截止桶、弱化词组成特征；贡献相加、理由可列出，分数相同按 item_id 稳定排序。正文/摘要匹配截到 2000 字符。学习单步上限 0.05，学习权重裁剪到 [-5,5]，每日衰减 0.995，都是可借鉴的限制思想。
- 微信侧是另一条链：给智谱模型发送**标题和来源**挑选子集；无 key 或失败则关键词表确定性 fallback，不会完成正文事实提取。提示词和关键词偏向清华法学院，不适合直接给广外学生排序。本轮仅 Mock `zhipu_rank=None` 测试 fallback，没有调用智谱或 DeepSeek。
- 合成探针确认 ASCII 子串匹配会把 `chair` 命中 `AI`；调用者配置先验 999 不被裁剪，只有存储权重被剪到 5。
- 更重要：`apply_feedback_deltas` 注释说保存学习增量，但 `merged_weights` 把该值**覆盖**先验。探针中“讲座”先验 1.0，一次正反馈 delta=0.05，重新合并变成 0.05，非 1.05。不能照搬为“越赞越推荐”的已验证闭环。
- 默认配置及渲染沿用上游 13 个分类，不能替换 CampusOS 固定 7 类雷达/6 类知识契约。不同业务分类也不能靠标题相同硬合并。

推荐的首阶段只评估：最新发布、即将举办、报名将截止、经用户明确选择的学科/来源/分类偏好。所有排序必须先做公开状态与事实门禁，并始终提供不按推荐分筛选的全部/时间排序；重要公告不被推荐子集隐式隐藏。个性化反馈学习延后到有可信学生身份、明确同意、可关闭/清理和独立隐私验收之后。

## 6. 只读 SQLite、增量和去重的实际边界

代码见 [gzh_source.py](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/gzh_source.py)、[cli 组合路径](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/cli.py#L450)。

已测：`mode=ro` 确实拒绝 DELETE；数字秒/毫秒可规范；合成窗口内 URL 重复可去重，`mark_sent` 后再次读为空。文章投影只有 id/title/url/mp/ts/key，没有正文/正文完整性、认证主体、文章版本或许可字段。

发现：

1. `to_epoch` 的字符串分支引用未导入的 `datetime`，实际抛 **NameError**；测试只覆盖整数 pub_time，81 项通过不能覆盖该路径。其字符串截取格式及本机时区语义也需重新设计，不能以采集/更新时间作发布时间 fallback。
2. schema 探测未要求 time/id 非空，缺 time 时 join 列表 TypeError；缺数据库和损坏台账却都变成 `[]`/空集合，正常无新增与故障不清晰。未来时间只检查下界，合成未来一天的文章被接受。
3. `fetch_recent` 先全表 `fetchall()` 再 Python 过滤，没有 CampusOS source allowlist、SQL 窗口/分页/预算。不能放 Workers Free 用户 HTTP 请求里处理整个 WeRSS 库。
4. raw URL md5 未规范跟踪参数，参数不同被当新文章；跨通知/公众号按删标点后的标题去重，会误合并不同来源同名通知，也没有保留多发现出处。本机两来源同 URL 最终仅一条、没有 origins 投影。
5. `save_state` 注释称原子写，但实际 `write_text` 直接覆盖，没有临时文件+rename；5000 个 key 按 md5 字典序截取并不是“最近 5000 篇”。异常后可能重推，不能作为持久采集幂等账本。
6. CLI 发信成功后给本轮 `gzh_all` 全部记 sent，包括没被 top-N 选中及标题去重掉的文章；这是私人日报的选择，不等于每篇文章均实际展示/审核/发布成功。
7. SMTP 文件回执和本地 attempt 表只能解释部分重复发送；未完成 attempt 可再次抢占，且邮件外部效果与本地记账不是同一原子事务。当前不验证多人、多实例、并发/崩溃下 exactly-once，不移植为 CampusOS 采集租约。

适配时只考虑**获授权的只读导出/有界 API**→严格交换格式→原有 Source Registry、来源准入、ingestion_jobs 租约/检查点、文章内容修订、`document_origins`、Console 待审及 outbox。不能导入它的整个 SQLite Schema、sent 台账或未经审核的全部订阅。失败必须有 error/blocked 状态，不能以空列表冒充无新增。

## 7. 反馈和邮件：目前只适合私人单用户参考

代码见 [feedback.py](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/feedback.py)、[mailer.py](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/notice_digest/mailer.py)。

- 可借鉴：HMAC 绑定条目+操作，恒时比较；回环监听限制；同条目/操作去重；邮件预取识别；真实发信失败返回失败；默认请求日志不打印带签名的完整 URL。
- 本机证明：渲染链接不带 exp，而 verifier 接受无 exp 的旧签名，`is_expired(None)=False`；`ALLOW_LEGACY_TOKENS=False` 常量没有让当前渲染路径拒绝永久票据。不可把“有 30 天 TTL 函数”当当前全部链接会到期。
- `feedback`、`weights` 等表按单份本地库设计，没有 user_id/租户；转发邮件链接可复用持有的 bearer 权限。不能把它们直接变成学生多用户偏好系统。
- GET 点赞/点击会写反馈和学习权重，`/nd/ics` 下载也先按 up 学习；安全扫描器名单只是一种启发式，不是用户同意，也不能把下载日历当确认参加。
- `gzh-<key>` 反馈条目不一定存在于通知 Store，本机 unknown-item 返回不学习，但普通返回文案仍可表示“会多推”；当前微信推荐与通知反馈实际闭环需额外核对。
- 反馈日志会保留 item/kind/time，预取诊断会输出 item、UA；SMTP 回执含收件地址。若未来有学生服务，必须另行确定用途同意、身份隔离、最小日志/保留期限、注销/清理、不收集 GPS/私人对话、签名轮换和撤销。不允许运营密钥代替学生身份。

本轮没有运行 SMTP、feedback server、systemd、nginx、部署脚本，也没有发任何学生通知。Cloudflare Workers 不承载 Python/systemd/SMTP 常驻流程；本轮不购买服务器或服务。

## 8. weread-push 工具链：仅审读，未获微信操作授权

已读 [README](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/README.md)、[mp_searchbiz.py](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/import/mp_searchbiz.py)、[API](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/docs/api.md)、[RUNBOOK](https://github.com/thu-lawyer/thu-push/blob/19abc55134cf5691e575fbcc74cb88d3801c2b28/weread-push/docs/RUNBOOK.md)。

- searchbiz 通过本机 9222 CDP 找已登录 mp.weixin.qq.com 且 URL 带 token 的标签，借浏览器会话调用平台接口；按 nickname 精确匹配候选，并不验证账号认证机构。轮询间隔 2.8 秒和“公开 biz”不能证明平台授权或账号权利。
- 批量失败按条记录后继续，代码没有对统一平台风控 ret 值提供明确“停止整批”的门禁。不能直接运行它去探测广外账号，更不能绕过验证码或寻找 Cookie。
- 文档记载作者 2026-10-10 的 **132 号/607 新增/4341 总文章**，是作者历史运维记录。当前库没有我方这些账号登录、真实 API 或后续增量证据，不能转述为 CampusOS 已跑通 132 号，也不证明 2026-10-17 的 WeRSS 当前版本兼容。
- 文档 API 契约针对作者当时的 WeRSS **v1.5.3**，包括 OAuth2 表单、分页、RSS、任务全量更新及 JSON 字符串 mps_id；适配当前 WeRSS 前仍需按另一个钉版核对。README 所谓“无额外依赖”也不覆盖 CDP 脚本运行时导入的 `websocket` 包。

真实层级结果：账号认证、登录、订阅导入、真实文章发现、正文获取、后续新文增量、长期服务/API稳定性全部 **未执行/未验证**。本轮只对 GitHub/RFC 做公开只读研究；所有真实微信公众号相关比例分母未知，记 N/A。

## 9. 建议结论和实施先后

1. **可研究性移植：**中文词法归一、保留失败证据、可解释确定性贡献、ICS 文本转义/UTF-8 折行/稳定 UID 思想。MIT 允许代码实质复用时保留许可；为 CampusOS 重写接口和严格合约后才进入开发任务。
2. **移植前必修：**举办/报名时间分离、date/exact/period 精度、缺年/相对锚点、非法日期阻断、多事件、证据版本、取消/改期、统一两条 ICS 生成路径、来源及公开状态门禁。17 组探针中暴露的问题不能原样进入正式库。
3. **后置：**有界偏好权重的实现和个人反馈；先解决覆盖先验的缺陷与多用户隐私，不调用额外模型。邮件/SMTP、CDP 订阅导入与常驻服务不属于本轮实施。
4. **现有架构保持：**来源/文章/审核/版本/outbox/任务复用 CampusOS，不新建私有推荐数据库。本轮没有修改 app、地图、Agent、D1、Cloudflare、正式 DNS 或模型凭据。Dify 已按 `206e01d` 永久退出选型，本研究没有调用或提出接入它。
5. 官网+人工授权链接仍可独立支撑候选入库和审核；不把 thu-push 的下游排序能力当作微信采集引擎，不据该项目解除微信采集授权或平台阻断门槛。
