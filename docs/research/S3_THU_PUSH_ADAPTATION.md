# S3-C｜thu-push可借鉴能力与TypeScript适配边界

2026-10-17，基线`206e01d`。固定上游`19abc55134cf5691e575fbcc74cb88d3801c2b28`、MIT；这是技术研究/计划，未移植生产算法、启动服务、发送邮件或开发完整校园雷达。Dify已废弃。

完整逐模块事实、原包20文件比对、81上游测试与17探针见[算法审计](s3-wechat/thu-algorithms-audit.md)及[原始结果](../verification/s3-wechat-resumed/thu-offline.json)；工具链另见[WeRSS/helper](s3-wechat/werss-helper-audit.md)。复制或实质移植MIT代码须保留相应版权/许可；本轮只写自有合成测试，不复制整套应用。

## 1. 两条职责，分别评估

1. `weread-push`是平台账号身份发现、订阅导入、WeRSS查询/更新的辅助工具链，依赖合法已登录公众号平台会话及CDP；**不是独立全量采集器，也不核验认证主体**。biz/fakeid/mp_id须按命名空间和版本映射，不机械等同。任务run和新增订阅有同步副作用，不能自动执行。
2. `notice_digest`主要消费WeRSS本地SQLite，处理排序/日报；时间/ICS源自通知侧功能。旧PKUKnow采集不是当前主通道。作者132号/607新增/4341总文章是历史运行记录，不能算CampusOS成功或公众号权限。

本轮没有启动WeRSS、使用账号/CDP/SMTP或在线微信请求，七层实时验证均未通过实测门槛。只读格式适配可以研究，不能以此开放后台公网接口。

## 2. 值得移植与必须重写

| 能力/模块          | 可借鉴部分                                          | 必须先处理                                                                           | 优先级                     |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| timeparse.py       | 全角/中文日期词法、候选扫描、有界输入、失败保留     | 截止/举办分离、可信相对锚点、缺年/时段推断标志、非法日期阻断、多活动、精度与原文证据 | P0，独立TS规则，不原样移植 |
| render.py ICS      | 文本转义、UTF-8字节折行、Asia/Shanghai、稳定UID思路 | 只导出当前已批准活动；date/exact判别、单项更新字段、取消语义、CRLF/URL安全与结束日   | P0                         |
| gzh_source.py 去重 | 同URL发现可关联、只读SQLite思路                     | 不按标题合并不同年份/来源；不丢出处；字符串时间NameError、缺库空数组、全表扫描不照搬 | P0规范事件/文章身份        |
| score.py           | 确定性特征贡献、稳定并列、可解释理由、权重有界      | 固定7类映射、避免AI子串误匹配、先验也设上限；学习delta覆盖先验缺陷                   | P1先确定性，学习后置       |
| feedback.py        | 单项+操作签名和去重思路                             | 真实学生身份/租户、过期/撤销、GET写副作用、转发/预取、同意与清理；日历下载不算点赞   | P2                         |
| mailer.py/日报     | 分离渲染/投递、失败可见                             | 订阅同意/退订、配额/反滥用、收件人隐私、外部效果幂等与运行载体/预算                  | 比赛后                     |

### 已复现，不能带进生产的语义

- 日期型报名截止同时成为start并生成日历；活动区间end反写成deadline；正常提前报名截止反被structured分支丢弃。
- 相对日期实际调用链用执行now代替原文发布日期；“今晚”推成19:00且无推断标记；缺年滚动到下一年不标明。
- 非法2月30日退化为执行月30日；日期/星期矛盾未阻断；一文两场只返回首场。
- 取消/改期的ICS仍固定CONFIRMED；单项导出无SEQUENCE/LAST-MODIFIED，批量路径支持调用者传值但不是自带版本管理。
- 同URL/标题去重丢多个发现出处；部分失败变空结果。反馈学习覆盖先验、签名过期路径不一致，不能作为多人学生偏好闭环。

上述均为固定版本合成结果，不是对真实校园通知准确率的测量。81项上游测试通过不解除这些问题。

## 3. 时间DTO草案，沿用S3-0语义

```ts
type TimeEvidenceCandidate = {
  documentId: string;
  snapshotVersion: number;
  contentRevision: number;
  inputHash: string;
  eventOrdinal: number;
  field: "starts" | "ends" | "registration_deadline";
  rawText: string;
  startOffset: number;
  endOffset: number;
  offsetUnit: "utf16_code_unit";
  date: string | null;
  time: string | null;
  timezone: "Asia/Shanghai";
  precision: "date" | "exact_time" | "period" | "unknown";
  inferred: boolean;
  inferenceReason: string | null;
  anchor: { publishedAt: string; evidenceRef: string } | null;
  confidence: number;
  verificationStatus: "pending";
};
```

