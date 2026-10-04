const BASE_REQUIRED = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

export const EVENT_TYPES = [
  "CASE_SIGNED",
  "GROUP_PROPOSED",
  "REVIEW_REQUESTED",
  "DECISION_ISSUED",
  "SETTLEMENT_ADJUSTED",
  "RULE_PACKAGE_PUBLISHED",
  "FACT_CLARIFICATION_REQUESTED",
  "EXCEPTION_REQUESTED",
  "EXCEPTION_DECIDED",
  "APPEAL_FILED",
  "APPEAL_DECIDED",
  "RECALCULATION_COMPLETED",
  "DUPLICATE_RISK_FLAGGED",
  "ACCESS_RECORDED",
];

export const AGGREGATE_TYPES = [
  "rule_package",
  "inpatient_case",
  "grouping_candidate",
  "settlement_decision",
  "review_task",
  "exception_request",
  "appeal_case",
  "recalculation_run",
  "access_record",
];

const REVIEW_PATHS = ["coding_conflict", "rule_boundary", "high_cost"];
const DUPLICATE_KINDS = ["cross_hospital_referral", "withdraw_resubmit", "duplicate_claim"];
const ACCESS_ACTIONS = ["read", "write", "export"];
const DECISION_OUTCOMES = ["approved", "rejected"];
const DUPLICATE_CHECK_RESULTS = ["clear", "waived"];
const DECISION_BASIS_TYPES = ["rule", "exception", "appeal"];
const ADJUSTMENT_SOURCE_TYPES = ["recalculation", "appeal", "exception", "manual"];

