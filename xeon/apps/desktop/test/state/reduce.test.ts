import { describe, expect, test } from "bun:test";
import type { ItemRecord } from "@xeon/contracts/conversation";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import { MAX_SYNC_ATTEMPTS, reduceMirror } from "../../src/state/engine/reduce.ts";
import { checkMirror } from "../../src/state/engine/invariants.ts";
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