这是设计，不是已新增Schema/API。Python的字符偏移与TS UTF-16 code unit不同，交换时显式转换并逐段验证rawText==原文slice，不直接复制上游重拼evidence。原文版本与权利有效才可解析/公开。

规则：发布日期不当活动日期；举办和报名字段分别提取；只有日期就time=NULL，不补00:00或23:59；缺年/相对时间必须有可信锚点、保留推断，否则unknown；非法日期/冲突入待核；开始/结束独立，结束未知不猜。每篇可有多场，所有解析结果pending，由确定性证据规则/人工审核决定事实核验，模型不可自设verified。

### 当前CampusOS真实缺口

- `EventCandidateSchema`的startsAt/endsAt/registrationDeadline仅接受精确datetime，日期型时间当前丢成NULL；需兼容扩展date/time/precision列与表单，不能用午夜占位绕过。
- `extraction_evidence`当前有raw_span与版本FK，但没有上述offset列；未来增量评审，旧证据保持未知，不回填伪偏移。
- 现有`originalDate`对“日HH:mm”缺空格返回未知，本轮10项严格诊断8通过、2失败，保留原断言；[严格失败与结果](../verification/s3-wechat-resumed/campus-offline.json)。未为研究任务改解析算法。
- `event_sources`支持多文支持同一事件，但目前只有event/document FK，缺内容修订/证据版本绑定；`document_origins`按source+URL唯一，不能一行保留所有发现器/栏目。需扩展受控出处观察及版本关系，不能新建第二套文章库、伪造sourceId或自动合并同标题。

## 4. 规范事件与最新状态

先文章身份（publisher namespace+验证URL/完整文章元组），再事件身份（已核验组织、名称、举办场次/时间、原文关联）。相同标题只作候选匹配，多渠道需保留event_sources及各证据版本；跨年、跨校区、不同组织不自动合并。新通知取消/改期须比对原活动并审核，不用最新抓取时间直接覆盖旧事实。

后续保留稳定event_id并递增业务版本，取消/改期/文章撤回同时更新公开门禁、关联证据及既有outbox，防止旧索引/地图/日历继续宣传。时间无法确定的通知可留待审/文本卡片，不生成可参加活动、地图点或正式日历。

## 5. 匿名ICS验收契约

只从真实当前已批准/发布、来源许可和生命周期有效且时间核验的事件生成，不依赖学生登录、不写user_schedules。不存在、未审、失效或无可靠举办时间时准确拒绝。报名截止不能独立变成举办日历。

- exact_time显式Asia/Shanghai或正确UTC序列化；date用VALUE=DATE。DTEND是非包含边界，源文“至某日”是否含末日需核验，未知结束不擅自补时长。
- UID由稳定event_id派生；可信事件版本写SEQUENCE，更新写DTSTAMP/LAST-MODIFIED；取消用规范状态/更新策略并单独测试。日期改期不生成新UID或丢原来源URL。
- 标题/地点/说明转义CR/LF、分号/逗号/反斜线，URL固定安全协议且无控制字符，按UTF-8字节折行；不让内容注入额外VEVENT或任意属性。
- 下载静态ICS不能保证已导入手机自动更新/撤销。下载、重新导入和未来订阅是不同能力，需Android/iOS日历客户端独立验收；不能宣传导出等于已保存个人日程。

依据：[RFC5545](https://www.rfc-editor.org/rfc/rfc5545.html)关于内容行、VEVENT/UID/SEQUENCE的定义；取消更新还需[RFC5546](https://www.rfc-editor.org/rfc/rfc5546.html)。本轮只审规范/源码与离线格式，不做真实日历客户端验收。

## 6. 排序与后置功能

P0先完成真实公开内容、时间精度、去重/最新状态和ICS，P1再加最新发布/即将举办/报名将截止、来源/主题相关性及简短可解释贡献。所有排序先过滤不可公开/已取消失效内容，并提供全量时间排序；重要公告不因推荐子集被隐藏。

固定雷达7类：讲座、文体活动、竞赛、升学就业、学术科研、奖助机会、校园公告；不搬上游13类。初版可只做页面内显式选择，不形成长期画像；不调用付费模型做推荐。用户反馈学习、邮件日报、主动推送与个性化订阅延至S4/S5真实身份/隐私或比赛后独立预算/运行载体批准。

Cloudflare只承接经实测的轻量业务查询；中文解析/批处理默认受控本地runner，Python/SMTP/systemd不进用户HTTP。工作量与停点见[实施建议](S3_SOURCE_PIPELINE_RECOMMENDATION.md)。