// 每种事件的聚合归属、必填载荷与禁止携带的字段。
// 禁止字段体现核心边界：归组提议不带支付信息（反诱导），澄清提示不给替代编码（不改写病案）。
const EVENT_SPEC = {
  CASE_SIGNED: {
    aggregate: "inpatient_case",
    required: ["case_id", "discharged_at", "facts", "signed_by", "signed_at"],
  },
  GROUP_PROPOSED: {
    aggregate: "grouping_candidate",
    required: ["case_id", "rule_package_id", "rule_package_version", "discharged_at", "candidates"],
    forbidden: ["payment_rank", "payment_amount", "amount_minor"],
  },
  REVIEW_REQUESTED: {
    aggregate: "review_task",
    required: ["case_id", "path"],
  },
  DECISION_ISSUED: {
    aggregate: "settlement_decision",
    required: [
      "case_id",
      "group_code",
      "rule_package_id",
      "rule_package_version",
      "decided_by",
      "basis",
      "amount_minor",
      "currency",
      "duplicate_check",
    ],
  },
  SETTLEMENT_ADJUSTED: {
    aggregate: "settlement_decision",
    required: ["case_id", "original_decision_id", "source", "approval_ref", "difference_entries"],
  },
  RULE_PACKAGE_PUBLISHED: {
    aggregate: "rule_package",
    required: ["rule_package_version", "effective_from", "policy_ref"],
  },
  FACT_CLARIFICATION_REQUESTED: {
    aggregate: "inpatient_case",
    required: ["case_id", "questions"],
    forbidden: ["suggested_codes", "suggested_facts"],
  },
  EXCEPTION_REQUESTED: {
    aggregate: "exception_request",
    required: ["case_id", "requested_by", "reason", "materials"],
  },
  EXCEPTION_DECIDED: {
    aggregate: "exception_request",
    required: ["case_id", "decided_by", "outcome", "materials"],
  },
  APPEAL_FILED: {
    aggregate: "appeal_case",
    required: ["case_id", "filed_by", "grounds", "materials", "target_decision_id"],
  },
  APPEAL_DECIDED: {
    aggregate: "appeal_case",
    required: ["case_id", "decided_by", "outcome", "materials"],
  },
  RECALCULATION_COMPLETED: {
    aggregate: "recalculation_run",
    required: ["rule_package_id", "rule_package_version", "policy_ref", "comparisons"],
  },
  DUPLICATE_RISK_FLAGGED: {
    aggregate: "inpatient_case",
    required: ["case_id", "kind", "linked_case_ids"],
  },
  ACCESS_RECORDED: {
    aggregate: "access_record",
    required: ["actor", "action", "subject_ref", "purpose"],
  },
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDateTimeString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function checkEnum(value, allowed, name) {
  if (value === undefined) return [];
  return allowed.includes(value) ? [] : [`${name} 必须是 ${allowed.join(" / ")} 之一`];
}

// 签署事实：每条编码都要带来源，且至少有一条诊断、手术或治疗记录
function checkFacts(facts) {
  if (facts === undefined) return [];
  if (!isPlainObject(facts)) return ["facts 必须是对象"];
  const errors = [];
  let total = 0;
  for (const section of ["diagnoses", "procedures", "treatments"]) {
    if (!(section in facts)) continue;
    const items = facts[section];
    if (!Array.isArray(items)) {
      errors.push(`facts.${section} 必须是数组`);
      continue;
    }
    total += items.length;
    items.forEach((item, index) => {
      if (!isPlainObject(item)) {
        errors.push(`facts.${section}[${index}] 必须是对象`);
        return;
      }
      if (!isNonEmptyString(item.code)) errors.push(`facts.${section}[${index}] 缺少编码 code`);
      if (!isNonEmptyString(item.source)) errors.push(`facts.${section}[${index}] 缺少来源 source`);
    });
  }
  if (total === 0) errors.push("facts 至少要有一条诊断、手术或治疗记录");
  return errors;
}

// 候选组：每组必须有逐项解释，解释只讲事实与规则依据
function checkCandidates(candidates) {
  if (candidates === undefined) return [];
  if (!isNonEmptyArray(candidates)) return ["candidates 必须是非空数组"];
  const errors = [];
  candidates.forEach((candidate, index) => {
    if (!isPlainObject(candidate)) {
      errors.push(`candidates[${index}] 必须是对象`);
      return;
    }
    if (!isNonEmptyString(candidate.group_code)) errors.push(`candidates[${index}] 缺少 group_code`);
    if (!isNonEmptyArray(candidate.explanations)) {
      errors.push(`candidates[${index}] 必须给出逐项解释 explanations`);
      return;
    }
    candidate.explanations.forEach((explanation, i) => {
      if (!isPlainObject(explanation) || !isNonEmptyString(explanation.item) || !isNonEmptyString(explanation.effect)) {
        errors.push(`candidates[${index}].explanations[${i}] 需要 item 与 effect`);
      }
    });
  });
  return errors;
}

// 待澄清事实：只指出影响分组的缺件或冲突，affects 标明受影响的候选组
function checkQuestions(questions) {
  if (questions === undefined) return [];
  if (!isNonEmptyArray(questions)) return ["questions 必须是非空数组"];
  const errors = [];
  questions.forEach((question, index) => {
    if (!isPlainObject(question)) {
      errors.push(`questions[${index}] 必须是对象`);
      return;
    }
    if (!isNonEmptyString(question.item_ref)) errors.push(`questions[${index}] 缺少指向缺件的 item_ref`);
    if (!isNonEmptyString(question.reason)) errors.push(`questions[${index}] 缺少 reason`);
    if (!isNonEmptyArray(question.affects)) {
      errors.push(`questions[${index}] 必须标明受影响的分组 affects（无法归组时用 ["ungrouped"]）`);
    }
  });
  return errors;
}

function checkMaterials(materials) {
  if (materials === undefined) return [];
  return isNonEmptyArray(materials) ? [] : ["materials 必须是非空数组（材料引用）"];
}

function checkDecisionIssued(record) {
  const errors = [];
  if ("amount_minor" in record && !Number.isInteger(record.amount_minor)) {
    errors.push("amount_minor 必须是整数（最小货币单位）");
  }
  const basis = record.basis;
  if (basis !== undefined) {
    if (!isPlainObject(basis)) {
      errors.push("basis 必须是对象");
    } else {
      errors.push(...checkEnum(basis.type, DECISION_BASIS_TYPES, "basis.type"));
      if ((basis.type === "exception" || basis.type === "appeal") && !isNonEmptyString(basis.ref)) {
        errors.push("依据特例或申诉签发时必须填写 basis.ref");
      }
    }
  }
  const check = record.duplicate_check;
  if (check !== undefined) {
    if (!isPlainObject(check)) {
      errors.push("duplicate_check 必须是对象");
    } else {
      errors.push(...checkEnum(check.result, DUPLICATE_CHECK_RESULTS, "duplicate_check.result"));
      if (check.result === "waived" && !isNonEmptyString(check.ref)) {
        errors.push("双重支付风险豁免必须引用复核记录 duplicate_check.ref");
      }
    }
  }
  return errors;
}

// 差额分录：只增不改，每条分录有非零差额与原因
function checkDifferenceEntries(entries) {
  if (entries === undefined) return [];
  if (!isNonEmptyArray(entries)) return ["difference_entries 必须是非空数组（差额分录）"];
  const errors = [];
  entries.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      errors.push(`difference_entries[${index}] 必须是对象`);
      return;
    }
    if (!isNonEmptyString(entry.item)) errors.push(`difference_entries[${index}] 缺少 item`);
    if (!Number.isInteger(entry.delta_minor) || entry.delta_minor === 0) {
      errors.push(`difference_entries[${index}].delta_minor 必须是非零整数`);
    }
    if (!isNonEmptyString(entry.reason)) errors.push(`difference_entries[${index}] 缺少 reason`);
  });
  return errors;
}

