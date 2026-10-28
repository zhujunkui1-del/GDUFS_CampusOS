# Agent 通用对话能力恢复（2026-10-29）

本轮是从 Codex 交接后的第一段实际开发：先核验真实工作区与基线，再定位“逢问必搜 / 无证据即拒答 / 原文摘录当正常回答”的结构性原因，最后只做一组可回滚、可测试的最小改造。**没有重写 Agent，没有新增第二套检索，没有改模型供应商、地图、采集或 Cloudflare 资源。**

## 结论

- 已实现“会话行为判定 → 是否检索 → 回答约束”的分层：闲聊、情绪、困惑、纠错和一般性问题不再默认触发校园检索。
- 证据门禁从“所有内容请求”收窄为“必须核实的校园事实”；建议类问题在无校园正文时由模型给出通用建议并明确广外具体信息的缺口。
- 严格事实路径保持不变：仍先检索、仍走证据门禁、仍不允许无依据断言。
- 真实 HTTP 入口的行为测试通过；全量单测相对基线无新增失败；类型检查、改动文件 lint、格式检查、Preview 构建均通过。
- **Preview 未部署**：本机 Wrangler 登录已过期且非交互，`CLOUDFLARE_ACCOUNT_ID` 未配置。未做真实模型质量验收，本文不声称自然度或端到端已通过。

## 环境与基线核验

| 项目 | 实际结果 |
| --- | --- |
| 工作目录 | `D:\tlydcg\Codex_work\广外AI应用大赛`，存在，Git 仓库根即此目录 |
| 分支 / HEAD | `main` / `b940762`，`git status --short` 为空，无 stash |
| 远端 | `origin` = `GDUFS_CampusOS`，`origin/main` = `b940762`，ahead/behind = 0/0 |
| HEAD 内容 | `b940762` 仅新增文档与验收回执；运行代码为上一提交 `45c0ce8`，与交接报告的 Preview 主代码版本一致 |
| 历史断点提交 | `8a44d7d`、`7346bc9`、`45c0ce8`、`b940762` 均存在 |
| 文档 | 交接清单中的设计文档、PROGRESS/DECISIONS/BLOCKERS/DATA_SOURCES、四份 Agent 报告、Persona 契约、云端搜索报告、`docs/verification/` 全部存在 |
| 本地单测基线 | 660 项：648 通过、12 失败（6 文件），与历史记录一致 |

12 项既有失败（未修改、未删除、未改成通过）：

- `article-placement.test.ts` 3 项
- `console-store.test.ts` 1 项
- `console-v2-intake.test.ts` 1 项
- `console-v2-retention.test.ts` 3 项
- `console-v2-simple-actions.test.ts` 1 项
- `ingestion-pipeline.test.ts` 3 项

## 根因（代码级）

不是召回率问题，而是**请求分类与回答契约**的问题：

1. `assistant/content-intent.ts` 旧逻辑在没有任何主题命中时，用 `externalPolicy(query).active` 兜底把请求当成内容检索。而 `external-policy.ts` 的 `active` 只排除了问候、地图和极短输入，**任何 ≥4 字符的非问候消息都会返回 true**。因此“你是一只大肥鱼”“123456789”“？？？？”都会进入内部知识检索并补外部搜索。
2. `grounding.ts` 的 `evidenceFallback` 只要没有可用正文，就返回固定拒答文案；`chat.ts` 在 `groundedReply` 中直接短路模型（0 次模型请求），所以住宿注意事项会连续得到同一句“本次没有取得足以回答问题的正文证据”。
3. `content-prompt.ts` 的最终阶段指令只允许“已返回的资料”，没有“通用建议可用常识”的许可，模型只能拒答。
4. `evidence-answer.ts` 的原文摘录（含“已找到相关原文，以下是可核对的信息……”）在模型失败或官方证据不足时被当作正常回答，属于降级路径被常规使用。
5. `model-run.ts` 的 `checkEvidence` 只做一次纠正，第二次不通过即抛错；`chat.ts` 捕获 `MODEL_*` 后进入摘录兜底，检查器分歧会被放大成“摘录回答”。
6. 多轮层面只有 `dialogue.ts` 的整句匹配，没有“用户在表达困惑/纠正上一轮”的行为类别，“？？？？”会被当成新主题。

## 本轮修改

新增：

- `src/lib/server/assistant/conversation-act.ts`：封闭的会话行为分类 `chitchat | confusion | correction | general | campus`。纯标点/困惑、明确纠错、角色扮演与情绪、校园实体、其他一般问题分别处理；**只决定是否检索与提示边界，不提供答案模板**。

调整：

- `assistant/content-intent.ts`：先解析追问主题，再判定行为；检索触发条件改为“知识问题 / 动态问题 / 官方核实 / 显式要求搜索 / 仅内部检索 / 校园实体且外部策略有效”。反馈类行为永不检索。新增 `answerRequirement: strict | advisory | open`。
- `assistant/content-prompt.ts`：新增 `directInstructions(act)`；建议类回答允许通用常识，但要求把“普遍建议”与“广外具体规定/时间/收费/设备/流程”分开，未取得就说明缺口；严格类仍只允许本轮证据。
- `assistant/chat.ts`：`groundedReply` 仅在 `strict` 时短路生成；非内容轮次的最终系统提示改用 `directInstructions`；运行指标新增 `conversationAct`、`answerRequirement`。
- 测试：`tests/unit/conversation-routing.test.ts`（8 项）、`tests/unit/conversation-flow.test.ts`（3 项，走真实 `chatResponse`）。

