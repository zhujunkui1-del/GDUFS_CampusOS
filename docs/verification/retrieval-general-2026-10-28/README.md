# 通用检索真实验收回执

完整说明：[查询链路与验收报告](../../RETRIEVAL_SYSTEM_ACCEPTANCE_2026_10_28.md)。整体仍是部分通过，不能视为完整Agent可靠性验收。

- `summary.json`：实际代码、部署版本与数据范围。最后主Preview只补回答目的/归属处理，检索矩阵、桌面、手机和单轮各自记录真实版本。
- `isolated-before.json`、`isolated-after.json`：22题隔离标注集；不是全库准确率。
- `api-before.json`、`api-after.json`、`api-performance.json`：相同20题真实Preview检索。正文不重复发布，保留原来源、证据哈希及实际D1计量。
- `agent-before.json`、`desktop.json`、`mobile.json`、`guide-final.json`：真实工具、来源和回答模式。桌面浏览器断言通过；手机小红书断言失败；最后指南单轮保留入口、2027届和效力未知标记。
- `answer-modes.json`：本组7轮6次原文摘录、1次归属摘录。模式不是普通模型生成成功。
- `guide-scope-failure.json`、`intermediate-failures.json`：真实失败和人工复查发现的检查器漏判。
- `semantic-probe.json`：8组隔离证据对使用真实Step模型的结果，与真实校园问答分开。
- `judge-adapter.json`：同运行时客户端的HTTP200/length/空正文失败，不把HTTP成功当核对成功。
- `xiaohongshu-status.json`：身份成功、搜索仍要求验证，0笔记/0正文，停止重试。
- `capabilities.json`：原运维验证器真实续检；无API Key、登录状态或密文。
- `cpu.json`、`validation.json`、`changed-files.txt`：捕获子集、660项测试中的12项旧失败、文件清单。

截图只覆盖相应浏览器测试最后一轮。完整受控响应留本机忽略目录，没有作为运行时索引或小红书结果使用；公开交付不含Cookie、密钥、临时签名或整篇文章HTML。代码回退见主报告，未增加后台回退按钮。