function checkAdjustmentSource(source) {
  if (source === undefined) return [];
  if (!isPlainObject(source)) return ["source 必须是对象"];
  const errors = checkEnum(source.type, ADJUSTMENT_SOURCE_TYPES, "source.type");
  if (!isNonEmptyString(source.ref)) errors.push("source.ref 必须注明调整来源（重算批次、申诉或复核记录）");
  return errors;
}

// 比较重算：只产出对照结果，允许零差异，但不得为空批次以外的形态
function checkComparisons(comparisons) {
  if (comparisons === undefined) return [];
  if (!Array.isArray(comparisons)) return ["comparisons 必须是数组"];
  const errors = [];
  comparisons.forEach((comparison, index) => {
    if (!isPlainObject(comparison)) {
      errors.push(`comparisons[${index}] 必须是对象`);
      return;
    }
    if (!isNonEmptyString(comparison.case_id)) errors.push(`comparisons[${index}] 缺少 case_id`);
    if (!Number.isInteger(comparison.delta_minor)) errors.push(`comparisons[${index}].delta_minor 必须是整数`);
  });
  return errors;
}

function checkRulePackagePublished(record) {
  const errors = [];
  if ("rule_package_version" in record && !isNonEmptyString(record.rule_package_version)) {
    errors.push("rule_package_version 必须是非空字符串");
  }
  if ("effective_from" in record && !isDateTimeString(record.effective_from)) {
    errors.push("effective_from 必须是日期时间字符串");
  }
  return errors;
}

const SHAPE_CHECKS = {
  CASE_SIGNED: (record) => [
    ...checkFacts(record.facts),
    ...("discharged_at" in record && !isDateTimeString(record.discharged_at) ? ["discharged_at 必须是日期时间字符串"] : []),
  ],
  GROUP_PROPOSED: (record) => checkCandidates(record.candidates),
  REVIEW_REQUESTED: (record) => checkEnum(record.path, REVIEW_PATHS, "path"),
  DECISION_ISSUED: (record) => checkDecisionIssued(record),
  SETTLEMENT_ADJUSTED: (record) => [
    ...checkDifferenceEntries(record.difference_entries),
    ...checkAdjustmentSource(record.source),
  ],
  RULE_PACKAGE_PUBLISHED: (record) => checkRulePackagePublished(record),
  FACT_CLARIFICATION_REQUESTED: (record) => checkQuestions(record.questions),
  EXCEPTION_REQUESTED: (record) => checkMaterials(record.materials),
  EXCEPTION_DECIDED: (record) => [
    ...checkEnum(record.outcome, DECISION_OUTCOMES, "outcome"),
    ...checkMaterials(record.materials),
  ],
  APPEAL_FILED: (record) => checkMaterials(record.materials),
  APPEAL_DECIDED: (record) => [
    ...checkEnum(record.outcome, DECISION_OUTCOMES, "outcome"),
    ...checkMaterials(record.materials),
  ],
  RECALCULATION_COMPLETED: (record) => checkComparisons(record.comparisons),
  DUPLICATE_RISK_FLAGGED: (record) => [
    ...checkEnum(record.kind, DUPLICATE_KINDS, "kind"),
    ...(record.linked_case_ids === undefined
      ? []
      : isNonEmptyArray(record.linked_case_ids)
        ? []
        : ["linked_case_ids 必须是非空数组（关联病例或申报）"]),
  ],
  ACCESS_RECORDED: (record) => checkEnum(record.action, ACCESS_ACTIONS, "action"),
};

export function validateEvent(record) {
  if (!isPlainObject(record)) return ["事件必须是对象"];
  const errors = [];

  for (const name of BASE_REQUIRED) {
    if (!(name in record)) errors.push(`缺少字段：${name}`);
  }
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("occurred_at" in record && !isDateTimeString(record.occurred_at)) {
    errors.push("occurred_at 必须是日期时间字符串");
  }

  if ("event_type" in record) {
    if (!EVENT_TYPES.includes(record.event_type)) {
      errors.push(`未知事件类型：${record.event_type}`);
    } else {
      const spec = EVENT_SPEC[record.event_type];
      if ("aggregate_type" in record && record.aggregate_type !== spec.aggregate) {
        errors.push(`${record.event_type} 必须挂在聚合 ${spec.aggregate} 上`);
      }
      for (const name of spec.required) {
        if (!(name in record)) errors.push(`缺少字段：${name}`);
      }
      for (const name of spec.forbidden ?? []) {
        if (name in record) errors.push(`${record.event_type} 不得携带字段：${name}`);
      }
      errors.push(...SHAPE_CHECKS[record.event_type](record));
    }
  }

  // 临床事实只能由医师签署事件携带，其他事件一律不得改写
  if (record.event_type !== "CASE_SIGNED" && "facts" in record) {
    errors.push("临床事实只能由 CASE_SIGNED 携带，其他事件不得改写");
  }

  return errors;
}
