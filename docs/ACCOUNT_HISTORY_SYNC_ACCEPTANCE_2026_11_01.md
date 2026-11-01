# S4 登录用户 AI 历史持久化与同步

开始于2026-11-01，交付于2026-11-02；原始回执保留实际UTC时间。

本轮以本地a249376为起点；原工作区另有楼栋模型未提交修改，使用同仓库的隔离工作树实施，没有以远端旧文件覆盖S4、修改负责人账号或将楼栋改动带入Preview。只使用两个无邮箱独立测试账号；不发送SES邮件、不新增供应商、不部署Production。

## 身份与保留

- AssistantStore复用AccountStore.resolve，校验S4会话、凭据版本、用户状态及普通用户角色。已登录固定归属u:userId，不再被游客Cookie抢先识别；Console凭据不授予私人会话权限。
- 游客Cookie仍只代表自己的g:作用域。登录不合并、转移、删除或认领游客历史；退出后可恢复仍在原生命周期内的本人游客历史。
- 0058增加conversations.retention及消息sequence，已归属本人账号的有效会话设为account、expires_at_ms=NULL；游客继续48小时。新增账号消息不因登录Cookie到期、消息数或不访问被删除。主动删除仍沿用内容清理和短期墓碑。
- account请求台账保留以支持长期幂等；消息ID绑定会话、请求及角色。首条请求的新会话ID按服务端账号作用域和请求ID确定，避免不同用户相同clientRequestId互相冲突。已有消息/会话ID不改写，旧请求消息ID兼容读取。
- 同一已完成请求重放只返回已保存的消息及卡片，不重新执行模型或地图动作；处理中不重复接受。历史恢复不会自动领取旧MapAction，过期路线仍需重新规划。

## 查询与界面

复用原/api/agent/session、/conversations、/conversations/:id、/chat、删除、取消和地图接口。消息每页40条，使用稳定sequence的before/after游标，SQL最多41行；会话列表沿用最近活动时间+ID游标及20条分页。

新客户端使用Conversation-Protocol 2，获得消息sequence、olderCursor、latestSequence和增量状态；旧客户端保持原字段形状。完整文本和来源卡片存D1，模型上下文读取与UI分页分离，保持原有模型工作窗口，不把全部历史每轮发送给模型。

面板向上加载旧消息时保存滚动锚点；焦点恢复、重新打开及登录用户可见面板15秒增量获取。代次与取消信号阻止迟到响应跨身份/会话写入UI；网络丢失响应后仅回读已提交数据。SessionStorage只记录作用域内的当前会话选择，不保存聊天数据库、密码或Token。

## 同轮注释

移除地图搜索面板的高德在线查询入口及对应错误，输入清空/仅空格/空值提交时收起结果。导航容器不再拦截底下地图事件，桌面拖动/滚轮及手机视口双指缩放实测。按负责人后续撤回意见，两个OSM版权及原跳转链接保持原样。

网站助理取消6次模型请求、12次工具调用和4096累计输出Token硬阈值，正常生成长度交供应商默认；诊断及后台分析的预算不受影响。保留取消、运行时限及供应商实际限制，首选Step、明确额度用完才切DeepSeek。助理上游等待由15秒延长到60秒，诊断不变。真实地图回归复现Step连续三次plan_route参数校验失败，现对已唯一解析的校园起终点提供精确参数Schema，不改Skill名称、地图算法、Persona或捏造地点。

额度错误分开说明：本时段AI额度用完、全站额度用完、网络请求频繁、上一条仍处理中不再混用一句提示。Preview当前开放验证模式仍启用，因此小时/日配额未开启。

## 迁移及性能

迁移前只读聚合为86个会话、290条消息，其中账号归属会话0；旧聊天仍在游客域，不擅自转成账号历史。已保存Time Travel bookmark，0058/0059只在Preview增量应用，无重建、全库导出或消息删除。

0059为长期账号数据下的运行状态/租约、主体并发及删除墓碑清理增加索引；游客与墓碑清理分开，不扫描长期账号历史。真实D1 EXPLAIN四项均SEARCH指定索引，见verification/account-history-2026-11-01/query-plans.json。

