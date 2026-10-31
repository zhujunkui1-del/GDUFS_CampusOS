# S4 普通用户账号验收（2026-11-01）

**后续变更D-127：**本报告记录初版验收；负责人随后决定密码只按长度校验，常见/重复/泄露库拦截及HIBP依赖已移除。下文相关初版行为和故障记录仅为历史，现状以D-127及PROGRESS最新回执为准。

**后续变更D-128：**账号分层界面、无密码及冷却的改名、邮箱先验证再注册、验证码解绑已经替换初版流程，见[当前界面与邮箱流程回执](S4_ACCOUNT_SETTINGS_2026_11_01.md)。

Preview：https://campusos-preview.zhujunkui1.workers.dev/account 。部署版本 `2fa793c5-cd37-41a2-b8cb-c11645482979`；代码 `751777a`（账号基础）、`3713e7a`（公网联调及启用）。只改Preview，没有部署Production或购买服务。

## 产品契约与架构

用户名、密码必填，邮箱可选。用户名3–24位ASCII字母/数字/下划线，忽略大小写并在D1唯一约束；禁止保留名。密码8–256字符、常见密码及HIBP已知泄露检查，PBKDF2-HMAC-SHA256/600000、独立128位盐、256位派生值和版本。Workers原生PBKDF2上限触发时，用@noble/hashes同成本实现，没有降低迭代次数。

验证邮箱和用户名指向同一用户ID；待验证邮箱不能登录和找回。腾讯云SES、**6位邮箱验证码**，保留前导零；10分钟、最多5次尝试、一次性事务消费。服务端Secret作HMAC，绑定用途和随机挑战；D1不存明文码，HTTP不返回验证码。更换邮箱先验证新地址，旧邮箱此前继续有效。解绑与敏感修改需当前密码；修改密码及找回使旧会话/挑战失效。

复用users、login_sessions，0056增量增加user_password_identities、user_auth_tokens、user_auth_rate_windows、user_auth_events。旧phone身份、文章、地图、Console、历史会话不删除或重建。普通会话Cookie为campusos_session，随机256位令牌、数据库仅摘要、30天固定期限、HttpOnly/Secure/SameSite=Lax/Path=/；写入精确Origin+JSON，个人API从Cookie解析用户，不接受客户端userId。

原子D1限流覆盖注册、登录、再次验证密码、验证码发送和消费；绑定唯一性及敏感变更使用数据库唯一约束、版本CAS和事务中复核会话。Console认证不复用普通Cookie。游客已有AI历史继续由原HttpOnly游客Cookie持有，不自动认领或清空；现有48小时生命周期保持，个人长期同步未在S4实现。

按负责人2026-11-01决定，**不提供注销账号/永久删除账号功能**。保留退出登录。个人收藏、AI长期同步、模型设置等是非交互的后续说明，未冒充已实现。

## M1：迁移和基线

起点b91ca59工作区干净。实际Preview迁移从0055到0056；执行15条命令86.61ms，成功。迁移前已获取D1 Time Travel书签，保存在本机忽略目录，回退不恢复整个业务库。

基线只读计数：users/auth_identities/login_sessions分别0，assistant_sessions352、conversations370、console_admins5、console_public_documents1960。为验收创建的独立测试账号属于Preview；没有把测试文章、假活动或假知识写入业务数据。采集器正常运行导致的文章变化不归因于账号迁移。

## M2/M3：真实注册、登录和个人中心

17项公网API检查全部通过，回执见[API回执](../verification/account-2026-11-01/live-api-checks.json)。覆盖两个独立用户无邮箱注册、大小写用户名登录同UID、错误密码、唯一用户名、刷新会话、A/B资料隔离、客户端userId拒绝、改密并撤销当前旧令牌与另一设备令牌、改名同UID、退出及新密码重登。

桌面Edge1440×900和手机视口390×844真实浏览器2/2通过（45.9秒）。每端实际执行注册→个人中心→刷新保持→界面改名→界面改密→第二标签页→退出跨标签同步→新凭据登录→日历/雷达/知识/地图→返回账号→退出。未Mock认证/API/数据库。截图：

- [桌面注册](../verification/account-2026-11-01/desktop-register.png)、[桌面个人中心](../verification/account-2026-11-01/desktop-profile.png)。
- [手机注册](../verification/account-2026-11-01/mobile-register.png)、[手机个人中心](../verification/account-2026-11-01/mobile-profile.png)。

截图仅含隔离测试用户名和空密码输入，无真实密码或验证码。另10项发布后公网回归通过，包含普通账号不能进Console（401）、跨站退出拒绝（403）、拒绝8位码（400）和无效6位挑战（403）、跨用户查询参数拒绝（400），见[发布回执](../verification/account-2026-11-01/live-release-checks.json)。

## M4：腾讯云SES真实邮件

负责人指定的SES ap-hongkong、已启用发件域mail.zhiyuapp.site；腾讯云实际API确认域名可发信，批准的验证码模板228818和安全通知模板228817。验证码HTML和纯文本均含同一code变量，安全通知使用独立模板event变量。SPF DNS查询返回include:qcloudmail.com。凭据和OTP主密钥仅Cloudflare Secrets；已删除此前未使用的Resend Secret。

