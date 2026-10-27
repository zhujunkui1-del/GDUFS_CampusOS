# Preview redbook 接线与新账号验收｜2026-10-27

当前状态：新后端已接入原Agent；负责人在独立Edge完成新账号授权后，加密同步到新的私有R2对象。真实公网聊天取得3条笔记、其中2条正文，回答实际引用1条小红书原文；后台显示已登录。主账号不再被新网关选择，旧Browser Run自动恢复/Live View路径关闭。没有后台后端选择器或回退按钮。

该结果只证明本次真实检索、正文与引用链路通过，不证明永久登录、500人容量或全部回答事实准确。当前人工复核仍发现模型将单个作者的偏好概括为“受学生欢迎”；已加逐作者/逐证据约束，但提示词不能替代逐主张核对，不把回答质量记为完整通过。后台二维码换号流程尚未适配新后端；当前换号需独立Edge授权及受控同步。

## 实际部署与恢复

| 服务                            | 当前100%版本                         |
| ------------------------------- | ------------------------------------ |
| CampusOS Preview                | a7061172-53c6-44bd-af81-9bb4dadecc23 |
| 搜索网关                        | 46bb00b8-0118-4fc8-ae09-4c494bb629c8 |
| redbook服务（保留eval历史名称） | a39a0052-5a0d-4bad-89b5-b436469a2f0c |

before-deployments.json与release.json保留前后版本。此次无D1迁移，不改Production，不新增付费服务或套餐，不修改采集器/文章/地图架构。普通联网仍是原SearchContainer；最终真实聊天exa_web_cloud也返回2条，早期另有HTTP失败，不能承诺长期可用。

版本回退通过Wrangler版本部署完成，不提供后台按钮。主Worker可回至本轮前版本，例如：

```powershell
npx wrangler versions deploy c3e98a5e-c811-453b-8690-59a2994c8c68@100% --config wrangler.jsonc --env preview --yes
```

切换前的搜索网关版本38aaaea9-707d-4da2-92ad-ce1075ba053e仍保留，但会恢复旧Browser Run路径。主账号已被负责人明确停用，本轮不对该旧路径进行原生搜索或公网回退演练；需要保留新账号隔离时不能直接启用旧主账号恢复逻辑。没有声称回退演练通过。

## 新账号的真实流程

1. 用户手动打开全新目录services/external-search/runtime/xiaohongshu-browser-profile-next-account，仅在该窗口登录新账号。
2. 关闭该窗口后，执行prepare-redbook-session.mjs --next-account --capture-only；只读取该目录，源站user/me确认非游客才保存必要Cookie，主账号目录不读取。
3. sync-redbook-session.mjs --next-account调用私有导入接口；云端再次确认非游客后才加密保存，不接受失败会话覆盖。脚本拒绝缺少显式新账号参数的调用。
4. 先停止云端容器，再从实际Preview页面提问；首次新账号Edge聊天及后台2项通过，规则收紧部署后实际聊天再通过1项，没有批量搜索。

当前只有新授权的活动对象被选择。旧主账号快照不由新服务自动恢复；没有自动解验证、代理切换或反复登录重试。访问密钥、Cookie、R2密钥及完整临时响应均留忽略目录，不放镜像、公共页面或Git。

## 真实结果与资源

最终问题为“广外南校一饭有什么好吃的？简短说两条，根据实际搜到的学生体验回答并注明来源。”真实工具顺序为search_campus_knowledge → search_external_campus_info；新Provider状态ok、3条，其中2条page_excerpt及1条title_only。前台实际引用笔记《广外 |世界上最爱吃鸡丝凉面的人出现了🍜》，真实笔记ID为6aae9346000000002a02e1f5；完整可打开原文在next-account/rendered-citations.json。未把第三条标题当正文，未新增公共文章。

最终Step模型3次请求，6380输入/677输出token，整轮10925ms。外部Skill耗时3199ms，native Provider3009ms；外部路径D1读取0/写入0。主对话记录D1读取299/写入15，但rowUsageComplete=false，不能当完整精确账单。类型检查误扫描新浏览器扩展TS，已将私有runtime目录排除，正常项目源码仍检查；Lint排除本地生成诊断包，不忽略业务代码。

本次45秒脱敏tail窗口没有捕获完成后的chat/search事件；main-cpu.json的其他请求不能算本轮问答CPU。当前问答CPU、容器CPU、完整账单与日容量未取得，不用旧4ms隔离样本代替。收集器只保存路径/数值，不保存Cookie、原始日志或正文。

## 工程验证及失败保留

- 相关4文件21项测试通过；全仓543项529通过，14个与既有清单一致的失败，新失败0。
- typecheck、目标ESLint、Next/OpenNext构建及真实Preview部署通过。
- 全仓Lint仍是原备份1个未使用导入warning、旧公众号CJS文件3个require错误。
- 新账号真实Edge：聊天与后台2项通过；最终提示约束部署后聊天1项通过。没有冒充真实手机、并发或24小时验收。
- previous-account-agent-failure.json保留主账号阶段native unavailable、前台无小红书来源的失败；account-paused.json记录停止调用；next-account/first-grounding-defect.json保留第一轮观点夸大问题。公开JSON将长摘录和完整模型输出改为哈希/长度，原始临时响应只在忽略目录复核，运行时不读取验收文件作为搜索结果。

主要文件：services/cloud-search/redbook.mjs、worker.mjs及配置；services/xhs-redbook-eval/worker.mjs和server.mjs；scripts/evaluate-redbook.mjs、prepare-redbook-session.mjs、sync-redbook-session.mjs；原assistant/chat.ts的一处证据约束；相应单元与真实E2E。所有工作沿用原Agent、Skill、普通网页搜索和公开权限。
