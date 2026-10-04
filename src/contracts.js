// 病种付费归组复核：领域事件契约的单一事实源。
// contracts/domain.schema.json 的枚举必须与本文件保持一致，由测试守护。

export const EVENT_TYPES = [
  "RULE_PACKAGE_PUBLISHED", // 规则包发布（含生效区间，出院时点适用）
  "CASE_SIGNED", // 病案签署：诊断/手术/治疗编码经医生签署后封存
  "CODING_PRESERVED", // 已签署编码及来源归档，任何下游流程不得改写
  "GROUP_PROPOSED", // 归组引擎按出院时点规则包给出候选组与逐项解释
  "REVIEW_REQUESTED", // 进入复核：编码冲突 / 规则边界 / 高费用 三条路径
  "FACT_CLARIFICATION_REQUESTED", // 只提示待澄清事实，不替医生重写病案
  "SPECIAL_CASE_SUBMITTED", // 特例单议申请（保留材料与权限）
  "SPECIAL_CASE_DECIDED", // 特例单议人工决定
  "APPEAL_FILED", // 申诉提起（保留材料与权限）
  "APPEAL_DECIDED", // 申诉决定
  "DECISION_ISSUED", // 归组/结算人工决定签发
  "COMPARISON_RECALCULATED", // 政策更新后对历史病例比较重算（不覆盖原结算）
  "SETTLEMENT_ADJUSTED", // 批准后的变化以差额分录入账
  "LEDGER_ENTRY_POSTED", // 资金分笔录：原始 / 差额，支持按笔回放
  "CLAIM_SUBMITTED", // 申报
  "CLAIM_WITHDRAWN", // 撤回
  "CLAIM_RESUBMITTED", // 撤回后重提，关联原申报
  "CLAIM_DUPLICATE_BLOCKED", // 重复申报拦截，防止双重支付
  "REFERRAL_LINKED", // 跨院转诊关联，费用沿转诊链扣减
];

export const AGGREGATE_TYPES = [
  "rule_package",
  "inpatient_case",
  "signed_coding",
  "grouping_candidate",
  "review_task",
  "special_case",
  "appeal",
  "settlement_decision",
  "ledger_entry",
  "claim",
];

// 事件归属的聚合类型：事件只能写在自己的聚合流上。
export const EVENT_AGGREGATE = {
  RULE_PACKAGE_PUBLISHED: "rule_package",
  CASE_SIGNED: "inpatient_case",
  CODING_PRESERVED: "signed_coding",
  GROUP_PROPOSED: "grouping_candidate",
  REVIEW_REQUESTED: "review_task",
  FACT_CLARIFICATION_REQUESTED: "review_task",
  SPECIAL_CASE_SUBMITTED: "special_case",
  SPECIAL_CASE_DECIDED: "special_case",
  APPEAL_FILED: "appeal",
  APPEAL_DECIDED: "appeal",
  DECISION_ISSUED: "settlement_decision",
  COMPARISON_RECALCULATED: "settlement_decision",
  SETTLEMENT_ADJUSTED: "settlement_decision",
  LEDGER_ENTRY_POSTED: "ledger_entry",
  CLAIM_SUBMITTED: "claim",
  CLAIM_WITHDRAWN: "claim",
  CLAIM_RESUBMITTED: "claim",
  CLAIM_DUPLICATE_BLOCKED: "claim",
  REFERRAL_LINKED: "inpatient_case",
};

// 三条复核路径。系统只提示事实，不产出"改编码"动作。
export const REVIEW_PATHS = [
  "coding_conflict", // 编码冲突
  "rule_boundary", // 规则边界
  "high_cost", // 高费用
];

// 编码条目来源：归组解释必须能逐项指回来源。
export const CODING_SOURCES = [
  "doctor_signed", // 医生签署
  "operative_record", // 手术记录
  "pathology", // 病理
  "implant_log", // 植入物登记（机器人等）
  "referral_transfer", // 跨院转诊带入
];

// 分录种类：原结算不可变，政策变化只追加差额。
export const ENTRY_KINDS = ["original", "difference"];

// 申报生命周期状态（用于事件流合法性校验）。
export const CLAIM_STATES = {
  CLAIM_SUBMITTED: "submitted",
  CLAIM_WITHDRAWN: "withdrawn",
  CLAIM_RESUBMITTED: "submitted",
  CLAIM_DUPLICATE_BLOCKED: "blocked",
};

export const REQUIRED_FIELDS = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
];
