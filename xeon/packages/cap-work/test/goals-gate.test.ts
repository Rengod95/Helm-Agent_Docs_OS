import { afterEach, describe, expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import { gateAnswers } from "./support/gate.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { readGoals, readJudgments, readReports } from "../src/projection/read.ts";
import { gid, usage } from "./support/goals.ts";
import { GOAL_CONTINUE_TYPE, GOAL_NOTICE_TYPE } from "../src/goals/gate.ts";
import type { JudgeOutcome } from "@xeon/contracts/services";
import { CustomItemRecordSchema } from "@xeon/contracts/conversation";
import { DurableEventEnvelopeSchema } from "@xeon/contracts/records";

// M3-new-02, D-M3-15, L2.work.spec §4.3. `boundary.settle.before` 완료 게이트: 판정 결과를 goalGateDecision으로 옮겨 turn을 잇거나 끝낸다.

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

async function open(maxRuns = 3): Promise<Harness> {
  opened = await openHarness({ maxRuns });
  return opened;
}

function judgedRecord() {
  const outcome = judged(1, "not_met");
  if (outcome.kind !== "judged") throw new Bug("the fixture is a judged outcome");
  return outcome.record;
}

function judged(
  run: number,
  verdict: "met" | "not_met" | "undecidable",
  extra: { rationale?: string; missing?: string[] } = {},
): JudgeOutcome {
  return {
    kind: "judged",
    record: {
      goalRef: "g1",
      run,
      verdict,
      rationale: extra.rationale ?? `verdict ${verdict}`,
      missing: extra.missing ?? [],
      usage: usage(30, 5, 0.1),
      model: { provider: "p", modelId: "judge-model" },
    },
  };
}

function goalState(h: Harness) {
  const read = readGoals(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value.map((row): [string, string, number] => [
    String(row.goal.goalId),
    row.goal.status,
    row.goal.judgments,
  ]);
}

function judgments(h: Harness) {
  const read = readJudgments(h.store.service.scoped("cap.work"), h.threadId, gid("g1"));
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value.map((row) => row.judgment);
}

function reports(h: Harness) {
  const read = readReports(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value;
}

/** 항목의 지시나 안내 문장. 엔트리가 custom 항목이 아니면 시험 결함이다 */
function customOf(entry: { readonly payload: unknown }): { customType: string; content: unknown } {
  const payload = entry.payload;
  if (typeof payload !== "object" || payload === null || !("item" in payload)) {
    throw new Bug("the entry holds no item");
  }
  const item = parse(CustomItemRecordSchema, payload.item);
  if (!item.ok) throw new Bug("the entry item is not a custom item", { cause: item.error });
  return { customType: item.value.message.customType, content: item.value.message.content };
}

describe("a goal that is not met", () => {
  test("not_met keeps the goal active, records the judgment and continues with the missing criteria as an instruction", async () => {
    const h = await open();
    const rig = gateAnswers(h, [
      judged(1, "not_met", { rationale: "Tests are missing.", missing: ["tests"] }),
    ]);
    await h.goals.set(
      { condition: "all tests pass", judge: { kind: "model", rubric: ["tests exist"] } },
      h.opts(),
    );
    const patch = await rig.settle();

    expect(patch?.continue).toBe(true);
    const [entry] = patch?.entries ?? [];
    expect(entry && customOf(entry)).toEqual({
      customType: GOAL_CONTINUE_TYPE,
      content:
        "The goal is not yet shown to be met. Tests are missing. Missing: tests. Continue working, and show evidence for each criterion.",
    });
    expect(goalState(h)).toEqual([["g1", "active", 1]]);
    expect(judgments(h)).toMatchObject([
      {
        n: 1,
        verdict: { met: false, reason: "Tests are missing.", missing: ["tests"] },
        judgeKind: "model",
      },
    ]);
    expect(reports(h)).toEqual([]);
  });

  test("the judge gets the goal, the rubric and the evidence of the turn", async () => {
    const h = await open();
    const rig = gateAnswers(h, [judged(1, "undecidable")]);
    await h.goals.set(
      { condition: "ship it", judge: { kind: "model", rubric: ["built", "tested"] } },
      h.opts(),
    );
    await h.api.create({ content: "write tests" }, h.opts());
    const patch = await rig.settle();

    expect(patch?.continue).toBe(true);
    expect(rig.calls).toHaveLength(1);
    expect(rig.calls[0]).toMatchObject({
      threadId: h.threadId,
      goalRef: "g1",
      goal: { text: "ship it", criteria: ["built", "tested"] },
    });
    expect(rig.calls[0]?.evidence).toEqual([
      { kind: "assistant_text", text: "I finished the work." },
      { kind: "tool_result", text: "bash: ok" },
      { kind: "tool_result", text: "read: error" },
      { kind: "work_item", text: "t1 [pending] write tests", ref: { workRef: "t1" } },
    ]);
  });

  test("an entry kept from another handler stays and the new entry follows it", async () => {
    const h = await open();
    const rig = gateAnswers(h, [judged(1, "not_met")]);
    await h.goals.set({ condition: "x" }, h.opts());
    const other = rig.noticeEntry();
    const patch = await rig.settle({ entries: [other] });
    expect(patch?.entries).toHaveLength(2);
    expect(patch?.entries?.[0]).toBe(other);
    const second = patch?.entries?.[1];
    expect(second && customOf(second).customType).toBe(GOAL_CONTINUE_TYPE);
  });

  test("the instruction entry is a valid durable draft for the last step of the turn", async () => {
    const h = await open();
    const rig = gateAnswers(h, [judged(1, "not_met")]);
    await h.goals.set({ condition: "x" }, h.opts());
    const patch = await rig.settle();
    const [entry] = patch?.entries ?? [];
    expect(
      parse(DurableEventEnvelopeSchema, { ...entry, seq: 1, recordedAt: 0, parentId: null }).ok,
    ).toBe(true);
    expect(entry).toMatchObject({
      kind: "item.recorded",
      threadId: h.threadId,
      turnId: rig.turnId,
      stepId: rig.stepId,
      durable: true,
    });
  });
});

describe("a goal that is met", () => {
  test("met settles the goal, builds the report in the same commit and lets the turn settle", async () => {
    const h = await open();
    const rig = gateAnswers(h, [judged(1, "met", { rationale: "Everything is shown." })]);
    await h.goals.set({ condition: "x" }, h.opts());
    const patch = await rig.settle();

    expect(patch).toBeUndefined();
    expect(goalState(h)).toEqual([["g1", "met", 1]]);
    const [report] = reports(h);
    expect(report).toMatchObject({
      outcome: "met",
      summary: "Everything is shown.",
      resources: { judgments: 1, judge: { inputTokens: 30, outputTokens: 5, costUsd: 0.1 } },
    });
  });
});

describe("the judge limit", () => {
  test("capped ends the turn with a notice and settles the goal as limit_reached without a judgment record", async () => {
    const h = await open();
    const rig = gateAnswers(h, [{ kind: "capped", runs: 3, maxRuns: 3 }]);
    await h.goals.set({ condition: "x" }, h.opts());
    const patch = await rig.settle();

    expect(patch?.continue).toBe(false);
    const [entry] = patch?.entries ?? [];
    expect(entry && customOf(entry)).toEqual({
      customType: GOAL_NOTICE_TYPE,
      content: "The goal judge reached its limit of 3 runs, so the turn ended without a verdict.",
    });
    expect(goalState(h)).toEqual([["g1", "limit_reached", 0]]);
    expect(judgments(h)).toEqual([]);
    expect(reports(h)).toMatchObject([{ outcome: "limit_reached" }]);
  });

  test("a not-met verdict on the last allowed run settles the goal now and ends the turn instead of waiting for a capped answer", async () => {
    const h = await open(2);
    const rig = gateAnswers(h, [judged(1, "not_met"), judged(2, "not_met", { missing: ["docs"] })]);
    await h.goals.set({ condition: "x" }, h.opts());
    const first = await rig.settle();
    expect(first?.continue).toBe(true);

    const last = await rig.settle();
    expect(last?.continue).toBe(false);
    const [entry] = last?.entries ?? [];
    expect(entry && customOf(entry)).toEqual({
      customType: GOAL_NOTICE_TYPE,
      content:
        "The goal judge reached its limit of 2 runs, so the turn ended without meeting the goal.",
    });
    expect(goalState(h)).toEqual([["g1", "limit_reached", 2]]);
    expect(reports(h)).toMatchObject([
      { outcome: "limit_reached", remaining: { missing: ["docs"] } },
    ]);
    // 끝난 목표는 다시 판정하지 않는다
    expect(await rig.settle()).toBeUndefined();
    expect(rig.calls).toHaveLength(2);
  });
});

describe("a judge failure stops", () => {
  test("failed settles the goal as judge_failed, ends the turn with a notice and never keeps going without a judgment", async () => {
    const h = await open();
    const rig = gateAnswers(h, [{ kind: "failed", message: "xeon.models is not available" }]);
    await h.goals.set({ condition: "x" }, h.opts());
    const patch = await rig.settle();

    expect(patch?.continue).toBe(false);
    const [entry] = patch?.entries ?? [];
    expect(entry && customOf(entry)).toEqual({
      customType: GOAL_NOTICE_TYPE,
      content: "The goal judge failed (xeon.models is not available), so the turn stopped.",
    });
    expect(goalState(h)).toEqual([["g1", "judge_failed", 0]]);
    expect(reports(h)).toMatchObject([
      { outcome: "judge_failed", summary: "xeon.models is not available" },
    ]);
  });

  test("a judge that throws and a missing xeon.agents are failures too", async () => {
    const h = await open();
    const throwing = gateAnswers(h, [new Error("boom")]);
    await h.goals.set({ condition: "x" }, h.opts());
    const patch = await throwing.settle();
    expect(patch?.continue).toBe(false);
    expect(goalState(h)).toEqual([["g1", "judge_failed", 0]]);

    await h.goals.set({ condition: "y" }, h.opts());
    const absent = gateAnswers(h, "absent");
    const second = await absent.settle();
    expect(second?.continue).toBe(false);
    expect(goalState(h)).toEqual([
      ["g1", "judge_failed", 0],
      ["g2", "judge_failed", 0],
    ]);
  });
});

describe("when the gate stays out of the way", () => {
  test("no goal, an aborted turn, a delegated goal and a goal cleared during the judgment are left alone", async () => {
    const h = await open();
    const rig = gateAnswers(h, [judged(1, "not_met")]);
    expect(await rig.settle()).toBeUndefined();
    expect(rig.calls).toHaveLength(0);

    await h.goals.set({ condition: "x" }, h.opts());
    expect(await rig.settle({ outcome: "aborted" })).toBeUndefined();
    expect(await rig.settle({ outcome: "error" })).toBeUndefined();
    expect(rig.calls).toHaveLength(0);
    await h.goals.clear({}, h.opts());

    await h.goals.set({ condition: "y", judge: { kind: "delegated", owner: "checker" } }, h.opts());
    expect(await rig.settle()).toBeUndefined();
    expect(rig.calls).toHaveLength(0);
    await h.goals.clear({}, h.opts());

    await h.goals.set({ condition: "z" }, h.opts());
    const during = gateAnswers(h, [judged(1, "not_met")], {
      beforeAnswer: () => h.goals.clear({}, h.opts()),
    });
    expect(await during.settle()).toBeUndefined();
    expect(goalState(h).at(-1)).toEqual(["g3", "cleared", 0]);
    expect(judgments(h).length).toBe(0);
  });

  test("without the last step id the decision still stands but no entry is written", async () => {
    const h = await open();
    const rig = gateAnswers(h, [judged(1, "not_met")], { rememberStep: false });
    await h.goals.set({ condition: "x" }, h.opts());
    const patch = await rig.settle();
    expect(patch).toEqual({ entries: [], continue: true });
    expect(goalState(h)).toEqual([["g1", "active", 1]]);
  });
});

describe("resuming", () => {
  test("a judgment that was already recorded is not written again when the same answer comes back", async () => {
    const h = await open();
    const answer = judged(1, "not_met");
    const rig = gateAnswers(h, [
      answer,
      { kind: "recorded", record: answer.kind === "judged" ? answer.record : judgedRecord() },
    ]);
    await h.goals.set({ condition: "x" }, h.opts());
    await rig.settle();
    const events = h.eventCount();
    const again = await rig.settle();
    expect(again?.continue).toBe(true);
    expect(h.eventCount()).toBe(events);
    expect(judgments(h)).toHaveLength(1);
  });
});