最终测试、部署版本和资源数据见同目录原始JSON及PROGRESS。真实模型/检索行计量沿用现有metrics；rowUsageComplete=false时不当完整账单。未采集Worker CPU，不填估计值。

## 失败与边界

曾有一条借阅规则问答被证据门禁拒绝；未放宽事实校验或把该答复记为成功。真实验收中也复现15秒上游超时及地图参数校验失败，分别修复等待期限与唯一地点的参数约束，失败日志保留。测试脚本曾因退出请求漏发JSON得到400，修正脚本后再验收；没有放松退出接口。并行全量测试曾出现原Console定时时序CONFLICT，未改Console代码/断言，单独记录复验结果。

重复验收还曾触发测试账号既有登录限流429；没有重置、关闭或绕过限流，等待实际冷却结束后完成完整脚本。

跨浏览器使用真实Windows Edge/Chrome及独立登录Cookie；手机为Chrome手机视口，不冒充实体手机或真实GPS验收。35天登录过期与长期保留使用隔离SQLite时钟验证，未声称实际等待35天。已按原生命周期清理或曾被主动删除的数据不能凭新代码恢复；旧游客数据不自动归入登录账号。

## 最终回执

- 全量859/859，124测试文件，127.93秒；代码ESLint无警告、类型检查及OpenNext构建通过。另有18项桌面/手机会话界面回归通过，33.2秒；4项Preview搜索/导航回归通过，13.4秒，覆盖实际标记位移、滚轮及CDP双指缩放。
- 综合真实验收在冷却后1/1通过（Playwright输出2.0分钟）：A账号3组多轮会话，106条历史逐页恢复且106个唯一消息ID；Edge→Chrome→手机视口、继续提问及反向获取、刷新、退出重登、游客未合并、B读取/删除返回404、重复请求回放、丢响应回放及并发已确认消息保存通过。并发样本两条均200，各保存一组消息，无丢失或重复。
- 两个域名各独立登录同一测试账号后均返回200及同样的3个会话ID。来源卡片实际打开原文；Agent实际执行知识检索、官方补查、plan_route/control_map，前台执行SHOW_ROUTE并收到运行完成。
- 长会话压力轮次使用现有确定性问候/致谢回复，不将这些轮次冒充上游大模型调用。最终真实检索样本2次模型请求、9,264 Token、26,449ms；路线3次、7,409 Token、16,294ms，模型均为step-3.5-flash-2603。
- 上述检索已观测D1 rowsRead=58,484、rowsWritten=19；路线71/27，均rowUsageComplete=false，不是整轮完整账单。Worker CPU未采集，未推算费用或500人容量。
- 隔离Mock测试验证8轮模型、14次工具及声明的8,000输出Token不被旧单题上限拒绝；10,000字符保存/UI协议与8,000字符模型投影、下一轮输入校验分离验证通过。这些是测试夹具，不是假称公网模型生成了一万字。
- 最终Preview版本：21273ec9-d5fa-47a3-9ab1-30bdf28471e6。地址为https://campusos-preview.zhujunkui1.workers.dev/；gdufs.ccwu.cc绑定同一Preview Worker，未改Production。

截图及原始JSON见verification/account-history-2026-11-01/，核心回执为sync.json、query-plans.json及account-map-route.png。成功与失败不混记；未进行实体手机、多地区或大规模并发压测。

## 文件范围

数据及接口：assistant/store.ts、api.ts、chat.ts、routes.ts、domain/agent/assistant-contracts.ts、conversation-key.ts及0058/0059迁移。复用AccountStore、login_sessions、D1和原会话/消息/运行表，无第二套聊天数据库。

客户端：use-assistant.ts、assistant-panel.tsx；地图只改map-workspace.tsx及campus-map.css。模型/编排只在原orchestrator、model-run、models/runtime/router/deepseek内调整完成策略、等待与精确路线参数提示，模型路由优先级及Persona模块未替换。新增专项单测/真实E2E并更新旧夹具适配新的S4身份及分页协议。

## 回退

本轮代码可git revert后仅重新部署Preview；保留0058/0059新增结构及账号历史，不DROP表、不恢复整库来回退代码。旧版服务不支持本轮账号长期历史及分页，回退后新历史可能暂不可见，应恢复新版读取；不得因旧版不可见清空记录。不新增后台版本回退按钮。
