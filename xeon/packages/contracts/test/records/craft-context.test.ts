import { expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  CORE_EVENT_CATALOG,
  CraftContextPayloadSchema,
  catalogEntry,
  type CraftContextPayload,
} from "../../src/records/index.ts";

// `craft.context`(M5c §4.8.8): 테스트 대화를 연 사실과 맥락 참조. 참조는 판별 유니온이고 의도는 한 줄이다.

const SHAPE: CraftContextPayload = {
  refs: [
    { kind: "plugin", name: "demo" },
    { kind: "finding", findingId: "fnd_1" },
    { kind: "review", itemId: "rvw_1" },
  ],
  intent: "올리기",
};

test("craft.context: a payload with plugin, finding and review refs and an intent parses to the same value", () => {
  const read = parse(CraftContextPayloadSchema, SHAPE);
  expect(read).toEqual({ ok: true, value: SHAPE });
});

test("craft.context: no intent is null, and the refs may be empty", () => {
  expect(parse(CraftContextPayloadSchema, { refs: [], intent: null })).toEqual({
    ok: true,
    value: { refs: [], intent: null },
  });
});

test("craft.context: an unknown ref kind, an empty intent, an extra field and seventeen refs are all refused", () => {
  const refused = [
    { refs: [{ kind: "thread", threadId: "thr_1" }], intent: null },
    { refs: [], intent: "" },
    { refs: [], intent: null, extra: true },
    {
      refs: Array.from({ length: 17 }, (_, index) => ({
        kind: "plugin",
        name: `p${String(index)}`,
      })),
      intent: null,
    },
  ];
  for (const value of refused) {
    expect(parse(CraftContextPayloadSchema, value).ok).toBe(false);
  }
});

test("craft.context: the catalog entry is a durable state event in the craft area", () => {
  expect(catalogEntry("craft.context").durable).toBe(true);
  expect(CORE_EVENT_CATALOG.map((entry) => entry.kind).at(-1)).toBe("craft.context");
  expect(catalogEntry("craft.context").payload).toBe(CraftContextPayloadSchema);
});
