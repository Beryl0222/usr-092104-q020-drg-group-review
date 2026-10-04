import {
  AGGREGATE_TYPES,
  EVENT_AGGREGATE,
  EVENT_TYPES,
  REQUIRED_FIELDS,
} from "./contracts.js";

// 校验单条事件信封。返回中文错误信息数组，空数组表示通过。
export function validateEvent(record) {
  const errors = REQUIRED_FIELDS.filter(
    (name) => !(name in record),
  ).map((name) => `缺少字段：${name}`);

  if (
    "version" in record &&
    (!Number.isInteger(record.version) || record.version < 1)
  ) {
    errors.push("version 必须是正整数");
  }
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未知事件类型：${record.event_type}`);
  }
  if (
    "aggregate_type" in record &&
    !AGGREGATE_TYPES.includes(record.aggregate_type)
  ) {
    errors.push(`未知聚合类型：${record.aggregate_type}`);
  }
  if (
    "event_type" in record &&
    "aggregate_type" in record &&
    EVENT_AGGREGATE[record.event_type] &&
    EVENT_AGGREGATE[record.event_type] !== record.aggregate_type
  ) {
    errors.push(
      `事件 ${record.event_type} 只能归属聚合 ${EVENT_AGGREGATE[record.event_type]}，实际为 ${record.aggregate_type}`,
    );
  }
  if (
    "occurred_at" in record &&
    Number.isNaN(Date.parse(record.occurred_at))
  ) {
    errors.push("occurred_at 必须是合法的 date-time");
  }
  return errors;
}

// 校验同一聚合流上的有序事件：版本从 1 起严格递增，事件 ID 不重复。
// 不同聚合各自成流，互不比较版本。
export function validateStream(events) {
  const errors = [];
  const seenEventIds = new Set();
  const versions = new Map();

  for (const [index, event] of events.entries()) {
    const where = `第${index + 1}条(${event.event_id ?? event.event_type ?? "未知"})`;
    for (const message of validateEvent(event)) {
      errors.push(`${where}：${message}`);
    }
    if (event.event_id) {
      if (seenEventIds.has(event.event_id)) {
        errors.push(`${where}：event_id 重复，事件必须幂等可重放`);
      }
      seenEventIds.add(event.event_id);
    }
    if (event.aggregate_id && Number.isInteger(event.version)) {
      const last = versions.get(event.aggregate_id) ?? 0;
      if (event.version !== last + 1) {
        errors.push(
          `${where}：聚合 ${event.aggregate_id} 版本应为 ${last + 1}，实际为 ${event.version}`,
        );
      }
      versions.set(event.aggregate_id, event.version);
    }
  }
  return errors;
}
