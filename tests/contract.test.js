import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGGREGATE_TYPES,
  EVENT_AGGREGATE,
  EVENT_TYPES,
} from "../src/contracts.js";
import { validateEvent, validateStream } from "../src/validator.js";

const readJson = (path) =>
  readFile(new URL(path, import.meta.url), "utf8").then(JSON.parse);

test("样例事件流符合领域约定且各聚合版本连续", async () => {
  const sample = await readJson("../data/sample.json");
  assert.ok(Array.isArray(sample), "样例应为有序事件流");
  assert.deepEqual(validateStream(sample), []);
});

test("schema 枚举与契约常量保持同步", async () => {
  const schema = await readJson("../contracts/domain.schema.json");
  assert.deepEqual(
    [...schema.properties.event_type.enum].sort(),
    [...EVENT_TYPES].sort(),
  );
  assert.deepEqual(
    [...schema.properties.aggregate_type.enum].sort(),
    [...AGGREGATE_TYPES].sort(),
  );
});

test("每个事件类型都有唯一归属聚合，且归属在聚合枚举内", () => {
  for (const eventType of EVENT_TYPES) {
    const aggregate = EVENT_AGGREGATE[eventType];
    assert.ok(aggregate, `${eventType} 缺少归属聚合`);
    assert.ok(
      AGGREGATE_TYPES.includes(aggregate),
      `${eventType} 归属了未知聚合 ${aggregate}`,
    );
  }
});

test("事件写到错误的聚合流上会被拒绝", () => {
  const errors = validateEvent({
    event_id: "x1",
    event_type: "FACT_CLARIFICATION_REQUESTED",
    aggregate_type: "inpatient_case",
    aggregate_id: "c1",
    occurred_at: "2026-09-16T08:45:00+08:00",
    version: 1,
    summary: "事实澄清只能挂在 review_task 上",
  });
  assert.ok(errors.some((m) => m.includes("只能归属聚合")));
});

test("版本跳跃与 event_id 重复会被拒绝", () => {
  const base = {
    aggregate_type: "review_task",
    aggregate_id: "rt-1",
    occurred_at: "2026-09-16T08:40:00+08:00",
    summary: "t",
  };
  const errors = validateStream([
    { ...base, event_id: "e1", event_type: "REVIEW_REQUESTED", version: 1 },
    { ...base, event_id: "e1", event_type: "FACT_CLARIFICATION_REQUESTED", version: 3 },
  ]);
  assert.ok(errors.some((m) => m.includes("event_id 重复")));
  assert.ok(errors.some((m) => m.includes("版本应为 2")));
});

test("不同聚合流各自从 1 计版本，互不干扰", () => {
  const errors = validateStream([
    {
      event_id: "a1",
      event_type: "REVIEW_REQUESTED",
      aggregate_type: "review_task",
      aggregate_id: "rt-a",
      occurred_at: "2026-09-16T08:40:00+08:00",
      version: 1,
      summary: "a",
    },
    {
      event_id: "b1",
      event_type: "CLAIM_SUBMITTED",
      aggregate_type: "claim",
      aggregate_id: "cl-b",
      occurred_at: "2026-09-16T09:00:00+08:00",
      version: 1,
      summary: "b",
    },
  ]);
  assert.deepEqual(errors, []);
});

test("非法时间与未知事件类型会被拒绝", () => {
  const errors = validateEvent({
    event_id: "x2",
    event_type: "RECODE_FOR_PAYMENT",
    aggregate_type: "signed_coding",
    aggregate_id: "sc-1",
    occurred_at: "not-a-time",
    version: 0,
    summary: "",
  });
  assert.ok(errors.some((m) => m.includes("未知事件类型")));
  assert.ok(errors.some((m) => m.includes("occurred_at")));
  assert.ok(errors.some((m) => m.includes("version")));
});
