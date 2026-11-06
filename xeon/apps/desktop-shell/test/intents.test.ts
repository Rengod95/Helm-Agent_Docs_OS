import { describe, expect, test } from "bun:test";
import {
  createIntentQueue,
  type Intent,
  INTENT_CAPACITY,
  INTENT_EVENT,
  INTENT_LIFETIME_MS,
} from "../src/main/intents.ts";

function open(threadId: string): Intent {
  return { kind: "openThread", threadId };
}

describe("intent queue", () => {
  test("the wire constants are the Tauri ones", () => {
    expect(INTENT_CAPACITY).toBe(8);
    expect(INTENT_LIFETIME_MS).toBe(30_000);
    expect(INTENT_EVENT).toBe("shell-intent");
  });

  test("intents come out in the order they went in, and the queue empties", () => {
    const queue = createIntentQueue();
    queue.push({ kind: "newThread" }, 1_000);
    queue.push(open("a"), 1_000);
    queue.push(open("b"), 1_000);
    expect(queue.take(1_000)).toEqual([{ kind: "newThread" }, open("a"), open("b")]);
    expect(queue.take(1_000)).toEqual([]);
  });

  test("the queue keeps the newest eight and drops the oldest", () => {
    const queue = createIntentQueue();
    for (let n = 0; n < 10; n += 1) queue.push(open(String(n)), 1_000);
    expect(queue.take(1_000)).toEqual([
      open("2"),
      open("3"),
      open("4"),
      open("5"),
      open("6"),
      open("7"),
      open("8"),
      open("9"),
    ]);
  });

  test("an intent is kept for exactly 30 seconds and dropped after that", () => {
    const start = 1_000_000;

    const atTheLimit = createIntentQueue();
    atTheLimit.push(open("a"), start);
    expect(atTheLimit.take(start + 30_000)).toEqual([open("a")]);

    const justPast = createIntentQueue();
    justPast.push(open("a"), start);
    justPast.push(open("b"), start + 10_000);
    expect(justPast.take(start + 30_001)).toEqual([open("b")]);

    const allOld = createIntentQueue();
    allOld.push(open("a"), start);
    expect(allOld.take(start + 31_000)).toEqual([]);
  });

  test("the same open request is not queued twice in a row", () => {
    const queue = createIntentQueue();
    queue.push(open("a"), 1_000);
    queue.push(open("a"), 1_000);
    expect(queue.take(1_000)).toEqual([open("a")]);

    // 사이에 다른 의도가 끼면 끝이 아니므로 다시 넣는다
    queue.push(open("a"), 1_000);
    queue.push({ kind: "newThread" }, 1_000);
    queue.push(open("a"), 1_000);
    expect(queue.take(1_000)).toEqual([open("a"), { kind: "newThread" }, open("a")]);
  });

  test("a repeated open request restarts its thirty seconds", () => {
    const start = 1_000_000;

    const kept = createIntentQueue();
    kept.push(open("a"), start);
    kept.push(open("a"), start + 20_000);
    expect(kept.take(start + 50_000)).toEqual([open("a")]);

    const dropped = createIntentQueue();
    dropped.push(open("a"), start);
    dropped.push(open("a"), start + 20_000);
    expect(dropped.take(start + 50_001)).toEqual([]);
  });

  test("a new thread request is never merged with the one before it", () => {
    const queue = createIntentQueue();
    queue.push({ kind: "newThread" }, 1_000);
    queue.push({ kind: "newThread" }, 1_000);
    expect(queue.take(1_000)).toEqual([{ kind: "newThread" }, { kind: "newThread" }]);
  });
});
