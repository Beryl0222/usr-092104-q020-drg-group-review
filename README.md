# 病种付费归组复核

本仓库保存病种付费归组复核的领域词汇、事件约定与基础校验代码，供相关单位统一对象身份、事件顺序和版本语义。

## 目录

- `contracts/domain.schema.json`：领域事件信封与稳定枚举。
- `docs/domain-model.md`：核心边界、对象生命周期、事件载荷约定、不变式与回放约定。
- `data/sample.json`：一条中文联调样例（CASE_SIGNED）。
- `data/examples/`：全部事件类型的中文联调样例。
- `src/`：事件基础字段与载荷约定校验。
- `tests/`：领域资料一致性检查。

## 核心对象

rule_package、inpatient_case、grouping_candidate、review_task、exception_request、appeal_case、settlement_decision、recalculation_run、access_record。

## 事件

RULE_PACKAGE_PUBLISHED、CASE_SIGNED、GROUP_PROPOSED、FACT_CLARIFICATION_REQUESTED、REVIEW_REQUESTED、EXCEPTION_REQUESTED、EXCEPTION_DECIDED、APPEAL_FILED、APPEAL_DECIDED、DECISION_ISSUED、RECALCULATION_COMPLETED、SETTLEMENT_ADJUSTED、DUPLICATE_RISK_FLAGGED、ACCESS_RECORDED。

核心边界：临床事实只由医师签署产生，系统只提示待澄清事实、不改写病案；归组提议不带支付信息，临床科室看到的不是收入导向；原结算不可覆盖，批准后的变化以差额分录入账；双重支付风险未解除不得签发结算决定；每笔资金可回放规则、病案、决定与调整。详见 `docs/domain-model.md`。

## 本地检查

```bash
npm test
```
