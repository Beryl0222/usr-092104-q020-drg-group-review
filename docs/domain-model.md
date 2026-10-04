# 病种付费归组复核领域模型

本文件定义归组复核与结算后端的共同语言：对象身份、事件载荷、事件顺序与版本语义。所有服务与接入方以此为准；`src/validator.js` 对可机器执行的部分逐条强制，本文说明其理由与不可机器强制的配套约定。

## 1. 核心边界

1. **临床事实只由医师签署产生。** 诊断、手术、治疗编码及其来源随 `CASE_SIGNED` 落存，签署后任何系统组件不得改写。需要更正时由医师重新签署（同一 `case_id`，`version` 递增），旧版本保留可回放。系统不因某个分组支付更高而诱导改动临床事实。
2. **系统只提示待澄清事实，不替医生重写病案。** `FACT_CLARIFICATION_REQUESTED` 只指出影响分组的缺件或冲突，不得携带建议编码或替代事实；回应方式是医师重签，不是系统代改。
3. **归组提议不做收入导向。** `GROUP_PROPOSED` 给出候选组与逐项解释，不携带支付金额与支付排序。编码员与临床科室的视图不出现"哪个组支付更高"；支付差异只在结算与重算语境出现。
4. **规则包按出院时点适用。** 归组与结算必须锁定 `rule_package_id` + `rule_package_version`，以 `discharged_at` 落在规则包生效区间为准。医保3.0 的机器人手术、肿瘤联合治疗、年龄细分、特例单议均为规则包内容，随版本化发布生效；同一份住院记录同时命中多项规则时，以规则包内的优先级与组合规则判定，判定过程写入候选组逐项解释。
5. **原结算不可覆盖。** 政策更新只对历史病例做比较重算（`RECALCULATION_COMPLETED`），重算结果不改写原结算；经批准的变化以差额分录入账（`SETTLEMENT_ADJUSTED`），原决定事件保持原样。
6. **双重支付风险未解除不得签发结算决定。** 跨院转诊、撤回重提、重复申报命中的关联（`DUPLICATE_RISK_FLAGGED`）必须经人工复核解除，`DECISION_ISSUED.duplicate_check` 留痕；豁免必须引用复核记录。
7. **特例单议、人工决定与申诉全程留痕。** 申请与裁定事件都携带材料引用（`materials`）与行为人（`requested_by` / `decided_by` / `filed_by`），权限可事后核对。
8. **每笔资金可回放。** 从任意 `settlement_decision` 沿 `case_id` 可回放：签署事实版本 → 规则包版本 → 候选组与逐项解释 → 复核/特例/申诉 → 结算决定 → 差额分录。

## 2. 对象（聚合）

| 聚合 | 身份 | 生命周期要点 |
| --- | --- | --- |
| `rule_package` | `rule_package_id` | 政策更新即发布新版本；`effective_from` 决定适用病例；旧版本永久保留用于回放与重算对照 |
| `inpatient_case` | `case_id` | 医师签署产生事实版本；重签升 `version`；待澄清提示与双重支付风险标记挂在病例上 |
| `grouping_candidate` | 候选批次 id | 一次归组提议；锁定规则包版本与出院时点 |
| `review_task` | 复核任务 id | 三条路径：`coding_conflict`（编码冲突）、`rule_boundary`（规则边界）、`high_cost`（高费用） |
| `exception_request` | 特例申请 id | 特例单议；申请与裁定在同一聚合上，材料随事件保留 |
| `appeal_case` | 申诉 id | 针对结算决定；申诉与裁定在同一聚合上 |
| `settlement_decision` | 结算决定 id | 决定与后续差额调整在同一聚合上，`version` 递增；原事件不可改 |
| `recalculation_run` | 重算批次 id | 政策更新触发的比较重算；只产出对照结果，不触碰原结算 |
| `access_record` | 接入记录 id | 接入与访问留痕，沿用同一事件信封约定 |

## 3. 事件与载荷约定

所有事件使用同一信封：`event_id`、`event_type`、`aggregate_type`、`aggregate_id`、`occurred_at`、`version`、`summary`。病例相关事件一律携带 `case_id` 作为关联键。金额一律用最小货币单位整数（`amount_minor` / `delta_minor`）加 `currency`。

