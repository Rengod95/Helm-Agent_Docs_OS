import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  AgentsJudge,
  AgentsJudgeInput,
  AgentsJudgeKey,
  AgentsJudgeOutput,
  CAPABILITY_ID_PATTERN,
  ModelsComplete,
  ModelsCompleteInput,
  ModelsCompleteKey,
  ModelsCompleteOutput,
  validateCapability,
  type AnyCapabilityDef,
} from "../../src/capabilities/index.ts";
import {
  JUDGE_MAX_RUNS_DEFAULT,
  JUDGE_MAX_RUNS_SETTING,
} from "../../src/wire-settings/settings/index.ts";
import { rawId } from "../helpers/ids.ts";

// hooks-core-boundary §6.2 D-30. 목표 판정(`agents.judge`)과 모델 호출(`models.complete`) 기능의 모양을 값으로 고정한다.
// 두 기능 모두 멱등이고 읽기 전용이 아니다(토큰을 쓰므로 U-1 (다), 합성 도구 이름 `cap:<기능>.<메서드>`로 간다).

const DEFS: readonly AnyCapabilityDef[] = [AgentsJudge, ModelsComplete];

function judgeInput(extra: Record<string, unknown> = {}): unknown {
  return {
    threadId: rawId("thr", 1),
    turnId: rawId("trn", 2),
    stepId: rawId("stp", 3),
    goalRef: "g1",
    goal: { text: "Ship the fix", criteria: ["tests pass"] },
    evidence: [{ kind: "assistant_text", text: "I fixed it." }],
    ...extra,
  };
}

describe("agents.judge and models.complete definitions", () => {
  test("both pass the capability validator with no issues and have no model tools", () => {
    for (const def of DEFS) expect(validateCapability(def)).toEqual([]);
    expect(AgentsJudge.tools).toEqual([]);
    expect(ModelsComplete.tools).toEqual([]);
  });

  test("ids and versions match the spec and the service keys follow them", () => {
    expect(AgentsJudge.id).toBe("agents.judge");
    expect(ModelsComplete.id).toBe("models.complete");
    expect(AgentsJudge.version).toBe("1.0.0");
    expect(ModelsComplete.version).toBe("1.0.0");
    expect(new RegExp(CAPABILITY_ID_PATTERN).test(AgentsJudge.id)).toBe(true);
    expect(AgentsJudgeKey).toEqual({ capability: "agents.judge", version: "1.0.0" });
    expect(ModelsCompleteKey).toEqual({ capability: "models.complete", version: "1.0.0" });
  });

  test("each has one method: idempotent, replay safe, not read-only (it spends budget)", () => {
    expect(Object.keys(AgentsJudge.service.methods)).toEqual(["judge"]);
    expect(Object.keys(ModelsComplete.service.methods)).toEqual(["complete"]);
    for (const method of [
      AgentsJudge.service.methods.judge,
      ModelsComplete.service.methods.complete,
    ]) {
      expect(method).toMatchObject({ idempotent: true, replay: "safe" });
      expect(method.readOnly).toBeUndefined();
    }
  });

  test("the judge input is the JudgeInput shape: stepId may be null, unknown keys are refused", () => {
    expect(parse(AgentsJudgeInput, judgeInput()).ok).toBe(true);
    expect(parse(AgentsJudgeInput, judgeInput({ stepId: null })).ok).toBe(true);
    expect(parse(AgentsJudgeInput, judgeInput({ goalRef: "" })).ok).toBe(false);
    expect(parse(AgentsJudgeInput, judgeInput({ requestId: "r1" })).ok).toBe(false);
    expect(
      parse(AgentsJudgeInput, judgeInput({ evidence: [{ kind: "other", text: "x" }] })).ok,
    ).toBe(false);
  });

  test("the judge output accepts each outcome kind and refuses a judged outcome without its record", () => {
    const record = {
      goalRef: "g1",
      run: 1,
      verdict: "not_met",
      rationale: "tests not run",
      missing: ["tests pass"],
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      model: { provider: "test", modelId: "judge-tape" },
    };
    expect(parse(AgentsJudgeOutput, { kind: "judged", record }).ok).toBe(true);
    expect(
      parse(AgentsJudgeOutput, { kind: "recorded", record: { ...record, usage: null } }).ok,
    ).toBe(true);
    expect(parse(AgentsJudgeOutput, { kind: "capped", runs: 3, maxRuns: 3 }).ok).toBe(true);
    expect(parse(AgentsJudgeOutput, { kind: "failed", message: "no models" }).ok).toBe(true);
    expect(parse(AgentsJudgeOutput, { kind: "judged" }).ok).toBe(false);
    expect(parse(AgentsJudgeOutput, { kind: "capped", runs: 3 }).ok).toBe(false);
  });

  test("the model input is a message list with thread and optional label; plugin identity and signal are not in the payload", () => {
    const messages = [
      { role: "system", content: "Judge." },
      { role: "user", content: "Is it done?" },
    ];
    expect(parse(ModelsCompleteInput, { threadId: rawId("thr", 1), messages }).ok).toBe(true);
    expect(
      parse(ModelsCompleteInput, { threadId: rawId("thr", 1), messages, label: "check" }).ok,
    ).toBe(true);
    expect(parse(ModelsCompleteInput, { threadId: rawId("thr", 1), messages: [] }).ok).toBe(false);
    expect(
      parse(ModelsCompleteInput, { threadId: rawId("thr", 1), messages, plugin: { name: "x" } }).ok,
    ).toBe(false);
    expect(
      parse(ModelsCompleteInput, {
        threadId: rawId("thr", 1),
        messages: [{ role: "tool", content: "x" }],
      }).ok,
    ).toBe(false);
  });

  test("the model output carries the text, the usage (or null) and the stop reason", () => {
    const usage = { input: 6, output: 4, total: 10 };
    expect(parse(ModelsCompleteOutput, { text: "met", usage, stopReason: "stop" })).toEqual({
      ok: true,
      value: { text: "met", usage, stopReason: "stop" },
    });
    expect(parse(ModelsCompleteOutput, { text: "", usage: null, stopReason: "length" }).ok).toBe(
      true,
    );
    expect(parse(ModelsCompleteOutput, { text: "met", usage: null }).ok).toBe(false);
  });
});

describe("the judge limit setting declaration", () => {
  test("keeps the L1.agents key, default, range and scopes that core-agents used to declare", () => {
    expect(JUDGE_MAX_RUNS_DEFAULT).toBe(3);
    expect(JUDGE_MAX_RUNS_SETTING).toMatchObject({
      key: "l1.agents.judge.maxRuns",
      default: 3,
      range: { min: 1, max: 20 },
      runtimeChange: "nextTurn",
      allowedScopes: ["managed", "user", "project", "local", "launch"],
      since: "0.1.0",
    });
  });
});
