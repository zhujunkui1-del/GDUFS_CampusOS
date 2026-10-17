# 四项目研究中断现场

2026-10-17。上轮因执行额度中断，Git基线e30a939。负责人本轮将范围收敛为Dify技术路线废弃，**不继续四项目联合研究或采集**。本目录与两个草稿只用于保存断点，不作为完成交付。

- 已留下：AB GitHub元数据、thu仓库元数据、WeRSS/helper证据JSON；两个未定稿文件为上级S3_WECHAT_POC_PLAN.md、S3_SOURCE_PIPELINE_RECOMMENDATION.md。
- 未留下完成报告：S3_WECHAT_OPEN_SOURCE_COMPARISON.md、S3_THU_PUSH_ADAPTATION.md；20项完整矩阵、所有本机PoC和最终推荐尚未验收。不得将草稿中的“见报告/测试”当为已经存在且通过。
- 中断前只读云端快照位于 [campus-baseline.json](../../verification/s3-wechat/campus-baseline.json)：220来源/3启用/3核验、3文档全待审、0发布、4任务/1重复/0错误、53表、外键0错误。原快照日期保留，本轮技术调整不重采或写库。
- `tests/research/audit-campus-baseline.mjs`为已有只读审计脚本，执行需显式远程预览参数；`thu_algorithms_probe.py`为未验收的离线研究脚本，未找到对应完成结果，不宣称执行成功。本轮不运行这两个脚本。
- 四个原包位于负责人提供的v2目录，均只读；现有`.gitignore`新增thu-push-main规则原样保留，避免第三方整包进入仓库/public。

历史Dify候选内容按D-045作废，已批准的新路线以 [自研检索计划](../../S3_D_RETRIEVAL_PLAN.md)为准。后续恢复四项目研究需要负责人确认实施范围。