| 事件 | 聚合 | 关键载荷 | 语义 |
| --- | --- | --- | --- |
| `RULE_PACKAGE_PUBLISHED` | rule_package | `rule_package_version`、`effective_from`、`policy_ref` | 规则包版本发布，含生效时点与政策文号 |
| `CASE_SIGNED` | inpatient_case | `discharged_at`、`facts`、`signed_by`、`signed_at`、可选 `attributes` | 医师签署诊断/手术/治疗编码；`facts` 每条带 `code` 与 `source`（来源）；`attributes` 放年龄等病例属性（年龄细分的输入） |
| `GROUP_PROPOSED` | grouping_candidate | `rule_package_id`、`rule_package_version`、`discharged_at`、`candidates[]` | 按出院时点规则包给出候选组；每组带 `explanations[]`（`item` + `effect` 逐项解释）；禁止携带支付金额与排序 |
| `FACT_CLARIFICATION_REQUESTED` | inpatient_case | `questions[]` | 系统提示待澄清事实；每条含 `item_ref`（指向缺件）、`reason`、`affects`（受影响候选组，无法归组时用 `["ungrouped"]`）；禁止携带建议编码 |
| `REVIEW_REQUESTED` | review_task | `path`、`reason` | 进入复核路径：`coding_conflict` / `rule_boundary` / `high_cost` |
| `EXCEPTION_REQUESTED` | exception_request | `requested_by`、`reason`、`materials[]` | 特例单议申请，材料随事件保留 |
| `EXCEPTION_DECIDED` | exception_request | `decided_by`、`outcome`、`materials[]` | 特例裁定，含评审材料 |
| `APPEAL_FILED` | appeal_case | `filed_by`、`grounds`、`materials[]`、`target_decision_id` | 对结算决定提出申诉 |
| `APPEAL_DECIDED` | appeal_case | `decided_by`、`outcome`、`materials[]` | 申诉裁定 |
| `DECISION_ISSUED` | settlement_decision | `group_code`、规则包二元组、`decided_by`、`basis`、`amount_minor`、`currency`、`duplicate_check` | 签发结算决定；`basis.type` 为 `rule` / `exception` / `appeal`，后两者必须填 `ref`；`duplicate_check.result` 为 `clear` 或 `waived`（豁免须填 `ref` 引用复核记录） |
| `RECALCULATION_COMPLETED` | recalculation_run | 新规则包二元组、`policy_ref`、`comparisons[]` | 政策更新后的比较重算；逐病例给出原组/新组、原额/新额与 `delta_minor`；只比较不覆盖 |
| `SETTLEMENT_ADJUSTED` | settlement_decision | `original_decision_id`、`source`、`approval_ref`、`difference_entries[]` | 批准后的变化以差额分录入账；每条分录含 `item`、非零 `delta_minor`、`reason`；`source` 注明来源（重算/申诉/特例/人工） |
| `DUPLICATE_RISK_FLAGGED` | inpatient_case | `kind`、`linked_case_ids[]` | 双重支付风险：`cross_hospital_referral`（跨院转诊）/ `withdraw_resubmit`（撤回重提）/ `duplicate_claim`（重复申报） |
| `ACCESS_RECORDED` | access_record | `actor`、`action`、`subject_ref`、`purpose` | 接入与访问留痕；`action` 为 `read` / `write` / `export` |

## 4. 不变式（校验器强制）

| 编号 | 不变式 | 对应校验 |
| --- | --- | --- |
| INV-1 | 事件信封七字段齐全，`version` 为正整数，`occurred_at` 可解析 | 基础字段检查 |
| INV-2 | 事件类型与聚合类型属于稳定枚举，且事件挂在规定的聚合上 | 枚举与聚合归属检查 |
| INV-3 | 临床事实只能由 `CASE_SIGNED` 携带 | 非签署事件出现 `facts` 即拒绝 |
| INV-4 | 签署事实每条编码带来源，且至少一条记录 | `checkFacts` |
| INV-5 | 归组提议锁定规则包版本与出院时点，每组有逐项解释 | 必填 + `checkCandidates` |
| INV-6 | 归组提议不携带支付金额与排序 | 禁止字段检查 |
| INV-7 | 澄清提示只指缺件、标明影响分组，不给替代编码 | `checkQuestions` + 禁止字段 |
| INV-8 | 复核路径限于编码冲突/规则边界/高费用 | `path` 枚举 |
| INV-9 | 特例与申诉的申请、裁定都保留材料与行为人 | 必填 + `checkMaterials` |
| INV-10 | 结算决定必须完成双重支付核查，豁免须引用复核记录 | `checkDecisionIssued` |
| INV-11 | 重算只产出对照结果，调整必须注明来源、批准与差额分录 | `checkComparisons` / `checkDifferenceEntries` / `checkAdjustmentSource` |
| INV-12 | 差额分录逐条有非零差额与原因，原结算事件不被修改 | `checkDifferenceEntries` + 事件只增不改 |
| INV-13 | 双重支付风险三分类，关联病例非空 | `kind` 枚举 + `linked_case_ids` |
| INV-14 | 接入记录沿用同一信封与载荷约定 | `ACCESS_RECORDED` 检查 |

