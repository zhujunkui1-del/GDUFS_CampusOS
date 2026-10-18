# Console V2 同步调度

A Cron：轻量登记/预算/租约可在电脑关闭时执行；不是HTML采集完成。B本地runner：复用安全DNS/IP固定、robots、10秒请求间隔、512KiB、检查点/条件请求与错误暂停，电脑离线不能执行。C混合为本轮默认：只在现有Worker增加经验证轻量scheduled，重解析仍本地。无新Worker/Queues/R2/付费。

D1保存1/3/6/12/24小时（默认24）、暂停、单源覆盖、next_sync_at、全局预算。保持原20网络预留/UTC日、10个web任务/日的硬上限，频率不是完成SLA；不放宽模型额度。每次调度/执行有界，互斥、去重run_key、退避、暂停即时生效，403/429/robots/登录限制不重试绕过。许可续期由管理员来源级明确批准，不每天逐篇审批。

计划创建/实际完成/runner心跳/最后成功分别记录；无常驻执行器时明确离线/排队，不能声称每24小时已更新。同步设置变更由实际调度读取，不只UI。当前未启用Cron，待阶段D实际基准与配置后更新结果。

## 实现与运行限制（最终状态）

D1配置1/3/6/12/24小时，默认24，单源覆盖优先；最长24。改变全局周期只重算5个已配置官网的相关运行时间，不扫描全部文章。到期登记每次最多2个，独占30秒调度租约，run_key去重，来源/规则/许可/fence当前复验，受20网络预留及10个web任务/UTC日限制。

403/429、robots禁止、过大正文和连续失败会暂停任务并阻断该来源自动重试；管理员重新核对策略后才恢复。全局暂停也拒绝已排队定时任务领取/迟到提交。来源暂停、失去权限或旧规则任务会隔离，不能用新身份绕过上游。last_success_at只在完整任务完成时更新。

源码提供现有preview Worker的scheduled处理器，但**本轮不启用Cron Trigger**：未取得独立scheduled调用的真实CPU余量证据，不把cron/waitUntil当CPU豁免。实际受控执行载体是本机Node runner。未安装常驻服务/Windows任务，不创建Worker、Queues或R2。

```powershell
# 默认不联网
node scripts/console-sync-runner.mjs
# 管理员先在总览高级区创建限定来源的runner凭据，私密保存到忽略目录。
node scripts/console-sync-runner.mjs --run --base https://campusos-preview.zhujunkui1.workers.dev --token-file .map-tools/console-v2/runner-token.txt
# 显式保持进程运行：每小时登记到期任务并推进最多2个任务
node scripts/console-sync-runner.mjs --run --watch --base https://campusos-preview.zhujunkui1.workers.dev --token-file .map-tools/console-v2/runner-token.txt
```

只对当前5个已批准公开官网profile工作。每次实际HTTP前复查服务端执行许可；DNS固定公网地址、HTTPS、无重定向、10秒站点间隔、512KiB、有限步骤/检查点、条件请求/hash保留。取消/暂停/凭据撤销后不再发起新请求，迟到提交仍被事务守卫拒绝。

令牌仅存hash，限定至20来源、最长30日；无SQL/审核/发布/学生数据能力。发行管理员撤销时关联令牌撤销。旧“runner自行批准元数据”参数已拒绝；一次性人工执行兼容密码派生，常规运行用受限凭据，不把服务器verifier当密码。

电脑关闭、令牌失效、许可过期、预算不足时不能保证24小时完成。当前预算不适合数百来源全量自动更新；扩容必须先增加经过许可/测试的Connector和容量基准，不能悄悄放宽资源/模型预算。

Worker CPU、D1 rows_read/rows_written和存储使用量以真实云端证据为准。未取得的内存、单接口CPU、自动发布/清理云端CPU显示未验证，不能用本地耗时替代。

## 管理交互修订

总览不展示执行器凭据、预算编辑和采集任务列表；凭据在来源同步详情中维护，任务/预算/租约/失败证据仍保留。注册状态统一enabled，管理员启用不依赖填写核验说明；scheduler与系统发布不再额外要求新的affiliation字段，既有采集许可、robots、profile、版权、全局暂停、源级停运、预算、租约和检查点照常生效。未知许可不会因一键启用被改为获准。
