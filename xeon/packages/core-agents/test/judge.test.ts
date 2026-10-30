import { describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { AgentJudgedPayloadSchema, type AgentJudgedPayload } from "@xeon/contracts/records";
import type { JudgeInput } from "@xeon/contracts/services";
import { completeStructured, goalGateDecision, JudgeAnswerSchema } from "../src/index.ts";
import { fakeModels, type FakeReply } from "./support/fake-models.ts";
import { openHarness, type Harness } from "./support/harness.ts";

const MET: FakeReply = {
  kind: "tool",
  arguments: { verdict: "met", rationale: "all criteria shown", missing: [] },
};
const NOT_MET: FakeReply = {
  kind: "tool",
  arguments: { verdict: "not_met", rationale: "tests not run", missing: ["tests pass"] },
};

function inputOf(h: Harness, goalRef: string = "goal-1"): JudgeInput {
  return {
    threadId: h.parentThreadId,
    turnId: h.ids.next("trn"),
    goalRef,
    goal: { text: "Ship the fix", criteria: ["tests pass"] },
    evidence: [{ kind: "assistant_text", text: "I fixed it." }],
  };
}

function judgedEvents(h: Harness): AgentJudgedPayload[] {
  return h.session.events
    .filter((event) => event.kind === "agent.judged")
    .flatMap((event) => {
      const parsed = parse(AgentJudgedPayloadSchema, event.payload);
      return parsed.ok ? [parsed.value] : [];
    });
}

describe("judge", () => {
  test("a judgement is recorded as agent.judged on the judged conversation", async () => {
    const models = fakeModels([NOT_MET]);
    const h = openHarness({ models });
    const input = inputOf(h);
    const outcome = await h.service.judge(input);
    expect(outcome.kind).toBe("judged");
    if (outcome.kind !== "judged") return;
    expect(outcome.record).toMatchObject({
      goalRef: "goal-1",
      run: 1,
      verdict: "not_met",
      missing: ["tests pass"],
      model: { provider: "test", modelId: "judge-tape" },
    });
    expect(outcome.record.usage?.totalTokens).toBe(15);
    const recorded: readonly unknown[] = judgedEvents(h);
    expect(recorded).toEqual([outcome.record]);
    const event = h.session.events.find((e) => e.kind === "agent.judged");
    expect(event).toMatchObject({ threadId: h.parentThreadId, turnId: input.turnId });
    // 판정 호출: 역할 judge, 무도구 단발이 아니라 구조화 도구 하나, 증거가 프롬프트에 있다
    expect(models.calls).toHaveLength(1);
    expect(models.calls[0]).toMatchObject({ role: "judge" });
    expect(JSON.stringify(models.calls[0]?.context.messages)).toContain("I fixed it.");
  });

  test("judge_stops_at_max_runs: the run after the cap does not call the model", async () => {
    const models = fakeModels([NOT_MET, NOT_MET, MET]);
    const h = openHarness({ models, judgeMaxRuns: 2 });
    expect((await h.service.judge(inputOf(h))).kind).toBe("judged");
    expect((await h.service.judge(inputOf(h))).kind).toBe("judged");
    const third = await h.service.judge(inputOf(h));
    expect(third).toEqual({ kind: "capped", runs: 2, maxRuns: 2 });
    expect(models.calls).toHaveLength(2);
    expect(judgedEvents(h).map((record) => record.run)).toEqual([1, 2]);
    // 다른 목표는 따로 센다
    expect((await h.service.judge(inputOf(h, "goal-2"))).kind).toBe("judged");
    // 완료 게이트: 상한이면 turn을 끝내고 알린다
    const gate = goalGateDecision(third);
    expect(gate).toMatchObject({ continue: false, reason: "capped" });
    expect(gate.notice).toContain("2 runs");
  });

  test("judge_cap_reads_the_judged_thread: a session scope value for that thread sets the cap", async () => {
    const models = fakeModels([NOT_MET, NOT_MET, NOT_MET, NOT_MET]);
    const sessionThreads = new Set<string>();
    const h = openHarness({
      models,
      agentsSettings: {
        maxDepth: () => 1,
        maxConcurrent: () => 8,
        resultMaxChars: () => 24_000,
        // 세션 범위 값은 그 thread에서만 3이고, 그 밖은 기본 2다
        judgeMaxRuns: (threadId) => (sessionThreads.has(threadId) ? 3 : 2),
      },
    });
    sessionThreads.add(h.parentThreadId);
    const runOf = (outcome: Awaited<ReturnType<typeof h.service.judge>>) =>
      outcome.kind === "judged" ? outcome.record.run : outcome.kind;
    expect(runOf(await h.service.judge(inputOf(h)))).toBe(1);
    expect(runOf(await h.service.judge(inputOf(h)))).toBe(2);
    expect(runOf(await h.service.judge(inputOf(h)))).toBe(3);
    expect(await h.service.judge(inputOf(h))).toEqual({ kind: "capped", runs: 3, maxRuns: 3 });
    expect(models.calls).toHaveLength(3);
  });

  test("a repeated judge call for the same step returns the recorded judgement without asking the model again", async () => {
    const models = fakeModels([NOT_MET, MET]);
    const h = openHarness({ models });
    const stepId = h.ids.next("stp");
    const input: JudgeInput = { ...inputOf(h), stepId };
    const first = await h.service.judge(input);
    expect(first.kind).toBe("judged");
    const again = await h.service.judge(input);
    expect(again.kind).toBe("recorded");
    if (first.kind !== "judged" || again.kind !== "recorded") return;
    expect(again.record).toEqual(first.record);
    expect(models.calls).toHaveLength(1);
    expect(judgedEvents(h).map((record) => record.run)).toEqual([1]);
    // 다른 단계의 판정은 같은 목표라도 다시 센다
    const other = await h.service.judge({ ...inputOf(h), stepId: h.ids.next("stp") });
    expect(other).toMatchObject({ kind: "judged", record: { run: 2 } });
    expect(models.calls).toHaveLength(2);
  });

  test("a judge failure stops: failed outcome, no record, not counted, gate does not continue", async () => {
    const models = fakeModels([{ kind: "error", message: "provider down" }, MET]);
    const h = openHarness({ models, judgeMaxRuns: 1 });
    const failed = await h.service.judge(inputOf(h));
    expect(failed).toEqual({ kind: "failed", message: "provider down" });
    expect(judgedEvents(h)).toEqual([]);
    expect(goalGateDecision(failed)).toMatchObject({ continue: false, reason: "failed" });
    // 실패는 실행 수에 넣지 않아 상한 1에서도 다음 호출이 판정한다
    const next = await h.service.judge(inputOf(h));
    expect(next.kind).toBe("judged");
    expect(goalGateDecision(next)).toMatchObject({ continue: false, reason: "met" });
  });

  test("an unresolved judge role or a missing xeon.models is a failure too", async () => {
    const noRole = openHarness({ models: fakeModels([MET], { noModel: true }) });
    expect(await noRole.service.judge(inputOf(noRole))).toMatchObject({
      kind: "failed",
      message: "models.no_model_for_role",
    });
    const noModels = openHarness();
    expect(await noModels.service.judge(inputOf(noModels))).toMatchObject({ kind: "failed" });
  });

  test("a schema violation is undecidable, is not re-asked, and counts as a run", async () => {
    const models = fakeModels([{ kind: "text", text: "looks fine to me" }, MET]);
    const h = openHarness({ models });
    const outcome = await h.service.judge(inputOf(h));
    expect(outcome).toMatchObject({ kind: "judged", record: { verdict: "undecidable", run: 1 } });
    expect(models.calls).toHaveLength(1);
    expect(goalGateDecision(outcome)).toMatchObject({ continue: true, reason: "undecidable" });
  });

  test("a gate decision continues with an instruction while the goal is not met", () => {
    const decision = goalGateDecision({
      kind: "judged",
      record: {
        goalRef: "g",
        run: 1,
        verdict: "not_met",
        rationale: "tests not run",
        missing: ["tests pass"],
        usage: null,
        model: { provider: "test", modelId: "m" },
      },
    });
    expect(decision.continue).toBe(true);
    expect(decision.instruction).toContain("tests pass");
  });
});

function request(h: Harness, maxAttempts?: number) {
  return {
    role: "judge" as const,
    threadId: h.parentThreadId,
    turnId: null,
    schema: JudgeAnswerSchema,
    system: "judge",
    prompt: "p",
    now: 1,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  };
}

describe("completeStructured", () => {
  test("reads the tool call arguments, or a JSON text answer, and validates them", async () => {
    const h = openHarness();
    const viaTool = await completeStructured(fakeModels([MET]), request(h));
    expect(viaTool).toMatchObject({ ok: true, value: { value: { verdict: "met" } } });
    const viaText = await completeStructured(
      fakeModels([
        {
          kind: "text",
          text: '```json\n{"verdict":"not_met","rationale":"r","missing":["a"]}\n```',
        },
      ]),
      request(h),
    );
    expect(viaText).toMatchObject({ ok: true, value: { value: { missing: ["a"] } } });
  });

  test("retries with the rejection reason up to maxAttempts and sums usage", async () => {
    const h = openHarness();
    const models = fakeModels([{ kind: "text", text: "no json" }, MET]);
    const result = await completeStructured(models, request(h, 2));
    expect(result).toMatchObject({ ok: true, value: { attempts: 2, usage: { totalTokens: 30 } } });
    expect(JSON.stringify(models.calls[1]?.context.messages)).toContain("rejected");
    const exhausted = await completeStructured(
      fakeModels([
        { kind: "text", text: "a" },
        { kind: "text", text: "b" },
      ]),
      request(h, 2),
    );
    expect(exhausted).toMatchObject({ ok: false, error: { kind: "schema_violation" } });
  });
});
