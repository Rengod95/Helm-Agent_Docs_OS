import { describe, expect, test } from "bun:test";
import type { ItemRecord, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import {
  HANDLER_FAILURE_CAP,
  INITIAL_MIRROR,
  TRANSITION_CAP,
  type EngineMirror,
} from "../../src/state/engine/state.ts";
import { decodeDurable, decodeVolatile } from "../../src/state/engine/decode.ts";
import type { EventWire, VolatileEventWire } from "@fresnel/contracts/wire";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import { MAX_SYNC_ATTEMPTS, reduceMirror } from "../../src/state/engine/reduce.ts";
import { checkMirror } from "../../src/state/engine/invariants.ts";
import { selectLatestTurnId } from "../../src/state/engine/selectors.ts";
import {
  STORE,
  SUB,
  approvalRequest,
  delta,
  evt,
  itm,
  recorded,
  summary,
  thr,
  trn,
  userItem,
} from "./helpers.ts";

/** 재귀적으로 얼린다. 순수하지 않은 reducer는 strict 모드 ESM에서 TypeError로 드러난다 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function run(inputs: readonly MirrorInput[], from: EngineMirror = INITIAL_MIRROR): EngineMirror {
  let state = from;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

const T = thr(1);
const head = (start: number): MirrorInput => ({
  type: "subscribed",
  sub: SUB,
  storeId: STORE,
  start,
  live: true,
  from: "head",
});
const open = (asOfSeq: number, items: readonly ItemRecord[] = []): MirrorInput[] => [
  { type: "transcript_opening", threadId: T },
  { type: "transcript", threadId: T, asOfSeq, items },
];
const batch = (from: number, to: number, facts: DurableFact[], sub: string = SUB): MirrorInput => ({
  type: "batch",
  sub,
  from,
  to,
  caughtUp: true,
  facts,
});

const script: MirrorInput[] = [
  { type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } },
  head(5),
  { type: "threads", threads: [summary(T)] },
  ...open(5),
  batch(5, 7, [recorded(6, userItem(1, "a")), recorded(7, userItem(2, "b"))]),
  { type: "chunk", fact: delta(0, "x", 3) },
  { type: "chunk", fact: delta(1, "y", 3) },
  batch(7, 8, [recorded(8, userItem(3, "xy"))]),
];

describe("reducer purity", () => {
  test("frozen state and inputs: no input mutates, same input gives equal output", () => {
    const frozenScript = deepFreeze(structuredClone(script));
    const a = run(frozenScript, deepFreeze(INITIAL_MIRROR));
    const b = run(structuredClone(script));
    expect(a).toEqual(b);
    expect(checkMirror(a)).toEqual([]);
  });

  test("returned state is a new object only when something changed; foreign and duplicate keep the reference", () => {
    const live = run([head(5), ...open(5)]);
    expect(reduceMirror(live, batch(5, 6, [], "other")).state).toBe(live);
    const moved = run([batch(5, 6, [])], live);
    expect(reduceMirror(moved, batch(5, 6, [])).state).toBe(moved);
    expect(reduceMirror(moved, batch(5, 6, [])).note).toBe("duplicate");
  });
});

describe("idempotent replay", () => {
  const facts = [
    recorded(6, userItem(1, "a")),
    recorded(7, userItem(2, "b")),
    recorded(8, userItem(3, "c")),
  ];
  const base: MirrorInput[] = [head(5), ...open(5)];
  const clean = run([...base, batch(5, 8, facts)]);

  test("exact retransmit", () => {
    expect(run([...base, batch(5, 8, facts), batch(5, 8, facts)])).toEqual(clean);
  });

  test("split batches plus overlapping retransmits", () => {
    const state = run([
      ...base,
      batch(5, 6, facts.slice(0, 1)),
      batch(5, 7, facts.slice(0, 2)), // 겹침: seq 6은 건너뛰고 7만 적용
      batch(6, 8, facts.slice(1)),
      batch(5, 6, facts.slice(0, 1)), // 오래된 재전송
    ]);
    expect(state).toEqual(clean);
  });

  test("snapshot after events: held replay equals applying events after snapshot", () => {
    const viaHeld = run([
      head(5),
      { type: "transcript_opening", threadId: T },
      batch(5, 8, facts),
      { type: "transcript", threadId: T, asOfSeq: 6, items: [userItem(1, "a")] },
    ]);
    expect(viaHeld.transcript?.status === "ready" ? viaHeld.transcript.itemIds : []).toEqual([
      itm(1),
      itm(2),
      itm(3),
    ]);
    expect(checkMirror(viaHeld)).toEqual([]);
  });

  test("approval requested twice then resolved twice never goes below zero", () => {
    const req: DurableFact = {
      type: "approval.requested",
      seq: 6,
      eventId: evt(6),
      threadId: T,
      turnId: null,
      at: "t",
      request: approvalRequest(T),
    };
    const res: DurableFact = {
      type: "approval.resolved",
      seq: 7,
      eventId: evt(7),
      threadId: T,
      turnId: null,
      at: "t",
      approvalId: evt(6),
    };
    const s = run([
      head(5),
      { type: "threads", threads: [summary(T)] },
      batch(5, 6, [req]),
      batch(5, 6, [req]),
      batch(6, 7, [res]),
      batch(6, 7, [res]),
    ]);
    expect(s.approvals.ids).toEqual([]);
    expect(s.threads.byId[T]?.pendingApprovals).toBe(0);
    // 같은 사실을 겹친 batch로 두 번 받아도(seq 필터를 통과해도) 중복 요청은 한 건
    const dup = run([
      head(5),
      { type: "threads", threads: [summary(T)] },
      batch(5, 6, [req, { ...req, seq: 6 }]),
    ]);
    expect(dup.approvals.ids).toEqual([evt(6)]);
    expect(dup.threads.byId[T]?.pendingApprovals).toBe(1);
  });
});

describe("streaming slot", () => {
  test("delta duplicates by n are ignored and text is appended in order", () => {
    const s = run([
      head(5),
      ...open(5),
      { type: "chunk", fact: delta(0, "Hel") },
      { type: "chunk", fact: delta(1, "lo") },
      { type: "chunk", fact: delta(1, "lo") },
      { type: "chunk", fact: delta(0, "Hel") },
    ]);
    expect(s.streaming.items[itm(1)]?.parts[0]?.text).toBe("Hello");
    expect(s.streaming.items[itm(1)]?.kind).toBe("assistant");
  });

  test("a delta does not copy the transcript record map (reference kept)", () => {
    const before = run([head(5), ...open(5), batch(5, 6, [recorded(6, userItem(1))])]);
    const after = run([{ type: "chunk", fact: delta(0, "x", 2) }], before);
    expect(after.transcript).toBe(before.transcript);
  });

  test("merge on completion: item.recorded drops the slot and adds the record", () => {
    const s = run([
      head(5),
      ...open(5),
      { type: "chunk", fact: delta(0, "Hi", 4) },
      batch(5, 6, [recorded(6, userItem(4, "Hi"))]),
    ]);
    expect(s.streaming.itemIds).toEqual([]);
    expect(s.transcript?.status === "ready" ? s.transcript.itemIds : []).toEqual([itm(4)]);
  });

  test("turn.completed drops the turn's slots and its lastN", () => {
    const turn = trn(1);
    const done: DurableFact = {
      type: "turn.completed",
      seq: 6,
      eventId: evt(6),
      threadId: T,
      turnId: turn,
      at: "t",
      payload: { status: "completed", stepCount: 1, usage: null, error: null },
    };
    const s = run([
      head(5),
      { type: "threads", threads: [summary(T)] },
      { type: "chunk", fact: delta(0, "x", 2, T, turn) },
      batch(5, 6, [done]),
    ]);
    expect(s.streaming.itemIds).toEqual([]);
    expect(s.streaming.lastN).toEqual({});
    expect(s.threads.byId[T]?.status).toBe("idle");
  });

  test("engine going down clears streaming and link", () => {
    const s = run([
      head(5),
      { type: "chunk", fact: delta(0, "x") },
      { type: "engine", state: { kind: "stopped" } },
    ]);
    expect(s.streaming.itemIds).toEqual([]);
    expect(s.link).toEqual({ phase: "offline" });
  });
});

describe("gap and resync", () => {
  test("gap batch moves to resync(gap) and keeps the cache", () => {
    const s0 = run([head(5), ...open(5), batch(5, 6, [recorded(6, userItem(1))])]);
    const r = reduceMirror(s0, batch(9, 10, [recorded(10, userItem(2))]));
    expect(r.note).toBe("gap");
    expect(r.state.link).toEqual({ phase: "resync", reason: "gap", attempt: 1 });
    expect(r.state.cursor).toEqual({ storeId: STORE, seq: 6 });
    expect(r.state.transcript).toBe(s0.transcript);
  });

  test("resubscribe from cursor with same store replays only newer facts; link goes back to live", () => {
    const s0 = run([head(5), ...open(5), batch(5, 6, [recorded(6, userItem(1))])]);
    const gapped = reduceMirror(s0, batch(9, 10, [])).state;
    const s1 = run(
      [
        { type: "subscribed", sub: "s2", storeId: STORE, start: 6, live: false, from: "cursor" },
        batch(6, 10, [recorded(7, userItem(2)), recorded(10, userItem(3))], "s2"),
      ],
      gapped,
    );
    expect(s1.link).toEqual({ phase: "live", sub: "s2" });
    expect(s1.transcript?.status === "ready" ? s1.transcript.itemIds : []).toEqual([
      itm(1),
      itm(2),
      itm(3),
    ]);
    expect(s1.cursor?.seq).toBe(10);
  });

  test("resubscribe with a different store id resets", () => {
    const s0 = run([head(5)]);
    const r = reduceMirror(s0, {
      type: "subscribed",
      sub: "s2",
      storeId: "sto_00000000000000000000000002",
      start: 0,
      live: true,
      from: "cursor",
    });
    expect(r.state.link).toEqual({ phase: "reset", reason: "store_changed", attempt: 1 });
  });

  test("failed is absorbing: attempts end in failed after MAX_SYNC_ATTEMPTS and stay there", () => {
    let s = run([head(5)]);
    const phases: string[] = [];
    for (let i = 0; i < MAX_SYNC_ATTEMPTS + 2; i += 1) {
      s = run([{ type: "subscribe_failed" }], s);
      phases.push(s.link.phase);
    }
    expect(phases).toEqual(["resync", "resync", "resync", "failed", "failed"]);
  });

  test("ended for the current sub resyncs; ended for another sub is foreign", () => {
    const s0 = run([head(5)]);
    expect(reduceMirror(s0, { type: "ended", sub: "zz" }).note).toBe("foreign");
    expect(reduceMirror(s0, { type: "ended", sub: SUB }).state.link).toEqual({
      phase: "resync",
      reason: "ended",
      attempt: 1,
    });
  });
});

describe("bulk item.recorded in one batch", () => {
  test("one batch with K recorded items equals K one-fact batches (replace, duplicate id, other-thread, below asOfSeq)", () => {
    const other = thr(2);
    const facts: DurableFact[] = [
      recorded(6, userItem(1, "a")),
      recorded(7, userItem(2, "b")),
      recorded(8, userItem(1, "a2")), // 같은 id 교체
      recorded(9, userItem(3, "c"), other), // 다른 thread는 열린 transcript에 들어가지 않는다
      recorded(10, userItem(4, "d")),
    ];
    const base = run([head(5), ...open(5)]);
    const one = run([batch(5, 10, facts)], base);
    const many = run(
      facts.map((f) => batch(f.seq - 1, f.seq, [f])),
      base,
    );
    expect(one.transcript).toEqual(many.transcript);
    expect(one.streaming).toEqual(many.streaming);
    expect(checkMirror(one)).toEqual([]);
    const t = one.transcript;
    expect(t?.status === "ready" ? t.itemIds : []).toEqual([itm(1), itm(2), itm(4)]);
  });

  test("a batch that only replaces items keeps the itemIds reference", () => {
    const base = run([head(5), ...open(5), batch(5, 6, [recorded(6, userItem(1, "a"))])]);
    const after = run([batch(6, 7, [recorded(7, userItem(1, "a2"))])], base);
    const before = base.transcript;
    const next = after.transcript;
    expect(
      before?.status === "ready" && next?.status === "ready" && before.itemIds === next.itemIds,
    ).toBe(true);
  });

  test("loading: recorded items go to held in order, applied after the snapshot only above asOfSeq", () => {
    const loading = run([
      head(5),
      { type: "transcript_opening", threadId: T },
      batch(5, 8, [recorded(6, userItem(1)), recorded(7, userItem(2)), recorded(8, userItem(3))]),
    ]);
    const ready = run(
      [{ type: "transcript", threadId: T, asOfSeq: 7, items: [userItem(1), userItem(2)] }],
      loading,
    );
    const t = ready.transcript;
    expect(t?.status === "ready" ? t.itemIds : []).toEqual([itm(1), itm(2), itm(3)]);
  });
});

const reduceAll = (state: EngineMirror, ...inputs: MirrorInput[]): EngineMirror =>
  inputs.reduce((s, i) => reduceMirror(s, i).state, state);

const live = (): EngineMirror =>
  reduceAll(INITIAL_MIRROR, {
    type: "subscribed",
    sub: "s1",
    storeId: STORE,
    start: 5,
    live: true,
    from: "head",
  });

describe("loading and failure states, approval restoration", () => {
  test("a fresh mirror has threads loading; thread.list marks ready even when empty", () => {
    expect(live().threads.status).toBe("loading");
    expect(reduceAll(live(), { type: "threads", threads: [] }).threads.status).toBe("ready");
  });

  test("threads_failed: error while loading, ignored once ready (stale)", () => {
    expect(reduceAll(live(), { type: "threads_failed" }).threads.status).toBe("error");
    const ready = reduceAll(live(), { type: "threads", threads: [summary(thr(1))] });
    const r = reduceMirror(ready, { type: "threads_failed" });
    expect(r.state).toBe(ready);
    expect(r.note).toBe("stale");
  });

  test("transcript_failed only applies to the loading transcript of that thread", () => {
    const loading = reduceAll(live(), { type: "transcript_opening", threadId: thr(1) });
    expect(reduceMirror(loading, { type: "transcript_failed", threadId: thr(2) }).note).toBe(
      "foreign",
    );
    expect(reduceAll(loading, { type: "transcript_failed", threadId: thr(1) }).transcript).toEqual({
      status: "error",
      threadId: thr(1),
    });
    // 다시 열면 loading으로 돌아간다
    const again = reduceAll(
      loading,
      { type: "transcript_failed", threadId: thr(1) },
      { type: "transcript_opening", threadId: thr(1) },
    );
    expect(again.transcript?.status).toBe("loading");
  });

  test("approvals input adds missing ones once and skips ones already resolved", () => {
    const request = approvalRequest(thr(1));
    const listed = { approvalId: evt(7), seq: 4, request };
    const once = reduceAll(live(), { type: "approvals", approvals: [listed] });
    expect(once.approvals.ids).toEqual([evt(7)]);
    expect(reduceAll(once, { type: "approvals", approvals: [listed] }).approvals.ids).toEqual([
      evt(7),
    ]);
    // approval.resolved(seq 6)가 목록 응답(position 5)보다 먼저 거울에 들어간 경우: 되살리지 않는다
    const resolvedFirst = reduceAll(live(), {
      type: "batch",
      sub: "s1",
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [
        {
          type: "approval.resolved",
          seq: 6,
          eventId: evt(8),
          threadId: thr(1),
          turnId: null,
          at: "t",
          approvalId: evt(7),
        },
      ],
    });
    expect(
      reduceAll(resolvedFirst, { type: "approvals", approvals: [listed] }).approvals.ids,
    ).toEqual([]);
  });
});

/** turn.started 사실 하나. turnId가 null이면 호스트가 준 값이 없는 경우다 */
const started = (seq: number, threadId: ThreadId, turnId: TurnId | null): DurableFact => ({
  type: "turn.started",
  seq,
  eventId: evt(seq),
  threadId,
  turnId,
  at: "t",
});

describe("latest turn id per thread", () => {
  test("turn.started records the turn id under its thread; a later turn replaces it and other threads keep theirs", () => {
    const s = run([
      head(5),
      batch(5, 6, [started(6, T, trn(1))]),
      batch(6, 9, [started(7, thr(2), trn(3)), started(8, T, trn(2))]),
    ]);
    expect(s.latestTurnId).toEqual({ [T]: trn(2), [thr(2)]: trn(3) });
    expect(selectLatestTurnId(s, T)).toBe(trn(2));
    expect(selectLatestTurnId(s, null)).toBeNull();
    expect(checkMirror(s)).toEqual([]);
  });

  test("a turn.started without a turn id records nothing", () => {
    const s = run([head(5), batch(5, 6, [started(6, T, null)])]);
    expect(s.latestTurnId).toEqual({});
  });

  test("a head reset forgets the turn ids; a cursor resubscribe on the same store keeps them", () => {
    const s = run([head(5), batch(5, 6, [started(6, T, trn(1))])]);
    expect(run([head(9)], s).latestTurnId).toEqual({});
    const resumed: MirrorInput = {
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 6,
      live: true,
      from: "cursor",
    };
    expect(run([resumed], s).latestTurnId).toEqual({ [T]: trn(1) });
  });

  test("a thread list seeds the turn id from the summary's lastTurnId; a summary without one seeds nothing", () => {
    const s = run([
      head(5),
      {
        type: "threads",
        threads: [summary(T, { lastTurnId: trn(2) }), summary(thr(2))],
      },
    ]);
    expect(s.latestTurnId).toEqual({ [T]: trn(2) });
    expect(selectLatestTurnId(s, T)).toBe(trn(2));
    expect(selectLatestTurnId(s, thr(2))).toBeNull();
    expect(checkMirror(s)).toEqual([]);
  });

  test("a live turn.started after the list read replaces the seeded turn id", () => {
    const s = run([
      head(5),
      { type: "threads", threads: [summary(T, { lastTurnId: trn(2) })] },
      batch(5, 6, [started(6, T, trn(3))]),
    ]);
    expect(s.latestTurnId).toEqual({ [T]: trn(3) });
  });

  test("a thread list read after a live turn.started does not overwrite that newer turn id", () => {
    const s = run([
      head(5),
      batch(5, 6, [started(6, T, trn(3))]),
      { type: "threads", threads: [summary(T, { lastTurnId: trn(2) })] },
    ]);
    expect(s.latestTurnId).toEqual({ [T]: trn(3) });
    expect(selectLatestTurnId(s, T)).toBe(trn(3));
  });
});

/** 휘발 `scope.handler_failed` 봉투. 열린 대화 하나당 한 번씩 같은 내용이 온다 */
function failedEvent(
  n: number,
  afterSeq: number,
  payload: unknown,
  threadId: ThreadId = T,
): VolatileEventWire {
  return {
    id: evt(300 + n),
    kind: "scope.handler_failed",
    version: 1,
    durable: false,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: "2026-11-04T00:00:00.000Z",
    causationId: null,
    correlationId: "c",
    n,
    afterSeq,
    payload,
  };
}
const failure = (owner: string, point: string, consecutive: number, message = "boom") => ({
  owner,
  point,
  result: "error",
  message,
  consecutive,
});
const chunkOf = (event: VolatileEventWire): MirrorInput => ({
  type: "chunk",
  fact: decodeVolatile(event),
});

describe("scope.handler_failed: 디코드와 거울의 실패 기록", () => {
  test("디코드: 검증을 통과한 실패는 payload와 afterSeq를 싣고, 모양이 틀리면 other다", () => {
    expect(decodeVolatile(failedEvent(0, 7, failure("ext:flaky", "tool.call.before", 1)))).toEqual({
      type: "scope.handler_failed",
      n: 0,
      threadId: T,
      turnId: null,
      afterSeq: 7,
      payload: failure("ext:flaky", "tool.call.before", 1),
    });
    expect(decodeVolatile(failedEvent(1, 7, { owner: 1 })).type).toBe("other");
  });

  test("거울은 받은 실패를 순서대로 넣고 같은 실패의 두 번째 사본(다른 대화)은 한 번만 넣는다", () => {
    const state = run([
      chunkOf(failedEvent(0, 7, failure("ext:flaky", "tool.call.before", 1))),
      chunkOf(failedEvent(0, 7, failure("ext:flaky", "tool.call.before", 1), thr(2))),
      chunkOf(failedEvent(1, 9, failure("ext:flaky", "tool.call.before", 2))),
    ]);
    expect(state.handlerFailures).toEqual([
      {
        owner: "ext:flaky",
        point: "tool.call.before",
        result: "error",
        message: "boom",
        consecutive: 1,
        afterSeq: 7,
      },
      {
        owner: "ext:flaky",
        point: "tool.call.before",
        result: "error",
        message: "boom",
        consecutive: 2,
        afterSeq: 9,
      },
    ]);
  });

  test("거울의 실패 기록은 HANDLER_FAILURE_CAP행까지만 두고 가장 오래된 것부터 버린다", () => {
    expect(HANDLER_FAILURE_CAP).toBe(500);
    const inputs: MirrorInput[] = [];
    for (let i = 0; i <= HANDLER_FAILURE_CAP; i += 1) {
      inputs.push(chunkOf(failedEvent(i, i, failure("ext:flaky", "tool.call.before", i + 1))));
    }
    const state = run(inputs);
    expect(state.handlerFailures).toHaveLength(HANDLER_FAILURE_CAP);
    expect(state.handlerFailures[0]?.afterSeq).toBe(1);
    expect(state.handlerFailures.at(-1)?.afterSeq).toBe(HANDLER_FAILURE_CAP);
  });
});

describe("lease.*·scope.changed: 디코드와 거울의 전환 기록", () => {
  const AT = "2026-11-04T00:00:00.000Z";
  const durableEvent = (
    kind: EventWire["kind"],
    seq: number,
    payload: unknown,
    turnId: TurnId | null = trn(2),
    threadId: ThreadId = T,
  ): EventWire => ({
    id: evt(seq),
    version: 1,
    parentId: null,
    stepId: null,
    causationId: null,
    correlationId: "c",
    redactions: [],
    threadId,
    turnId,
    recordedAt: AT,
    kind,
    durable: true,
    seq,
    payload,
  });

  test("디코드: 검증을 통과한 네 kind는 payload를 그대로 싣고, 모양이 틀리면 unreadable이다", () => {
    expect(
      decodeDurable(
        durableEvent("lease.acquired", 11, {
          leaseId: "lease_1",
          scopeId: "review",
          lineageId: "lin_1",
          limits: { maxTurns: 4, maxSpawns: 2 },
          leaseEpoch: 2,
        }),
      ),
    ).toEqual({
      type: "lease.acquired",
      seq: 11,
      eventId: evt(11),
      threadId: T,
      turnId: trn(2),
      at: AT,
      payload: {
        leaseId: "lease_1",
        scopeId: "review",
        lineageId: "lin_1",
        limits: { maxTurns: 4, maxSpawns: 2 },
        leaseEpoch: 2,
      },
    });
    expect(
      decodeDurable(
        durableEvent("lease.released", 12, {
          leaseId: "lease_1",
          scopeId: "review",
          reason: "waiting",
        }),
      ),
    ).toEqual({
      type: "lease.released",
      seq: 12,
      eventId: evt(12),
      threadId: T,
      turnId: trn(2),
      at: AT,
      payload: { leaseId: "lease_1", scopeId: "review", reason: "waiting" },
    });
    expect(
      decodeDurable(
        durableEvent(
          "lease.rejected",
          13,
          { groupId: "work", reason: "wait_limit", requestSeq: 3 },
          null,
        ),
      ),
    ).toEqual({
      type: "lease.rejected",
      seq: 13,
      eventId: evt(13),
      threadId: T,
      turnId: null,
      at: AT,
      payload: { groupId: "work", reason: "wait_limit", requestSeq: 3 },
    });
    expect(
      decodeDurable(
        durableEvent("scope.changed", 14, { scopeId: "review", status: "enabled" }, null),
      ),
    ).toEqual({
      type: "scope.changed",
      seq: 14,
      eventId: evt(14),
      threadId: T,
      turnId: null,
      at: AT,
      payload: { scopeId: "review", status: "enabled" },
    });
    expect(
      decodeDurable(
        durableEvent("lease.released", 15, { leaseId: "l", scopeId: "review", reason: "bogus" }),
      ),
    ).toEqual({
      type: "unreadable",
      seq: 15,
      eventId: evt(15),
      threadId: T,
      turnId: trn(2),
      at: AT,
    });
    expect(
      decodeDurable(durableEvent("scope.changed", 16, { scopeId: "review", status: "paused" })),
    ).toEqual({
      type: "unreadable",
      seq: 16,
      eventId: evt(16),
      threadId: T,
      turnId: trn(2),
      at: AT,
    });
  });

  test("거울은 배치의 전환을 받은 순서대로 넣고 사유 없는 켜짐은 request, 턴 없는 기록은 null이다", () => {
    const state = run([
      head(5),
      batch(5, 9, [
        decodeDurable(
          durableEvent("lease.acquired", 6, {
            leaseId: "l1",
            scopeId: "helm",
            lineageId: "l1",
            limits: { maxTurns: 4, maxSpawns: 2 },
          }),
        ),
        decodeDurable(
          durableEvent("scope.changed", 7, { scopeId: "review", status: "enabled" }, null),
        ),
        decodeDurable(
          durableEvent("lease.released", 8, { leaseId: "l1", scopeId: "helm", reason: "waiting" }),
        ),
        decodeDurable(
          durableEvent("lease.rejected", 9, {
            groupId: "work",
            reason: "wait_limit",
            requestSeq: 3,
          }),
        ),
      ]),
    ]);
    expect(state.transitions).toEqual([
      {
        threadId: T,
        seq: 6,
        at: AT,
        turnId: trn(2),
        subject: "helm",
        change: { kind: "lease.acquired", leaseEpoch: null },
      },
      {
        threadId: T,
        seq: 7,
        at: AT,
        turnId: null,
        subject: "review",
        change: { kind: "scope.changed", status: "enabled", reason: "request" },
      },
      {
        threadId: T,
        seq: 8,
        at: AT,
        turnId: trn(2),
        subject: "helm",
        change: { kind: "lease.released", reason: "waiting" },
      },
      {
        threadId: T,
        seq: 9,
        at: AT,
        turnId: trn(2),
        subject: "work",
        change: { kind: "lease.rejected", reason: "wait_limit" },
      },
    ]);
  });

  test("같은 (대화, seq)의 전환은 한 번만 넣는다", () => {
    const released = decodeDurable(
      durableEvent("lease.released", 6, { leaseId: "l1", scopeId: "helm", reason: "idle" }),
    );
    const state = run([head(5), batch(5, 7, [released, released])]);
    expect(state.transitions.map((r) => r.seq)).toEqual([6]);
  });

  test("대화마다 TRANSITION_CAP(20)개까지 두고 가장 오래된 것부터 버리며, 다른 대화의 기록은 그대로 둔다", () => {
    expect(TRANSITION_CAP).toBe(20);
    const other = thr(2);
    // 커서(5) 위의 seq만 적용된다. 다른 대화의 기록은 6번, 이 대화의 25개는 7~31번이다
    const facts = [
      decodeDurable(
        durableEvent(
          "lease.released",
          6,
          { leaseId: "o", scopeId: "other", reason: "idle" },
          null,
          other,
        ),
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        decodeDurable(
          durableEvent("lease.released", i + 7, {
            leaseId: `l${i + 7}`,
            scopeId: "helm",
            reason: "idle",
          }),
        ),
      ),
    ];
    const state = run([head(5), batch(5, 31, facts)]);
    expect(state.transitions.filter((r) => r.threadId === T).map((r) => r.seq)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    ]);
    expect(state.transitions.filter((r) => r.threadId === other).map((r) => r.seq)).toEqual([6]);
    expect(state.transitions).toHaveLength(21);
  });

  test("head부터 다시 맞추면 비우고, 같은 저장소의 커서 재구독은 유지한다", () => {
    const released = decodeDurable(
      durableEvent("lease.released", 6, { leaseId: "l1", scopeId: "helm", reason: "idle" }),
    );
    const kept = run([
      head(5),
      batch(5, 6, [released]),
      { type: "subscribed", sub: SUB, storeId: STORE, start: 6, live: true, from: "cursor" },
    ]);
    expect(kept.transitions.map((r) => r.seq)).toEqual([6]);
    const reset = run([head(5), batch(5, 6, [released]), head(6)]);
    expect(reset.transitions).toEqual([]);
  });
});
