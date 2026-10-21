import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { LifecycleEvent } from "@xeon/contracts/conversation";
import type { SessionService, VolatileEventEnvelope } from "@xeon/contracts/records";
import {
  createVolatileEmitter,
  splitByBytes,
  VOLATILE_COALESCE_MS,
  VOLATILE_DELTA_MAX_BYTES,
} from "../src/volatile.ts";
import { manualClock } from "./support/clock.ts";
import { deltaTextOf } from "./support/inspect.ts";

function setup() {
  const clock = manualClock();
  const ids = fixedIdFactory(0);
  const threadId = ids.next("thr");
  const turnId = ids.next("trn");
  const itemId = ids.next("itm");
  const partId = ids.next("prt");
  const sent: VolatileEventEnvelope[] = [];
  let head = 7;
  const session: Pick<SessionService, "emitVolatile" | "feed"> = {
    emitVolatile: (event) => {
      sent.push(event);
    },
    feed: {
      headSeq: () => head,
      oldestReplayableSeq: () => 0,
      read: () => ({ events: [], scannedTo: 0 }),
      onCommit: () => () => {},
      onVolatile: () => () => {},
    },
  };
  const emitter = createVolatileEmitter({ session, clock, ids, threadId, turnId });
  const delta = (text: string): LifecycleEvent => ({
    type: "item.updated",
    threadId,
    turnId,
    stepId: null,
    itemId,
    update: {
      kind: "part_delta",
      delta: { partId, itemId, contentIndex: 0, kind: "text", phase: "delta", delta: text },
    },
  });
  const status: LifecycleEvent = {
    type: "turn.updated",
    threadId,
    turnId,
    stepId: null,
    status: "running",
  };
  return {
    clock,
    emitter,
    sent,
    delta,
    status,
    setHead: (value: number) => {
      head = value;
    },
  };
}

function asVolatile(event: LifecycleEvent) {
  if (
    event.type === "turn.updated" ||
    event.type === "step.updated" ||
    event.type === "item.started" ||
    event.type === "item.updated"
  ) {
    return event;
  }
  throw new Error("not volatile");
}

test("n_counts_from_zero_per_turn_and_after_seq_follows_head", () => {
  const t = setup();
  t.emitter.emit(asVolatile(t.status));
  t.setHead(9);
  t.emitter.emit(asVolatile(t.status));
  t.emitter.flush();
  expect(t.sent.map((event) => event.n)).toEqual([0, 1]);
  expect(t.sent.map((event) => event.afterSeq)).toEqual([7, 9]);
  expect(t.sent.map((event) => event.durable)).toEqual([false, false]);
  expect(t.sent[0]?.kind).toBe("turn.updated");
});

test("token_deltas_inside_the_window_are_coalesced", async () => {
  const t = setup();
  t.emitter.emit(asVolatile(t.delta("a")));
  t.emitter.emit(asVolatile(t.delta("b")));
  t.emitter.emit(asVolatile(t.delta("c")));
  expect(t.sent).toHaveLength(0);
  await t.clock.advance(VOLATILE_COALESCE_MS);
  t.emitter.emit(asVolatile(t.delta("d")));
  // 창이 지나면 앞의 묶음이 먼저 나간다
  expect(t.sent).toHaveLength(1);
  t.emitter.flush();
  expect(t.sent.map(deltaTextOf)).toEqual(["abc", "d"]);
});

test("a_non_delta_notification_flushes_pending_deltas_first", () => {
  const t = setup();
  t.emitter.emit(asVolatile(t.delta("x")));
  t.emitter.emit(asVolatile(t.status));
  expect(t.sent.map((event) => event.kind)).toEqual(["item.updated", "turn.updated"]);
});

test("a_delta_is_cut_into_pieces_of_at_most_16_kib", () => {
  const t = setup();
  const big = "가".repeat(10_000); // 3바이트 문자 30000바이트
  t.emitter.emit(asVolatile(t.delta(big)));
  t.emitter.flush();
  expect(t.sent.length).toBeGreaterThan(1);
  const sizes = t.sent.map((event) => new TextEncoder().encode(deltaTextOf(event)).length);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(VOLATILE_DELTA_MAX_BYTES);
  expect(t.sent.map(deltaTextOf).join("")).toBe(big);
});

test("splitByBytes_keeps_code_points_whole", () => {
  expect(splitByBytes("", 4)).toEqual([""]);
  expect(splitByBytes("😀😀", 4)).toEqual(["😀", "😀"]);
});
