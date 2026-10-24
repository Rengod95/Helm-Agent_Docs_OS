import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  PendingToolCallSchema,
  STEP_CHECKPOINT_SCHEMA_VERSION,
  StepCheckpointSchema,
} from "../../src/records/index.ts";
import { checkpoint, EFFECT, THREAD } from "./fixtures/payloads.ts";

describe("StepCheckpointSchema (acceptance 10)", () => {
  test("a good fixture passes", () => {
    expect(parse(StepCheckpointSchema, JSON.parse(JSON.stringify(checkpoint))).ok).toBe(true);
    expect(STEP_CHECKPOINT_SCHEMA_VERSION).toBe(1);
  });

  test("missing schemaVersion fails", () => {
    const { schemaVersion: _schemaVersion, ...rest } = checkpoint;
    expect(parse(StepCheckpointSchema, rest).ok).toBe(false);
  });

  test("negative stepIndex, bad next, wrong-prefix leafEventId fail", () => {
    expect(parse(StepCheckpointSchema, { ...checkpoint, stepIndex: -1 }).ok).toBe(false);
    expect(parse(StepCheckpointSchema, { ...checkpoint, next: "elsewhere" }).ok).toBe(false);
    expect(parse(StepCheckpointSchema, { ...checkpoint, leafEventId: THREAD }).ok).toBe(false);
  });

  test("every next value is accepted", () => {
    for (const next of ["request", "tools", "await_input", "turn_end"]) {
      expect(parse(StepCheckpointSchema, { ...checkpoint, next }).ok).toBe(true);
    }
  });

  test("thinking levels include off", () => {
    expect(
      parse(StepCheckpointSchema, {
        ...checkpoint,
        model: { provider: "p", modelId: "m", thinkingLevel: "off" },
      }).ok,
    ).toBe(true);
    expect(
      parse(StepCheckpointSchema, {
        ...checkpoint,
        model: { provider: "p", modelId: "m", thinkingLevel: "extreme" },
      }).ok,
    ).toBe(false);
  });
});

describe("PendingToolCall", () => {
  test("effectId may be null before intent, waiting kinds", () => {
    for (const waiting of ["approval", "input_required", "deferred", null]) {
      expect(parse(PendingToolCallSchema, { toolCallId: "c", effectId: null, waiting }).ok).toBe(
        true,
      );
    }
    expect(
      parse(PendingToolCallSchema, { toolCallId: "c", effectId: EFFECT, waiting: "other" }).ok,
    ).toBe(false);
  });
});
