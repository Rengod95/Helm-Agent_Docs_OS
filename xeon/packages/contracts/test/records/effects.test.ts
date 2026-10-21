import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  NOT_STARTED_TEXT,
  OUTCOME_UNKNOWN_TEXT,
  ReplayPolicySchema,
  EffectExecSchema,
  EffectIntentSchema,
  EffectResultSchema,
  decideEffectRecovery,
  toReplayPolicy,
  type EffectExec,
  type EffectIntent,
  type EffectResult,
  type ReplayPolicy,
} from "../../src/records/index.ts";
import * as conversation from "../../src/conversation/index.ts";
import { effectExec, effectIntent, effectResult } from "./fixtures/payloads.ts";

function intent(replay: ReplayPolicy): EffectIntent {
  const parsed = parse(EffectIntentSchema, { ...effectIntent, replay });
  if (!parsed.ok) throw new Error("fixture");
  return parsed.value;
}

function exec(): EffectExec {
  const parsed = parse(EffectExecSchema, effectExec);
  if (!parsed.ok) throw new Error("fixture");
  return parsed.value;
}

function result(): EffectResult {
  const parsed = parse(EffectResultSchema, effectResult);
  if (!parsed.ok) throw new Error("fixture");
  return parsed.value;
}

describe("replay re-export (acceptance 5)", () => {
  test("records re-exports the conversation symbols by reference", () => {
    expect(ReplayPolicySchema).toBe(conversation.ReplayPolicySchema);
    expect(toReplayPolicy).toBe(conversation.toReplayPolicy);
  });
});

describe("decideEffectRecovery decision table (acceptance 4)", () => {
  test("a recorded result needs nothing", () => {
    expect(
      decideEffectRecovery({
        intent: intent("safe"),
        exec: exec(),
        result: result(),
        currentReplay: "safe",
      }),
    ).toEqual({ action: "none" });
  });

  test("intent only, safe on both sides: rerun", () => {
    const i = intent("safe");
    expect(
      decideEffectRecovery({ intent: i, exec: null, result: null, currentReplay: "safe" }),
    ).toEqual({
      action: "rerun",
      intent: i,
    });
  });

  test("exec recorded, safe on both sides: rerun", () => {
    const i = intent("safe");
    expect(
      decideEffectRecovery({ intent: i, exec: exec(), result: null, currentReplay: "safe" }),
    ).toEqual({
      action: "rerun",
      intent: i,
    });
  });

  test("intent only and unsafe: synthesize not_started / abandoned", () => {
    const i = intent("unsafe");
    const out = decideEffectRecovery({
      intent: i,
      exec: null,
      result: null,
      currentReplay: "unsafe",
    });
    expect(out.action).toBe("synthesize");
    if (out.action === "synthesize") {
      expect(out.code).toBe("not_started");
      expect(out.result.status).toBe("abandoned");
      expect(out.content).toBe(NOT_STARTED_TEXT);
    }
  });

  test("exec recorded and unsafe: synthesize outcome_unknown / interrupted", () => {
    const i = intent("unsafe");
    const out = decideEffectRecovery({
      intent: i,
      exec: exec(),
      result: null,
      currentReplay: "unsafe",
    });
    expect(out.action).toBe("synthesize");
    if (out.action === "synthesize") {
      expect(out.code).toBe("outcome_unknown");
      expect(out.result.status).toBe("interrupted");
      expect(out.content).toBe(OUTCOME_UNKNOWN_TEXT);
    }
  });

  test("stored safe but currently unsafe, or the tool is gone (null): synthesize", () => {
    const i = intent("safe");
    expect(
      decideEffectRecovery({ intent: i, exec: null, result: null, currentReplay: "unsafe" }).action,
    ).toBe("synthesize");
    expect(
      decideEffectRecovery({ intent: i, exec: exec(), result: null, currentReplay: null }).action,
    ).toBe("synthesize");
    expect(
      decideEffectRecovery({
        intent: intent("unsafe"),
        exec: null,
        result: null,
        currentReplay: "safe",
      }).action,
    ).toBe("synthesize");
  });
});

describe("purity", () => {
  test("same input, same output, input untouched (frozen)", () => {
    const input = Object.freeze({
      intent: Object.freeze(intent("unsafe")),
      exec: Object.freeze(exec()),
      result: null,
      currentReplay: "unsafe" as const,
    });
    const first = decideEffectRecovery(input);
    const second = decideEffectRecovery(input);
    expect(first).toEqual(second);
  });

  test("a synthesized result is marked and passes its schema", () => {
    const out = decideEffectRecovery({
      intent: intent("unsafe"),
      exec: exec(),
      result: null,
      currentReplay: "unsafe",
    });
    if (out.action !== "synthesize") throw new Error("expected synthesize");
    expect(out.result.synthesized).toBe(true);
    expect(out.result.output).toBeNull();
    expect(out.result.effectId).toBe(intent("unsafe").effectId);
    expect(parse(EffectResultSchema, JSON.parse(JSON.stringify(out.result))).ok).toBe(true);
  });

  test("the fixed texts match the spec", () => {
    expect(OUTCOME_UNKNOWN_TEXT).toBe(
      "The tool call was interrupted before its result was recorded. It may have taken effect. Check the current state before retrying.",
    );
    expect(NOT_STARTED_TEXT).toBe(
      "The tool call was interrupted before it started. It had no effect.",
    );
  });
});

describe("effect schemas", () => {
  test("blob args are allowed, bad hashes are not", () => {
    const blobArgs = { type: "blob", sha256: "b".repeat(64), size: 3, mediaType: null };
    expect(parse(EffectIntentSchema, { ...effectIntent, args: blobArgs }).ok).toBe(true);
    expect(parse(EffectIntentSchema, { ...effectIntent, argsHash: "xyz" }).ok).toBe(false);
    expect(parse(EffectIntentSchema, { ...effectIntent, replay: "never" }).ok).toBe(false);
  });

  test("result status set", () => {
    for (const status of ["ok", "error", "interrupted", "abandoned"]) {
      expect(parse(EffectResultSchema, { ...effectResult, status }).ok).toBe(true);
    }
    expect(parse(EffectResultSchema, { ...effectResult, status: "unknown" }).ok).toBe(false);
  });
});