使用负责人授权QQ收件地址，**负责人本人在真实Edge页面输入6位码**，代理未要求在聊天提供验证码。真实流程通过：绑定发码→QQ收件并验证→邮箱密码登录同UID→忘记密码发码→QQ收件并重置→新密码邮箱登录。最后已解绑该邮箱，当前账号API复核email和pendingEmail均null，避免占用负责人的正式账号。

见[邮件流程回执](../verification/account-2026-11-01/real-mail-checks.json)和[解绑复核](../verification/account-2026-11-01/mailbox-release-check.json)。没有读取私人收件箱或密码，不把Provider接受发送当成真实收件；QQ收件依据为负责人实际完成验证码流程。163、Outlook及学校邮箱尚无获授权的真实收件人，未声称通过这些收件测试。域名可发信不等同保证所有邮箱都收件，也未把SES每日500配额当成免费余额。

## M5/M6：安全、回归与性能

全量**823/823**（115文件、34.83秒）通过。S4新增29项，涵盖并发同名注册无孤立users、并发邮箱唯一竞争、跨用户码消费拒绝、5次猜测锁定/过期/重放、并发密码重置仅成功一次、旧会话及旧密码撤销、待验证邮箱不能找回、换绑/解绑后登录规则、Origin/DTO/Cookie/Console隔离、游客历史保留、Workers原生KDF限制同成本回退、SES模板隔离、6位/前导零/8位拒绝、重定向拒绝与计量脱敏。隔离测试使用专用SQLite及内存邮件器，未向公开代码提供测试后门。

TypeScript、改动文件ESLint、生产构建和Preview部署通过；不把仓库历史生成文件/CJS全量lint问题写成已修复。

实际D1 EXPLAIN使用username_norm唯一索引、verified_email唯一索引和login_sessions主键，见[查询计划](../verification/account-2026-11-01/query-plans.json)。请求计量来自D1返回的meta，不是估算；CPU/Wall来自Cloudflare Tail，不使用Workers可能冻结的Date.now作为哈希耗时。

| 成功请求样本 | 样本数 | CPU ms范围 | Worker Wall ms范围 | Rows read | Rows written |
|---|---:|---:|---:|---:|---:|
| 登录 | 4 | 1433–1945 | 1973–2555 | 8–10 | 16–18 |
| 修改密码（校验旧密码+派生新密码） | 3 | 2856–4473 | 3437–5086 | 19 | 12 |
| 会话查询（含游客） | 17 | 0–4 | 0–103 | 0–3 | 0 |
| 退出登录 | 1 | 2 | 96 | 3 | 5 |

详见[脱敏运行计量](../verification/account-2026-11-01/runtime-metrics.json)。原生上限下实际使用noble同成本PBKDF2；密码操作CPU明显高于资料读取，不能宣称免费Workers10ms预算可运行。测试依赖已有Preview资源，没有升级套餐。初次API注册客户端耗时3060/4627ms，首次捕获未取得注册请求D1/CPU完整样本，未用登录数据冒充。未做500用户负载验收或月费推算。

## 失败记录和修复

1. 首次公网注册503：Workers不实现redirect:error，构造fetch即抛TypeError。改为manual并拒绝非2xx重定向，密码检查与SES均修复；没有跳过泄露密码检查。依据[Cloudflare Request文档](https://developers.cloudflare.com/workers/runtime-apis/request/)。
2. 初次全量2项旧测试假设登录必须切走游客历史；将“保留原游客历史”与“新用户私人对话隔离”分别测试，保留原隔离断言；最终全量通过。
3. 邮件辅助脚本首次等待了错误的aria名称，第二次用真实表单名继续。验证码真实流程通过；解绑服务端成功但表单消失连带成功提示消失，已将成功提示移到持久区域，后台API再次确认邮箱已解除。
4. 中间手机截图写入既有PNG出现Windows UNKNOWN文件错误；换新日期证据目录后真实桌面/手机完整重跑2/2通过，没有放宽业务断言。

## 文件与回退

核心新增src/domain/account/contracts.ts、src/lib/server/account/{api,store,password,security,otp,email,tencent-ses,metrics}.ts、src/features/account/*、/account/login/register/forgot-password及/api/auth/*，增量迁移0056。复用/调整/api/me、campus-shell、AssistantStore、useAssistant、Preview dispatcher和调度器。单元测试位于tests/unit/account-*.test.ts，真实E2E为tests/e2e/account-preview.spec.ts；运行须显式S4_LIVE=1和准确Preview地址，关闭Trace/Video以免留下凭据。

代码级回退可对3713e7a、751777a按逆序git revert，检查工作区并提交后仅运行Preview部署；或部署已验收的S4前Worker版本4384fa87-f134-4afb-ae69-1116a10eedde。**保留0056及新账号数据，不DROP表、不重建D1、不恢复全库**。旧代码不引用新增表；Secrets保留在服务端。没有后台回退按钮。

剩余限制：没有注销账号功能（负责人决定）；个人收藏/长期AI同步/BYOK未在本轮实现；163/Outlook收件尚未实测；供应商故障时邮件不假成功，HIBP不可用时新注册/改密暂不可用而现有密码登录及公共校园服务继续；账号数据跨设备与旧游客历史保持独立，不能声称已完成个人AI云同步。
