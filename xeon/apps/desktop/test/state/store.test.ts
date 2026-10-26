import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { ThreadSummary } from "@xeon/contracts/wire";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { describeInput } from "../../src/state/engine/describe.ts";
import {
  guardStage,
  invariantStage,
  journalStage,
  pipeline,
  type Reducer,
} from "../../src/state/shared/pipeline.ts";
import { createJournal } from "../../src/state/shared/journal.ts";
import {
  STORE,
  SUB,
  delta,
  evt,
  harness,
  itm,
  openedHarness,
  recorded,
  summary,
  thr,
  trn,
  userItem,
} from "./helpers.ts";
import { watch } from "../../src/state/shared/watch.ts";
import {
  selectRecentWorkspaces,
  selectItem,
  selectPartText,
  selectStreamingIds,
  selectTranscriptItemIds,
} from "../../src/state/engine/selectors.ts";

/** 던지는 입력. getter가 던지므로 as 없이 타입이 맞는다 */
function poison(secret: string): MirrorInput {
  return {
    type: "threads",
    get threads(): readonly ThreadSummary[] {
      throw new Error(secret);
    },
  };
}

describe("frame commit", () => {
  test("100 deltas in one frame notify once and the text is concatenated", () => {
    const h = openedHarness();
    let notified = 0;
    h.store.read.subscribe(() => void (notified += 1));
    for (let n = 0; n < 100; n += 1) h.store.ingest({ type: "chunk", fact: delta(n, "ab") });
    expect(notified).toBe(0);
    h.frames.flush();
    expect(notified).toBe(1);
    expect(h.store.read.getState().streaming.items[itm(1)]?.parts[0]?.text).toBe("ab".repeat(100));
  });

  test("no notification when the committed state is the same object", () => {
    const h = openedHarness();
    let notified = 0;
    h.store.read.subscribe(() => void (notified += 1));
    h.store.ingest({ type: "batch", sub: "nope", from: 0, to: 1, caughtUp: true, facts: [] });
    h.frames.flush();
    expect(notified).toBe(0);
  });

  test("flush() commits immediately and cancels the pending frame", () => {
    const h = harness();
    h.store.ingest({ type: "connecting" });
    h.store.flush();
    expect(h.store.read.getState().link.phase).toBe("connecting");
    let notified = 0;
    h.store.read.subscribe(() => void (notified += 1));
    h.frames.flush(); // 취소됐으므로 아무 일도 없어야 한다
    expect(notified).toBe(0);
  });

  test("read view has no setState", () => {
    const h = harness();
    expect("setState" in h.store.read).toBe(false);
  });
});

describe("reducer failure: guard", () => {
  test("keeps previous data, moves link to reset(reducer_failed), reports, logs name only", () => {
    const h = openedHarness();
    h.store.ingest({ type: "threads", threads: [summary(thr(1))] });
    h.store.flush();
    const before = h.store.read.getState();
    h.store.ingest(poison("SECRET-boom"));
    h.store.flush();
    const after = h.store.read.getState();
    expect(after.threads).toBe(before.threads);
    expect(after.transcript).toBe(before.transcript);
    expect(after.link).toEqual({ phase: "reset", reason: "reducer_failed", attempt: 1 });
    expect(h.failures).toHaveLength(1);
    const logged = JSON.stringify(h.logs);
    expect(logged).toContain("desktop.mirror.reduce_failed");
    expect(logged).not.toContain("SECRET-boom");
    const last = h.journal.entries().findLast((e) => e.kind === "input");
    expect(last).toMatchObject({ input: "threads", note: "failed" });
  });

  test("an input after the failure still works (subscription of the screen stays alive)", () => {
    const h = openedHarness();
    let notified = 0;
    h.store.read.subscribe(() => void (notified += 1));
    h.store.ingest(poison("x"));
    h.store.ingest({ type: "threads", threads: [summary(thr(2))] });
    h.store.flush();
    expect(h.store.read.getState().threads.ids).toEqual([thr(2)]);
    expect(notified).toBe(1);
  });

  test("failure inside a frame with several inputs does not drop the others", () => {
    const h = openedHarness();
    h.store.ingest({ type: "chunk", fact: delta(0, "a") });
    h.store.ingest(poison("x"));
    h.store.ingest({ type: "chunk", fact: delta(1, "b") });
    h.store.flush();
    expect(h.store.read.getState().streaming.items[itm(1)]?.parts[0]?.text).toBe("ab");
  });

  test("repeated poison after each successful resubscribe ends in failed (no endless retry loop)", () => {
    const h = openedHarness();
    const phases: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      h.store.ingest(poison("x"));
      h.store.flush();
      phases.push(h.store.read.getState().link.phase);
      if (h.store.read.getState().link.phase === "failed") break;
      // 컨트롤러가 reset을 보고 head로 다시 구독해 성공한 것으로 본다
      h.store.ingest({
        type: "subscribed",
        sub: SUB,
        storeId: STORE,
        start: 5,
        live: true,
        from: "head",
      });
      h.store.flush();
    }
    expect(phases.at(-1)).toBe("failed");
  });

  test("onReducerFailure=rethrow surfaces the error in tests (propagate)", () => {
    const h = harness({ propagate: true });
    h.store.ingest(poison("loud"));
    expect(() => h.store.flush()).toThrow("loud");
  });
});

