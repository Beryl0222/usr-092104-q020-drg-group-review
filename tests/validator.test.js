import assert from "node:assert/strict";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

const BASE = {
  event_id: "evt-t-1",
  aggregate_id: "agg-t-1",
  occurred_at: "2026-10-01T08:00:00+08:00",
  version: 1,
  summary: "测试事件",
  case_id: "case-t-1",
};

function validEvent(eventType) {
  switch (eventType) {
    case "CASE_SIGNED":
      return {
        ...BASE,
        event_type: "CASE_SIGNED",
        aggregate_type: "inpatient_case",
        discharged_at: "2026-09-30T12:00:00+08:00",
        signed_by: "doctor-t",
        signed_at: "2026-10-01T08:00:00+08:00",
        facts: { diagnoses: [{ code: "C61.x00", source: "病案首页" }] },
      };
    case "GROUP_PROPOSED":
      return {
        ...BASE,
        event_type: "GROUP_PROPOSED",
        aggregate_type: "grouping_candidate",
        rule_package_id: "rp-t",
        rule_package_version: "3.0.2",
        discharged_at: "2026-09-30T12:00:00+08:00",
        candidates: [{ group_code: "G1", explanations: [{ item: "x", effect: "y" }] }],
      };
    case "FACT_CLARIFICATION_REQUESTED":
      return {
        ...BASE,
        event_type: "FACT_CLARIFICATION_REQUESTED",
        aggregate_type: "inpatient_case",
        questions: [{ item_ref: "facts.procedures[0]", reason: "缺手术记录", affects: ["G1"] }],
      };
    case "REVIEW_REQUESTED":
      return { ...BASE, event_type: "REVIEW_REQUESTED", aggregate_type: "review_task", path: "high_cost" };
    case "DECISION_ISSUED":
      return {
        ...BASE,
        event_type: "DECISION_ISSUED",
        aggregate_type: "settlement_decision",
        group_code: "G1",
        rule_package_id: "rp-t",
        rule_package_version: "3.0.2",
        decided_by: "officer-t",
        basis: { type: "rule" },
        amount_minor: 100000,
        currency: "CNY",
        duplicate_check: { result: "clear" },
      };
    case "SETTLEMENT_ADJUSTED":
      return {
        ...BASE,
        event_type: "SETTLEMENT_ADJUSTED",
        aggregate_type: "settlement_decision",
        original_decision_id: "sd-t-0",
        source: { type: "recalculation", ref: "rr-t" },
        approval_ref: "approval-t",
        difference_entries: [{ item: "权重差", delta_minor: 500, reason: "规则包更新" }],
      };
    case "DUPLICATE_RISK_FLAGGED":
      return {
        ...BASE,
        event_type: "DUPLICATE_RISK_FLAGGED",
        aggregate_type: "inpatient_case",
        kind: "withdraw_resubmit",
        linked_case_ids: ["case-t-0"],
      };
    case "EXCEPTION_REQUESTED":
      return {
        ...BASE,
        event_type: "EXCEPTION_REQUESTED",
        aggregate_type: "exception_request",
        requested_by: "dept-t",
        reason: "费用超标准",
        materials: ["出院小结"],
      };
    case "ACCESS_RECORDED":
      return {
        event_id: "evt-t-2",
        event_type: "ACCESS_RECORDED",
        aggregate_type: "access_record",
        aggregate_id: "ar-t-1",
        occurred_at: "2026-10-01T09:00:00+08:00",
        version: 1,
        summary: "访问留痕",
        actor: "auditor-t",
        action: "read",
        subject_ref: "settlement_decision/sd-t-0",
        purpose: "资金回放",
      };
    default:
      throw new Error(`未准备的类型：${eventType}`);
  }
}

test("基础字段：缺字段与非法版本", () => {
  const missing = validEvent("CASE_SIGNED");
  delete missing.event_id;
  assert.deepEqual(validateEvent(missing), ["缺少字段：event_id"]);

  assert.ok(validateEvent({ ...validEvent("CASE_SIGNED"), version: 0 }).includes("version 必须是正整数"));
  assert.ok(validateEvent({ ...validEvent("CASE_SIGNED"), occurred_at: "不是时间" }).includes("occurred_at 必须是日期时间字符串"));
  assert.deepEqual(validateEvent("x"), ["事件必须是对象"]);
});

test("未知事件类型被拒绝", () => {
  const errors = validateEvent({ ...validEvent("GROUP_PROPOSED"), event_type: "GROUP_HACKED" });
  assert.deepEqual(errors, ["未知事件类型：GROUP_HACKED"]);
});

test("事件必须挂在规定的聚合上", () => {
  const errors = validateEvent({ ...validEvent("CASE_SIGNED"), aggregate_type: "rule_package" });
  assert.deepEqual(errors, ["CASE_SIGNED 必须挂在聚合 inpatient_case 上"]);
});

test("临床事实只能由 CASE_SIGNED 携带", () => {
  const proposed = validEvent("GROUP_PROPOSED");
  proposed.facts = { diagnoses: [{ code: "X", source: "诱导改写" }] };
  const errors = validateEvent(proposed);
  assert.ok(errors.includes("临床事实只能由 CASE_SIGNED 携带，其他事件不得改写"));
});

