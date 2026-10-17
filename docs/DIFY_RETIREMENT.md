# Dify技术路线废弃｜审计与变更记录

2026-10-17（Asia/Shanghai）。基线e30a939，依据负责人最新决定D-045。本轮仅调整架构/文档并验证工程，不实现完整S3-D或继续微信联合研究。

## 1. 断点恢复

开始时Git为e30a939，.gitignore有既有thu-push-main忽略规则；两份公众号研究草稿、三份上游证据JSON、一个只读D1快照和两个研究脚本未提交。保留有效成果，标注未完成/未验收，修正不存在的完成报告链接。[中断清单](research/s3-wechat/README.md)列明缺项，不把保存断点记为联合研究已完成。

中断前云端快照保留原时间，不伪称本轮再次查询：220来源/3启用/3核验，3篇全待审/0发布，4任务/1重复/0错误，53表/外键0错误，Worker版本21a72753-f951-4b91-9549-1390a2c7e49f。本轮不写D1、更新部署或重采。

## 2. 真实审计结果

| 范围                                  | 结果与处理                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| src API/服务端/类型/Agent             | 无Dify客户端、适配器、Dataset检索或学校内网端点，无须删除不存在的代码            |
| KnowledgeRetriever/D1KeywordRetriever | 仅设计契约，无运行实现；保留平台无关接口，正式路线为自研D1，不宣称已上线         |
| package.json/lock                     | 无Dify依赖，无卸载/lock重写或替换商业平台                                        |
| 环境模板/Next/OpenNext/Wrangler       | 无Dify地址、Dataset、Key或Binding要求；不改配置/Secret，不读取或撤销学校账号凭据 |
| 测试/脚本                             | 无Dify调用测试；S3-B报告脚本仅有历史研究路径与0调用统计，保留原证据生成器        |
| 生效架构/计划/阻塞                    | 移除可选适配和未来任务，关闭其授权/网络/Key/费用依赖                             |
| 历史报告/决策/JSON                    | 加废弃说明，保留原事实、日期及原始JSON/Git，不改写历史验收结果                   |
| D1/地图/会话                          | 无Dify迁移或业务依赖，不改表/版本/审核/outbox/来源/地图/Agent                    |

[离线审计](verification/dify-retirement/audit.json)扫描源码/配置及锁文件依赖名，检查12项验收、7/6分类、文档链接与src/public/migrations零改动。modify及包integrity偶然包含字母片段不算依赖。

## 3. 受影响文件组

- 根/v2 AGENTS、v2索引/产品规格：D-045工程入口及自研路线。
- README、docs/ARCHITECTURE.md：真实当前阶段、技术栈和检索未实现边界。
- S3_0_ARCHITECTURE_BASELINE、S3_0_DATA_MODEL：移除可选适配/外部Dataset映射与接入待办；保留自研接口和实体/FK/outbox。
- v2 04/08/09：D1关键词/分类/分段、TS规则提取；向量另批，S3-D知识Skill与S3-E系统回归分工。
- [S3_D_RETRIEVAL_PLAN](S3_D_RETRIEVAL_PLAN.md)：12项未来验收，含真实语料、中文召回、证据/学年/时效、权限/失效、Agent与Free性能。
- DECISIONS/PROGRESS/BLOCKERS/DATA_SOURCES：新决策、实际状态及历史标记，Dify不再是阻塞。
- S3-B验收/兼容、旧产品/Dify研究、学校UI核查：添加废弃说明，原始内容保留。
- tests/integration/verify-dify-retirement.mjs：离线文档/架构检查，无服务调用。
- 上轮研究资料及.gitignore：保存断点和负责人原有忽略规则，未完成研究不虚报通过。

## 4. 检查和交付边界

TypeScript、Lint、283单元（37文件）、Next生产构建、OpenNext安全构建与显式preview Wrangler dry-run通过。包装器净化后扫描1350产物文件，私密值0命中；gzip2505.00KiB。dry-run不是公开部署，也不证明Free CPU容量通过。[实际检查](verification/dify-retirement/checks.json)

当前任务模型/学校接口/公众号文章请求0，无D1迁移/写入、Secret更新、生产DNS、资源或套餐变更。既有Free稳定容量、真实手机、知识语料许可/审核及中文检索质量仍待各自验收。Dify不再列为依赖，本轮不声称RAG已上线。完成后停止。

Chrome与Edge本地Shell基础回归各8项通过，覆盖桌面/手机视口、AI入口/空态、路由、匿名权限与无障碍；使用现有测试夹具，不是本轮真实DeepSeek或手机实机验收。截图和详细输出保存在忽略的test-results/dify-retirement，归档仅保留脱敏汇总。