type S = { readonly n: number };
type I = { readonly add: number };
const base: Reducer<S, I, "applied" | "failed"> = (s, i) => {
  if (i.add < 0) throw new Error("neg");
  return { state: { n: s.n + i.add }, note: "applied" };
};

describe("pipeline stages (generic)", () => {
  test("stages[0] is outermost: journal sees the guard's recovered note", () => {
    const journal = createJournal<"applied" | "failed">(10);
    const reports: unknown[] = [];
    const reduce = pipeline(base, [
      journalStage<S, I, "applied" | "failed">(journal, { now: () => 7 }, (i) => ({
        input: `add${i.add}`,
        seq: null,
      })),
      guardStage<S, I, "applied" | "failed">(
        (s) => ({ state: s, note: "failed" }),
        (c) => void reports.push(c),
      ),
    ]);
    const start: S = { n: 1 };
    expect(reduce(start, { add: 2 }).state).toEqual({ n: 3 });
    expect(reduce(start, { add: -1 }).state).toBe(start);
    expect(reports).toHaveLength(1);
    expect(journal.entries().map((e) => (e.kind === "input" ? e.note : "flush"))).toEqual([
      "applied",
      "failed",
    ]);
  });

  test("invariantStage throws Bug on violation and guard converts it", () => {
    const reports: unknown[] = [];
    const reduce = pipeline(base, [
      guardStage<S, I, "applied" | "failed">(
        (s) => ({ state: s, note: "failed" }),
        (c) => void reports.push(c),
      ),
      invariantStage<S, I, "applied" | "failed">((s) => (s.n > 5 ? ["n too big"] : [])),
    ]);
    const r = reduce({ n: 4 }, { add: 3 });
    expect(r.note).toBe("failed");
    expect(r.state).toEqual({ n: 4 });
    expect(reports[0]).toBeInstanceOf(Bug);
  });

  test("without the invariant stage the same input passes (checks off)", () => {
    expect(pipeline(base, [])({ n: 4 }, { add: 3 }).state).toEqual({ n: 7 });
  });
});

