import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { AGGREGATE_TYPES, EVENT_TYPES, validateEvent } from "../src/validator.js";

const schema = JSON.parse(await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"));

test("样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("契约枚举与校验器一致", () => {
  assert.deepEqual([...schema.properties.event_type.enum].sort(), [...EVENT_TYPES].sort());
  assert.deepEqual([...schema.properties.aggregate_type.enum].sort(), [...AGGREGATE_TYPES].sort());
});

test("联调样例集全部通过校验", async () => {
  const dir = new URL("../data/examples/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  assert.ok(files.length >= 13, "每种事件类型都应有一条联调样例");
  for (const file of files) {
    const record = JSON.parse(await readFile(new URL(file, dir), "utf8"));
    assert.deepEqual(validateEvent(record), [], `${file} 应通过校验`);
  }
});