test("签署事实必须带来源且不能为空", () => {
  const noSource = validEvent("CASE_SIGNED");
  noSource.facts = { diagnoses: [{ code: "C61.x00" }] };
  assert.ok(validateEvent(noSource).includes("facts.diagnoses[0] 缺少来源 source"));

  const empty = validEvent("CASE_SIGNED");
  empty.facts = {};
  assert.ok(validateEvent(empty).includes("facts 至少要有一条诊断、手术或治疗记录"));
});

test("归组提议：逐项解释必填，支付信息禁带", () => {
  const noExplanation = validEvent("GROUP_PROPOSED");
  noExplanation.candidates = [{ group_code: "G1" }];
  assert.ok(validateEvent(noExplanation).includes("candidates[0] 必须给出逐项解释 explanations"));

  const withPayment = validEvent("GROUP_PROPOSED");
  withPayment.amount_minor = 999;
  assert.ok(validateEvent(withPayment).includes("GROUP_PROPOSED 不得携带字段：amount_minor"));

  const ranked = validEvent("GROUP_PROPOSED");
  ranked.payment_rank = ["G2", "G1"];
  assert.ok(validateEvent(ranked).includes("GROUP_PROPOSED 不得携带字段：payment_rank"));
});

test("澄清提示：只指缺件，不给替代编码", () => {
  const suggested = validEvent("FACT_CLARIFICATION_REQUESTED");
  suggested.suggested_codes = ["60.5x02"];
  assert.ok(validateEvent(suggested).includes("FACT_CLARIFICATION_REQUESTED 不得携带字段：suggested_codes"));

  const noAffects = validEvent("FACT_CLARIFICATION_REQUESTED");
  noAffects.questions = [{ item_ref: "facts.procedures[0]", reason: "缺手术记录" }];
  assert.ok(
    validateEvent(noAffects).some((e) => e.includes("必须标明受影响的分组 affects")),
  );
});

test("复核路径限三类", () => {
  const errors = validateEvent({ ...validEvent("REVIEW_REQUESTED"), path: "revenue_first" });
  assert.deepEqual(errors, ["path 必须是 coding_conflict / rule_boundary / high_cost 之一"]);
});

test("结算决定：双重支付核查与依据留痕", () => {
  const noCheck = validEvent("DECISION_ISSUED");
  delete noCheck.duplicate_check;
  assert.ok(validateEvent(noCheck).includes("缺少字段：duplicate_check"));

  const waivedNoRef = validEvent("DECISION_ISSUED");
  waivedNoRef.duplicate_check = { result: "waived" };
  assert.ok(validateEvent(waivedNoRef).includes("双重支付风险豁免必须引用复核记录 duplicate_check.ref"));

  const exceptionNoRef = validEvent("DECISION_ISSUED");
  exceptionNoRef.basis = { type: "exception" };
  assert.ok(validateEvent(exceptionNoRef).includes("依据特例或申诉签发时必须填写 basis.ref"));
});

test("结算调整：差额分录非零且注明来源与批准", () => {
  const empty = validEvent("SETTLEMENT_ADJUSTED");
  empty.difference_entries = [];
  assert.ok(validateEvent(empty).includes("difference_entries 必须是非空数组（差额分录）"));

  const zero = validEvent("SETTLEMENT_ADJUSTED");
  zero.difference_entries = [{ item: "权重差", delta_minor: 0, reason: "无变化" }];
  assert.ok(validateEvent(zero).includes("difference_entries[0].delta_minor 必须是非零整数"));

  const noApproval = validEvent("SETTLEMENT_ADJUSTED");
  delete noApproval.approval_ref;
  assert.ok(validateEvent(noApproval).includes("缺少字段：approval_ref"));
});

test("双重支付风险：三分类且关联非空", () => {
  const badKind = validateEvent({ ...validEvent("DUPLICATE_RISK_FLAGGED"), kind: "maybe" });
  assert.deepEqual(badKind, ["kind 必须是 cross_hospital_referral / withdraw_resubmit / duplicate_claim 之一"]);

  const noLinks = validEvent("DUPLICATE_RISK_FLAGGED");
  noLinks.linked_case_ids = [];
  assert.ok(validateEvent(noLinks).includes("linked_case_ids 必须是非空数组（关联病例或申报）"));
});

test("特例与申诉保留材料", () => {
  const noMaterials = validEvent("EXCEPTION_REQUESTED");
  noMaterials.materials = [];
  assert.ok(validateEvent(noMaterials).includes("materials 必须是非空数组（材料引用）"));
});

test("接入记录沿用事件约定", () => {
  const badAction = validateEvent({ ...validEvent("ACCESS_RECORDED"), action: "delete" });
  assert.deepEqual(badAction, ["action 必须是 read / write / export 之一"]);

  assert.deepEqual(validateEvent(validEvent("ACCESS_RECORDED")), []);
});

test("各类合法事件通过校验", () => {
  for (const type of [
    "CASE_SIGNED",
    "GROUP_PROPOSED",
    "FACT_CLARIFICATION_REQUESTED",
    "REVIEW_REQUESTED",
    "DECISION_ISSUED",
    "SETTLEMENT_ADJUSTED",
    "DUPLICATE_RISK_FLAGGED",
    "EXCEPTION_REQUESTED",
    "ACCESS_RECORDED",
  ]) {
    assert.deepEqual(validateEvent(validEvent(type)), [], `${type} 应通过校验`);
  }
});