describe("journal ring buffer and redaction", () => {
  test("capacity: keeps the newest N, oldest first", () => {
    const j = createJournal<"applied">(10);
    for (let i = 0; i < 25; i += 1)
      j.record({ kind: "input", at: i, input: "x", seq: i, note: "applied" });
    const at = j.entries().map((e) => e.at);
    expect(at).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  });

  test("below capacity: returns what was recorded", () => {
    const j = createJournal<"applied">(10);
    j.record({ kind: "flush", at: 1, count: 2, ms: 0 });
    expect(j.entries()).toHaveLength(1);
  });

  test("entries() returns a new array each time (caller cannot corrupt the ring)", () => {
    const j = createJournal<"applied">(3);
    j.record({ kind: "flush", at: 1, count: 1, ms: 0 });
    const a = j.entries();
    expect(a).not.toBe(j.entries());
  });

  test("capacity 1 and 0 do not corrupt or throw", () => {
    const one = createJournal<"applied">(1);
    for (let i = 0; i < 3; i += 1) one.record({ kind: "flush", at: i, count: 0, ms: 0 });
    expect(one.entries().map((e) => e.at)).toEqual([2]);
    const zero = createJournal<"applied">(0);
    zero.record({ kind: "flush", at: 1, count: 0, ms: 0 });
    expect(zero.entries()).toEqual([]);
  });

  test("store-level: 1000-entry default capacity holds under load, entries carry names, seq and numbers only", () => {
    const h = openedHarness();
    for (let i = 0; i < 1500; i += 1) {
      h.store.ingest({ type: "threads", threads: [] });
      h.store.flush();
    }
    expect(h.journal.entries()).toHaveLength(1000);
  });

  test("streaming deltas do not evict the entries that explain a failure (applied chunks and fast delta-only commits are not journaled)", () => {
    const h = openedHarness();
    h.store.ingest({ type: "batch", sub: SUB, from: 5, to: 9, caughtUp: true, facts: [] });
    h.store.flush();
    for (let i = 0; i < 3000; i += 1) {
      h.store.ingest({ type: "chunk", fact: delta(i, "x") });
      h.store.flush();
    }
    const entries = h.journal.entries();
    expect(entries.some((e) => e.kind === "input" && e.input === "batch")).toBe(true);
    expect(entries.some((e) => e.kind === "input" && e.input === "chunk:item.updated")).toBe(false);
    expect(entries.length).toBeLessThan(20);
  });

  test("stale chunks stay in the journal (anomaly), applied ones do not", () => {
    const h = openedHarness();
    h.store.ingest({ type: "chunk", fact: delta(0, "x") });
    h.store.ingest({ type: "chunk", fact: delta(0, "x") });
    h.store.flush();
    const notes = h.journal
      .entries()
      .flatMap((e) => (e.kind === "input" && e.input === "chunk:item.updated" ? [e.note] : []));
    expect(notes).toEqual(["duplicate"]);
  });

  test("no conversation content, title, path or approval text reaches the journal or the logs", () => {
    const h = openedHarness();
    const SECRET = "TOPSECRET-4711";
    h.store.ingest({
      type: "threads",
      threads: [summary(thr(1), { title: SECRET, workspace: `/home/${SECRET}` })],
    });
    h.store.ingest({ type: "chunk", fact: delta(0, SECRET) });
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [recorded(6, userItem(1, SECRET))],
    });
    h.store.ingest({
      type: "transcript",
      threadId: thr(1),
      asOfSeq: 6,
      items: [userItem(2, SECRET)],
    });
    h.store.ingest(poison(SECRET));
    h.store.flush();
    const dump = JSON.stringify([h.journal.entries(), h.logs]);
    expect(dump).not.toContain(SECRET);
    expect(dump).toContain("batch");
  });

  test("describeInput returns only a name and a number for every input type", () => {
    const inputs: MirrorInput[] = [
      { type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } },
      { type: "connecting" },
      { type: "subscribed", sub: SUB, storeId: STORE, start: 3, live: true, from: "head" },
      {
        type: "batch",
        sub: SUB,
        from: 1,
        to: 2,
        caughtUp: true,
        facts: [recorded(2, userItem(1, "SECRET"))],
      },
      { type: "chunk", fact: delta(0, "SECRET") },
      { type: "ended", sub: SUB },
      { type: "out_of_range" },
      { type: "subscribe_failed" },
      { type: "threads", threads: [summary(thr(1), { title: "SECRET" })] },
      { type: "transcript_opening", threadId: thr(1) },
      { type: "transcript", threadId: thr(1), asOfSeq: 2, items: [userItem(1, "SECRET")] },
      { type: "transcript_closed" },
    ];
    for (const input of inputs) {
      const label = describeInput(input);
      expect(JSON.stringify(label)).not.toContain("SECRET");
      expect(Object.keys(label).toSorted()).toEqual(["input", "seq"]);
    }
  });
});

describe("invariantStage in the store (checks on)", () => {
  test("late chunk of an already recorded item before the snapshot does not break invariants", () => {
    // item.recorded가 transcript 열기 전에 적용되고(슬롯 삭제), 늦은 조각이 뒤늦게 도착한 뒤 스냅샷이 그 item을 담는다
    const h = harness();
    h.store.ingest({
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 5,
      live: true,
      from: "head",
    });
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [recorded(6, userItem(1, "done"))],
    });
    h.store.ingest({ type: "transcript_opening", threadId: thr(1) });
    h.store.ingest({ type: "chunk", fact: delta(0, "late") });
    h.store.ingest({
      type: "transcript",
      threadId: thr(1),
      asOfSeq: 6,
      items: [userItem(1, "done")],
    });
    h.store.flush();
    expect(h.failures).toEqual([]);
    expect(h.store.read.getState().streaming.itemIds).toEqual([]);
  });

  test("late chunk after turn.completed does not leave a streaming slot behind", () => {
    const h = openedHarness();
    const turn = trn(1);
    h.store.ingest({ type: "chunk", fact: delta(0, "a", 1, thr(1), turn) });
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [
        {
          type: "turn.completed",
          seq: 6,
          eventId: evt(6),
          threadId: thr(1),
          turnId: turn,
          at: "t",
          payload: { status: "completed", stepCount: 1, usage: null, error: null },
        },
      ],
    });
    h.store.ingest({ type: "chunk", fact: delta(1, "late", 1, thr(1), turn) }); // 지연된 조각
    h.store.flush();
    expect(h.store.read.getState().streaming.itemIds).toEqual([]);
  });
});

