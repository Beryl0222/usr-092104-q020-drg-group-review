# 领域约定：病种付费归组复核与结算后端

本文档固化医保办"归组复核—结算"后端的核心边界。医保 3.0 上线后，机器人手术、
肿瘤联合治疗、年龄细分、特例单议可能同时落在同一份住院记录上，下述不变量用于
保证系统不会因为支付差异诱导临床事实被改写，并让每一笔资金都可回放。

## 角色与视图

| 角色 | 看到的内容 | 看不到的内容 |
| --- | --- | --- |
| 编码人员（医保办） | 已签署编码及来源、候选组逐项解释、**真正影响分组的缺件**清单 | 候选组间支付金额对比不作为补件导向 |
| 临床科室 | 待澄清的临床事实问题（部位、术式、病理…） | 收入/支付金额、"改成某码可多得多少" |
| 医生 | 仅在自己签署的事实范围内补充澄清 | 系统代写病案或代写编码 |
| 医保审核方 | 从任意一笔资金回放：规则包 → 已签署编码 → 候选组解释 → 复核/特例/申诉材料与决定 → 分录 | （全链路可见，但操作留痕） |

## 七条领域不变量

1. **临床事实先封存，归组只读取。** 医生签署的诊断、手术、治疗编码及来源经
   `CASE_SIGNED` + `CODING_PRESERVED` 冻结（`frozen: true`）。归组引擎、复核、
   结算都只能引用，不能修改；不存在"为进入更高支付组而改码"的合法事件。
2. **按出院时点锁规则包。** 候选组由出院当日有效的规则包产生（`CASE_SIGNED.rule_package_at_discharge`
   与 `GROUP_PROPOSED.rule_package_version` 必须一致）。规则包带 `effective_from/effective_to`
   生效区间，事后发布的规则不回溯改变已生效归组。
3. **候选组必须给逐项解释。** `GROUP_PROPOSED.candidates[].explanations` 对主诊、
   机器人手术、肿瘤联合治疗、年龄分段等每个因子给 `hit/value/basis_code/note`，
   未命中也要说明缺哪件证据——编码人员据此定位**真正影响分组的缺件**，而不是泛泛补料。
4. **复核分三条路径，系统只问事实不重写病案。**
   - `coding_conflict`（编码冲突）：多条编码或编码与病理矛盾；
   - `rule_boundary`（规则边界）：加收/细分的适用条件处于规则边界；
   - `high_cost`（高费用）：费用显著超支付标准，导向特例单议。

   系统只发 `FACT_CLARIFICATION_REQUESTED`（问题 + 证据指引），
   `forbidden_actions` 明确禁止 `rewrite_code`、`show_revenue_diff`。
5. **特例、人工决定、申诉材料与权限全留痕。** `SPECIAL_CASE_*`、`DECISION_ISSUED`、
   `APPEAL_*` 记录提交/决定人、角色、材料引用和理由文档；权限不同的人能做什么
   由事件中的角色字段界定，全部事件不可删除。
6. **政策更新只比较重算，绝不覆盖原结算；批准后的变化走差额分录。**
   `COMPARISON_RECALCULATED` 仅产出 baseline/comparison 两套金额对比
   （`original_settlement_overwritten: false`）；经人工 `SETTLEMENT_ADJUSTED`
   批准后，由 `LEDGER_ENTRY_POSTED`（`entry_kind: "difference"`）追加分录，
   `entry_kind: "original"` 的原始分录永久不变。
7. **跨院转诊、撤回重提、重复申报绝不双重支付。**
   - 转诊：`REFERRAL_LINKED` 建立 `referral_chain_id`，链上各院申报带同一链
     ID，已结算部分沿链扣减；
   - 撤回重提：`CLAIM_WITHDRAWN` 冻结原申报，`CLAIM_RESUBMITTED` 用
     `replaces_claim_event` 关联、换新幂等键，同一金额只付一次；
   - 重复：每条申报带 `idempotency_key`，命中即 `CLAIM_DUPLICATE_BLOCKED`
     （`payment_generated: false`），不产生资金。

## 事件总览

信封字段沿用既有约定：`event_id / event_type / aggregate_type / aggregate_id /
occurred_at / version / summary`，载荷字段自由扩展（schema `additionalProperties: true`）。
同一聚合流版本从 1 严格递增、event_id 全局唯一（幂等可重放）；不同聚合各自成流。

| 事件 | 聚合 | 含义 |
| | --- | --- |
| RULE_PACKAGE_PUBLISHED | rule_package | 规则包发布，带生效区间 |
| REFERRAL_LINKED | inpatient_case | 建立跨院转诊链 |
| CASE_SIGNED | inpatient_case | 病案签署、临床事实封存、锁定出院时点规则包 |
| CODING_PRESERVED | signed_coding | 已签署编码与来源只读归档 |
| GROUP_PROPOSED | grouping_candidate | 候选组 + 逐因子解释 |
| REVIEW_REQUESTED | review_task | 进入冲突/边界/高费用复核路径 |
| FACT_CLARIFICATION_REQUESTED | review_task | 仅请求澄清事实，禁止改码与收入对比 |
| SPECIAL_CASE_SUBMITTED / DECIDED | special_case | 特例单议申请与人工决定 |
| APPEAL_FILED / DECIDED | appeal | 申诉与决定 |
| DECISION_ISSUED | settlement_decision | 结算人工决定签发 |
| COMPARISON_RECALCULATED | settlement_decision | 新规则包比较重算（不落地资金） |
| SETTLEMENT_ADJUSTED | settlement_decision | 批准的变化（触发差额分录） |
| LEDGER_ENTRY_POSTED | ledger_entry | 原始/差额分笔录，带全链路 trace |
| CLAIM_SUBMITTED / WITHDRAWN / RESUBMITTED / DUPLICATE_BLOCKED | claim | 申报生命周期与防重 |

## 资金回放路径

任意一笔 `ledger_entry` 的 `trace` 都指回：
`rule_package` → `signed_coding`（含每条编码的 source）→ `grouping_candidate`
（含逐因子解释）→ `review_task` / `special_case` / `appeal`（问题、材料、决定）
→ `settlement_decision`。医保审核方沿 trace 即可重建"这笔钱为什么付、付了多少、
后来为什么变"。

## 联调样例

`data/sample.json` 是一例 69 岁直肠癌患者（甲院转诊乙院）的完整事件流：
机器人辅助手术 + 肿瘤联合治疗 + 年龄细分同时出现；编码冲突与高费用两条复核路径；
特例单议批准部分加收；申报撤回重提与转诊链重复申报拦截；3.1 规则包比较重算后
以差额分录调整；最后申诉驳回。`npm test` 校验整条流合法。