不可机器强制、由配套流程保证的约定：

- 存在未解除的 `DUPLICATE_RISK_FLAGGED` 时不得签发 `DECISION_ISSUED`；解除以人工复核记录为准，并在 `duplicate_check.ref` 引用。
- 编码员视图与临床科室视图不展示支付金额、支付排序与"高付费组"提示；支付域数据的访问记入 `ACCESS_RECORDED`。
- 只有真正影响分组的缺件才发起澄清，避免对不影响结果的缺件打扰临床。
- 重签必须由具备权限的医师完成；`signed_by` 与接入系统的权限记录可相互核对。

## 5. 事件顺序与版本语义

典型顺序（任一环节可因复核、特例、申诉而往返）：

1. `RULE_PACKAGE_PUBLISHED`：规则包版本发布，确定生效时点。
2. `CASE_SIGNED`：医师签署事实（version 1）。澄清或更正后重签，version 递增。
3. `GROUP_PROPOSED`：按出院时点适用的规则包生成候选组与逐项解释。
4. `FACT_CLARIFICATION_REQUESTED` ⇄ `CASE_SIGNED`：系统提示缺件，医师重签回应，可多次往返。
5. `REVIEW_REQUESTED`：编码冲突、规则边界、高费用分别进入对应复核路径。
6. `EXCEPTION_REQUESTED` → `EXCEPTION_DECIDED`：特例单议。
7. `DUPLICATE_RISK_FLAGGED`：任意时点可标记；未解除前不得进入下一步。
8. `DECISION_ISSUED`：签发结算决定（settlement_decision version 1）。
9. `APPEAL_FILED` → `APPEAL_DECIDED`：申诉可改变后续调整。
10. `RECALCULATION_COMPLETED` → `SETTLEMENT_ADJUSTED`：政策更新后比较重算，批准的变化以差额分录挂在同一结算决定聚合上（version 递增）。
11. `ACCESS_RECORDED`：任意时点，接入与访问留痕。

版本语义：`version` 是同一 `aggregate_id` 上的顺序号，从 1 开始递增；事件只增不改，历史版本永久保留，回放时按 `aggregate_id` + `version` 排序复原任一对象任一时刻的状态。

## 6. 视图隔离与接入记录

- **临床科室视图**：只含事实、候选组与逐项解释、待澄清问题；不含支付金额、支付排序、收入对比。临床科室看到的不是收入导向。
- **编码员视图**：在临床视图基础上突出"真正影响分组的缺件"（`questions[].affects`），帮助定位补件优先级。
- **结算与审核视图**：含金额、差额分录与完整事件链。任何角色访问支付域数据都产生 `ACCESS_RECORDED`，记录操作者、动作、对象与用途；接入记录与业务事件使用同一信封，审核方可统一采集。

## 7. 双重支付防护

三类风险共用 `DUPLICATE_RISK_FLAGGED` 标记，以 `linked_case_ids` 关联全部相关病例或申报：

- `cross_hospital_referral`：跨院转诊的同一住院过程在转出、转入院分别申报时关联，核定各自结算边界，防止同一过程两头支付。
- `withdraw_resubmit`：撤回后重新提交必须引用原申报，系统比对是否同一住院过程，防止撤回单与新单同时入账。
- `duplicate_claim`：同一病例重复申报直接拦截。

风险解除只能来自人工复核；结算决定的 `duplicate_check` 记录核查结果，豁免必须引用复核记录，保证事后可追责。

## 8. 审计回放

医保审核方从任意一笔资金（`settlement_decision`）出发可完整回放：

1. 按 `case_id` 收集全部事件，按聚合与 `version` 排序。
2. 从 `CASE_SIGNED` 取得签署时刻的事实与来源（含重签历史）。
3. 从 `GROUP_PROPOSED` 取得出院时点锁定的规则包版本与逐项解释。
4. 从复核、特例、申诉事件取得材料与行为人。
5. 从 `DECISION_ISSUED` 与 `SETTLEMENT_ADJUSTED` 取得决定、批准与差额分录；`RECALCULATION_COMPLETED` 提供政策对照。
6. 从 `ACCESS_RECORDED` 核对谁在何时接触过哪些数据。
