# 病种付费归组复核

本仓库保存病种付费归组复核与结算后端的领域词汇、事件约定与基础校验代码，供相关单位统一对象身份、事件顺序和版本语义。

## 目录

- `contracts/domain.schema.json`：领域事件信封与稳定枚举（19 类事件 / 10 类聚合）。
- `src/contracts.js`：事件与聚合枚举的单一事实源，含事件—聚合归属、复核路径、编码来源、分录种类常量。
- `src/validator.js`：事件信封校验、事件—聚合归属校验、同一聚合流版本递增与 event_id 幂等校验。
- `data/sample.json`：医保 3.0 同现场景（机器人手术＋肿瘤联合治疗＋年龄细分＋特例单议＋申诉＋政策重算差额＋转诊防重）的完整有序事件流。
- `docs/domain.md`：角色视图、七条领域不变量、事件总览与资金回放路径。
- `tests/`：领域资料一致性检查（schema 与常量同步、归属合法、版本连续、样例流合法）。

## 核心对象与事件

聚合：`rule_package`、`inpatient_case`、`signed_coding`、`grouping_candidate`、`review_task`、`special_case`、`appeal`、`settlement_decision`、`ledger_entry`、`claim`。

事件：`RULE_PACKAGE_PUBLISHED`、`CASE_SIGNED`、`CODING_PRESERVED`、`GROUP_PROPOSED`、`REVIEW_REQUESTED`、`FACT_CLARIFICATION_REQUESTED`、`SPECIAL_CASE_SUBMITTED`、`SPECIAL_CASE_DECIDED`、`APPEAL_FILED`、`APPEAL_DECIDED`、`DECISION_ISSUED`、`COMPARISON_RECALCULATED`、`SETTLEMENT_ADJUSTED`、`LEDGER_ENTRY_POSTED`、`CLAIM_SUBMITTED`、`CLAIM_WITHDRAWN`、`CLAIM_RESUBMITTED`、`CLAIM_DUPLICATE_BLOCKED`、`REFERRAL_LINKED`。

## 边界要点

- **事实不被支付诱导改写**：医生签署的编码及来源冻结只读；复核只发事实澄清，禁止改码建议与收入对比。
- **出院时点锁规则包**：候选组按出院当日有效规则包生成并逐项解释，编码人员据此定位真正影响分组的缺件。
- **原结算不可变**：政策更新只做比较重算；批准的变化以 `original` / `difference` 差额分录入账。
- **防双重支付**：转诊链、撤回重提关联、申报幂等键与重复拦截保证同一费用只付一次。
- **资金可回放**：每笔分录的 `trace` 指回规则包、已签署编码、候选组解释、复核/特例/申诉材料与决定。

详见 `docs/domain.md`。

## 本地检查

```bash
npm test
```
