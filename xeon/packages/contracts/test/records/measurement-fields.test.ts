import { expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  StepCompletedPayloadSchema,
  type StepContextWarning,
} from "../../src/conversation/index.ts";
import { CompactedPayloadSchema } from "../../src/records/catalog/thread.ts";
import { rawId } from "../helpers/ids.ts";

// T-MEAS-EV: 선택 필드만 더했으므로 저장된 옛 이벤트가 그대로 읽히고, 새 필드는 값 그대로 돌아온다.

const EVENT = rawId("evt", 1);
const ITEM = rawId("itm", 1);

const OLD_COMPACTED = {
  summary: "요약",
  firstKeptEventId: EVENT,
  tokensBefore: 9000,
  details: null,
  usage: null,
  fromExtension: null,
};

test("thread.compacted stored without tokensAfter and reason is still readable", () => {
  const checked = parse(CompactedPayloadSchema, OLD_COMPACTED);
  expect(checked.ok).toBe(true);
  if (checked.ok) {
    expect(checked.value.tokensAfter).toBeUndefined();
    expect(checked.value.reason).toBeUndefined();
  }
});

test("thread.compacted carries tokensAfter and reason as given", () => {
  const checked = parse(CompactedPayloadSchema, {
    ...OLD_COMPACTED,
    tokensAfter: 1200,
    reason: "threshold",
  });
  expect(checked.ok).toBe(true);
  if (checked.ok)
    expect([checked.value.tokensAfter, checked.value.reason]).toEqual([1200, "threshold"]);
  expect(parse(CompactedPayloadSchema, { ...OLD_COMPACTED, reason: "other" }).ok).toBe(false);
  expect(parse(CompactedPayloadSchema, { ...OLD_COMPACTED, tokensAfter: -1 }).ok).toBe(false);
});

const OLD_STEP = {
  stepIndex: 0,
  status: "completed",
  stopReason: "stop",
  assistantItemId: ITEM,
  toolResultItemIds: [],
};

test("step.completed stored without contextWarnings is still readable", () => {
  expect(parse(StepCompletedPayloadSchema, OLD_STEP).ok).toBe(true);
});

test("step.completed keeps the context warnings of the step, one shape per code", () => {
  const contextWarnings: StepContextWarning[] = [
    { code: "cache_prefix_reset", at: 0 },
    { code: "cache_reset_model_switch", from: "anthropic/a", to: "openai/b" },
    { code: "tools_deferred", added: ["x"], removed: [] },
    { code: "near_window", tokens: 900, contextWindow: 1000 },
  ];
  const checked = parse(StepCompletedPayloadSchema, { ...OLD_STEP, contextWarnings });
  expect(checked.ok).toBe(true);
  if (checked.ok) expect(checked.value.contextWarnings).toEqual(contextWarnings);
  expect(
    parse(StepCompletedPayloadSchema, { ...OLD_STEP, contextWarnings: [{ code: "unknown" }] }).ok,
  ).toBe(false);
});
