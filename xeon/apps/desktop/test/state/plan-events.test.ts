import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { PlanIdSchema, type PlanId } from "@fresnel/contracts/capabilities";
import type { EventWire } from "@fresnel/contracts/wire";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectPlans } from "../../src/state/engine/selectors.ts";
import { INITIAL_MIRROR, PLAN_CAP, type EngineMirror } from "../../src/state/engine/state.ts";
import { STORE, SUB, evt, thr } from "./helpers.ts";

// 계획 사건(`work.plan_submitted`·`work.plan_withdrawn`)의 디코드와 거울의 계획 기록(P-14 계획 카드).
// 본문은 거울에 들어가지 않는다. 계획마다 가장 최근에 받은 판 하나이고, thread마다 `PLAN_CAP`개까지 둔다.

const T: ThreadId = thr(1);

/** 시험의 계획 id. 브랜드 값이라 스키마로 만든다 */
function planIdOf(value: string): PlanId {
  const parsed = parse(PlanIdSchema, value);
  if (!parsed.ok) throw new Bug(`bad test plan id ${value}`);
  return parsed.value;
}
const OTHER: ThreadId = thr(2);
const AT = "2026-11-04T00:00:00.000Z";

function wire(seq: number, kind: EventWire["kind"], payload: unknown, threadId = T): EventWire {
  return {
    id: evt(seq),
    kind,
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

const submitted = (
  seq: number,
  planId: string,
  version: number,
  title: string,
  threadId: ThreadId = T,
): DurableFact =>
  decodeDurable(
    wire(
      seq,
      "work.plan_submitted",
      {
        planId,
        version,
        title,
        body: "본문은 거울에 들어가지 않는다",
        artifact: null,
        supersedes: version > 1 ? version - 1 : null,
      },
      threadId,
    ),
  );

const withdrawn = (seq: number, planId: string, version: number): DurableFact =>
  decodeDurable(wire(seq, "work.plan_withdrawn", { planId, version, reason: "exit_mode" }));

function run(facts: readonly DurableFact[]): EngineMirror {
  const inputs: MirrorInput[] = [
    { type: "subscribed", sub: SUB, storeId: STORE, start: 0, live: true, from: "head" },
    { type: "batch", sub: SUB, from: 0, to: facts.length, caughtUp: true, facts: [...facts] },
  ];
  let state = INITIAL_MIRROR;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

describe("work.plan_* events: decode", () => {
  test("a submitted event keeps its plan id, version, and title, and drops the body", () => {
    expect(
      decodeDurable(
        wire(1, "work.plan_submitted", {
          planId: "p1",
          version: 2,
          title: "캐시 만료 수정",
          body: "긴 본문",
          artifact: null,
          supersedes: 1,
        }),
      ),
    ).toEqual({
      type: "plan.event",
      seq: 1,
      eventId: evt(1),
      threadId: T,
      turnId: null,
      at: AT,
      plan: { planId: planIdOf("p1"), version: 2, title: "캐시 만료 수정", status: "submitted" },
    });
  });

  test("a withdrawn event carries no title, and a bad plan id is unreadable", () => {
    expect(
      decodeDurable(
        wire(2, "work.plan_withdrawn", { planId: "p1", version: 2, reason: "exit_mode" }),
      ),
    ).toMatchObject({
      type: "plan.event",
      plan: { planId: planIdOf("p1"), version: 2, title: null, status: "withdrawn" },
    });
    expect(
      decodeDurable(
        wire(3, "work.plan_withdrawn", { planId: "plan-one", version: 2, reason: "call" }),
      ).type,
    ).toBe("unreadable");
  });
});

describe("plans in the mirror", () => {
  test("a submitted plan is one record for its thread, with the body left out", () => {
    const state = run([submitted(1, "p1", 1, "첫 계획")]);
    expect(state.plans).toEqual([
      { threadId: T, planId: planIdOf("p1"), version: 1, title: "첫 계획", status: "submitted" },
    ]);
  });

  test("a newer version of a plan replaces its record and moves it to the end", () => {
    const state = run([
      submitted(1, "p1", 1, "첫 계획"),
      submitted(2, "p2", 1, "다른 계획"),
      submitted(3, "p1", 2, "고친 계획"),
    ]);
    expect(state.plans.map((r) => [String(r.planId), r.version, r.title])).toEqual([
      ["p2", 1, "다른 계획"],
      ["p1", 2, "고친 계획"],
    ]);
  });

  test("an older version submitted after a newer one leaves the record alone", () => {
    const state = run([submitted(1, "p1", 2, "새 판"), submitted(2, "p1", 1, "옛 판")]);
    expect(state.plans).toEqual([
      { threadId: T, planId: planIdOf("p1"), version: 2, title: "새 판", status: "submitted" },
    ]);
  });

  test("a withdrawn version marks its record withdrawn and keeps the title; an older version leaves the record alone", () => {
    const done = run([submitted(1, "p1", 1, "계획"), withdrawn(2, "p1", 1)]);
    expect(done.plans).toEqual([
      { threadId: T, planId: planIdOf("p1"), version: 1, title: "계획", status: "withdrawn" },
    ]);
    const older = run([submitted(1, "p1", 2, "새 판"), withdrawn(2, "p1", 1)]);
    expect(older.plans).toEqual([
      { threadId: T, planId: planIdOf("p1"), version: 2, title: "새 판", status: "submitted" },
    ]);
  });

  test("each thread keeps at most PLAN_CAP plans, and the oldest of that thread goes first", () => {
    const facts: DurableFact[] = [];
    for (let n = 1; n <= PLAN_CAP + 1; n += 1) {
      facts.push(submitted(n, `p${String(n)}`, 1, `계획 ${String(n)}`));
    }
    facts.push(submitted(PLAN_CAP + 2, "p1", 1, "다른 대화", OTHER));
    const state = run(facts);
    const mine = state.plans.filter((r) => r.threadId === T).map((r) => String(r.planId));
    expect(mine.length).toBe(PLAN_CAP);
    expect(mine[0]).toBe("p2");
    expect(mine.at(-1)).toBe(`p${String(PLAN_CAP + 1)}`);
    expect(state.plans.filter((r) => r.threadId === OTHER)).toEqual([
      {
        threadId: OTHER,
        planId: planIdOf("p1"),
        version: 1,
        title: "다른 대화",
        status: "submitted",
      },
    ]);
  });

  test("the selector gives one thread's records, and none without a thread", () => {
    const state = run([submitted(1, "p1", 1, "계획"), submitted(2, "p5", 1, "다른", OTHER)]);
    expect(selectPlans(state, T).map((r) => String(r.planId))).toEqual(["p1"]);
    expect(selectPlans(state, null)).toEqual([]);
  });

  test("a head subscription starts the mirror again, so the plans are cleared with the rest", () => {
    const state = run([submitted(1, "p1", 1, "계획")]);
    const reset = reduceMirror(state, {
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 0,
      live: true,
      from: "head",
    }).state;
    expect(reset.plans).toEqual([]);
  });
});

/** head에서 시작한 거울(라이브 구독 하나) */
const headAt = (start: number): EngineMirror =>
  reduceMirror(INITIAL_MIRROR, {
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start,
    live: true,
    from: "head",
  }).state;
/** 라이브 묶음 하나를 받은 뒤의 거울 */
const batchOf = (state: EngineMirror, from: number, facts: readonly DurableFact[]): EngineMirror =>
  reduceMirror(state, {
    type: "batch",
    sub: SUB,
    from,
    to: from + facts.length,
    caughtUp: true,
    facts: [...facts],
  }).state;
/** 연결 전 사건을 채우는 재생(backfill) 하나를 적용한 거울 */
const replayOf = (state: EngineMirror, facts: readonly DurableFact[]): EngineMirror =>
  reduceMirror(state, { type: "backfill", storeId: STORE, facts: [...facts] }).state;

// 연결 전 계획은 처음부터 다시 읽는 재생(backfill)으로 라이브 사건 뒤에 올 수 있다. 철회가 먼저 와도 결과는 같아야 한다.
describe("plans replayed after the live withdrawal", () => {
  test("a withdrawal that arrives live first is kept as a withdrawn record without a title", () => {
    const state = batchOf(headAt(10), 10, [withdrawn(11, "p1", 1)]);
    expect(state.plans).toEqual([
      { threadId: T, planId: planIdOf("p1"), version: 1, title: null, status: "withdrawn" },
    ]);
  });

  test("a replayed submission of the withdrawn version does not resurrect it, whichever order they come in", () => {
    const live = batchOf(headAt(10), 10, [withdrawn(11, "p1", 1)]);
    const liveThenReplay = replayOf(live, [submitted(2, "p1", 1, "계획")]);
    expect(liveThenReplay.plans).toEqual([
      { threadId: T, planId: planIdOf("p1"), version: 1, title: "계획", status: "withdrawn" },
    ]);
    const replayThenLive = batchOf(replayOf(headAt(10), [submitted(2, "p1", 1, "계획")]), 10, [
      withdrawn(11, "p1", 1),
    ]);
    expect(replayThenLive.plans).toEqual(liveThenReplay.plans);
  });

  test("a replayed older version does not undo a withdrawal of a newer one", () => {
    const state = replayOf(batchOf(headAt(10), 10, [withdrawn(11, "p1", 2)]), [
      submitted(2, "p1", 1, "옛 판"),
      submitted(3, "p1", 2, "계획"),
    ]);
    expect(state.plans).toEqual([
      { threadId: T, planId: planIdOf("p1"), version: 2, title: "계획", status: "withdrawn" },
    ]);
  });
});