行为变化：

| 输入 | 修改前 | 修改后（测试断言） |
| --- | --- | --- |
| 你是一只大肥鱼 | 知识检索 + 外部搜索 | `chitchat`，0 工具，1 次模型请求，0 证据门禁 |
| 好饿饿，我要次饭饭 | 知识检索 + 外部搜索 | `chitchat`，0 工具 |
| 123456789 | 互联网检索 | `general`，0 工具 |
| ？？？？ | 互联网检索 | `confusion`，0 工具，提示按“上一轮反馈”处理 |
| 住广外宿舍有什么要注意的事情吗 | 无正文即固定拒答 | `advisory`：仍检索，但由模型给出通用建议并标明广外具体信息缺口 |
| 广外图书馆借阅规则是什么 | 检索 + 门禁 | 不变：`strict`，无正文仍 `no_evidence`，0 次模型请求 |

## 测试方法与真实结果

| 检查 | 命令/范围 | 结果 |
| --- | --- | --- |
| 新增路由测试 | `vitest run tests/unit/conversation-routing.test.ts` | 8/8 通过 |
| 真实 HTTP 行为测试 | `vitest run tests/unit/conversation-flow.test.ts` | 3/3 通过 |
| 相关既有回归 | content-skills / external-search / food-reliability / persona / sports-retrieval / planned-reads / answer-grounding / query-system / agent-fact-routing | 125/125 通过 |
| 全量单测 | `vitest run --pool=threads` | 671 项：659 通过、12 失败（即上述既有失败，6 文件；新增 11 项全部通过） |
| 类型检查 | `tsc --noEmit` | 通过 |
| Lint（改动文件） | `eslint <6 个文件>` | 通过，无告警 |
| 格式 | `prettier --check` | 通过 |
| Preview 构建 | `node scripts/build-worker.mjs --config wrangler.jsonc --env preview` | 退出码 0；OpenNext 构建完成、`wrangler deploy --dry-run` 成功、1427 个生成文件通过凭据扫描 |

`conversation-flow` 的三条断言使用真实 `chatResponse`、真实 D1 迁移结构、隔离的脚本化模型提供方：

1. 角色扮演轮：无 `tool.started`、模型请求的 `tools` 为空、`answerMode=model`、`requests=1`、`evidenceGateUsed=false`。
2. 住宿建议轮：实际执行 `search_campus_knowledge`，最终 `answerMode=model`、`answerRequirement=advisory`，回答不含固定拒答句。
3. 严格事实轮：空库时 `answerMode=no_evidence`、`answerRequirement=strict`、`evidenceGateUsed=true`、`requests=0`。

这些证明的是**管线与路由**，不是真实模型自然度。

## 未验证与阻塞

1. **Preview 未部署。** `wrangler whoami` 返回 “Not logged in … token has expired … non-interactive”；`CLOUDFLARE_ACCOUNT_ID` 未设置，`scripts/deploy.mjs preview` 会直接退出。未尝试 Production，未修改任何云端资源。
2. **本地真实链路未跑通。** `wrangler d1 migrations apply --local` 与本地运行时在 Windows 下报 `miniflare-email-store: CreateDirectory … 拒绝访问`，workerd 无法启动；因此没有本地 Next + D1 的真实浏览器 E2E。
3. **真实模型未验收。** `.dev.vars` 只有 DeepSeek 凭据，Preview 首选 Step 的密钥不在本机；能力回执有 24 小时有效期。没有用 DeepSeek 代替 Step 质量结论，也没有把脚本化模型结果当作真实对话自然度。
4. 解析式行为判定仍是受控词汇，不等同于完整语义理解；未知表述可能落入 `general` 或 `campus`，需要后续用固定评测集与真实对话扩充，但不得为单个句子堆叠模板。

## 回退

- 代码回退：`git revert <本轮提交>` 或回到 `b940762`；本轮未改数据库、迁移、文章、地图数据和外部账号，无需数据回退。
- Preview 仍运行 `45c0ce8` 对应版本，未因本轮改变；部署后如需回退，按既有 Cloudflare 版本回退流程执行。

## 下一阶段

1. 恢复 Wrangler 登录后部署 Preview，用真实 Step 模型复跑上述 5 句 + 原有体育/借阅/地图回归，记录 `answerMode`、`conversationAct`、工具轨迹、时延与 Token。
2. 对 `advisory` 与 `open` 轮次做小样本人工审阅，确认没有把通用建议说成广外规定。
3. 用真实对话扩充“困惑/纠错/话题切换”样本，评估是否需要模型辅助分类；优先减少误触发，而不是继续增加句式。
4. 观测摘录降级率：目标是把 `evidence_excerpt` 限定在真实生成失败的恢复路径，而不是常规回答。