const report = (c: unknown): void => {
  throw new Error(String(c));
};
function watchers(h: ReturnType<typeof openedHarness>) {
  const hits: Record<string, number> = {};
  const hit = (k: string) => (): void => void (hits[k] = (hits[k] ?? 0) + 1);
  const r = h.store.read;
  const offs = [
    watch(r, (s) => selectItem(s, itm(1)), hit("itemA"), report),
    watch(r, (s) => selectItem(s, itm(2)), hit("itemB"), report),
    watch(r, selectTranscriptItemIds, hit("ids"), report),
    watch(r, (s) => selectPartText(s, itm(7), 0), hit("part0"), report),
    watch(r, (s) => selectPartText(s, itm(7), 1), hit("part1"), report),
    watch(r, selectStreamingIds, hit("streamIds"), report),
  ];
  return { hits, stop: () => offs.forEach((o) => o()) };
}

describe("per-item selectors notify only their subscribers", () => {
  test("record/replace and streaming touch only the relevant watchers", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 7,
      caughtUp: true,
      facts: [recorded(6, userItem(1, "a")), recorded(7, userItem(2, "b"))],
    });
    h.store.flush();
    const w = watchers(h);

    // 같은 id 레코드 교체: itemB만
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 7,
      to: 8,
      caughtUp: true,
      facts: [recorded(8, userItem(2, "b2"))],
    });
    h.store.flush();
    expect(w.hits).toEqual({ itemB: 1 });

    // item 7의 part 0 첫 델타: part0과 streamIds
    h.store.ingest({ type: "chunk", fact: delta(0, "x", 7) });
    h.store.flush();
    expect(w.hits).toEqual({ itemB: 1, part0: 1, streamIds: 1 });

    // 두 번째 델타: part0만(ids 배열은 그대로)
    h.store.ingest({ type: "chunk", fact: delta(1, "y", 7) });
    h.store.flush();
    expect(w.hits).toEqual({ itemB: 1, part0: 2, streamIds: 1 });

    // part 1 첫 델타: part1만
    h.store.ingest({ type: "chunk", fact: delta(2, "z", 7, thr(1), null, 1) });
    h.store.flush();
    expect(w.hits).toEqual({ itemB: 1, part0: 2, part1: 1, streamIds: 1 });

    // 새 item 확정: ids만
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 8,
      to: 9,
      caughtUp: true,
      facts: [recorded(9, userItem(3))],
    });
    h.store.flush();
    expect(w.hits).toEqual({ itemB: 1, part0: 2, part1: 1, streamIds: 1, ids: 1 });

    // item 7 확정: 슬롯이 사라지므로 part0, part1, streamIds 모두 한 번 더, ids도
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 9,
      to: 10,
      caughtUp: true,
      facts: [recorded(10, userItem(7, "xy"))],
    });
    h.store.flush();
    expect(w.hits).toEqual({ itemB: 1, part0: 3, part1: 2, streamIds: 2, ids: 2 });
    w.stop();
  });

  test("watch isolates callback errors: the next listener still runs and report receives the cause", () => {
    const h = openedHarness();
    const causes: unknown[] = [];
    let second = 0;
    watch(
      h.store.read,
      (s) => s.link,
      () => {
        throw new Error("cb");
      },
      (c) => void causes.push(c),
    );
    h.store.read.subscribe(() => void (second += 1));
    h.store.ingest({ type: "connecting" });
    h.store.flush();
    expect(causes).toHaveLength(1);
    expect(second).toBe(1);
  });
});

describe("selectRecentWorkspaces", () => {
  test("lists distinct workspaces in list order, skips threads without one and honours the limit", () => {
    const h = harness();
    h.store.ingest({
      type: "threads",
      threads: [
        summary(thr(1), { workspace: "/a" }),
        summary(thr(2), { workspace: null }),
        summary(thr(3), { workspace: "/b" }),
        summary(thr(4), { workspace: "/a" }),
        summary(thr(5), { workspace: "/c" }),
      ],
    });
    h.store.flush();
    const state = h.store.read.getState();
    expect(selectRecentWorkspaces(state, 8)).toEqual(["/a", "/b", "/c"]);
    expect(selectRecentWorkspaces(state, 2)).toEqual(["/a", "/b"]);
  });
});
