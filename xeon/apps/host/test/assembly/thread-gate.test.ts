import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createThreadGate } from "../../src/assembly/thread-gate.ts";
import { flushMicrotasks } from "../fixtures/clock.ts";
import { rejectionOf } from "../fixtures/rejection.ts";

// 같은 thread의 구간은 들어온 순서대로 하나씩 돌고, 다른 thread끼리는 기다리지 않는다(HS-77).

const ids = fixedIdFactory(700);
const A = ids.next("thr");
const B = ids.next("thr");

test("work on one thread runs one at a time in the order it arrived", async () => {
  const gate = createThreadGate();
  const log: string[] = [];
  const first = Promise.withResolvers<void>();
  const one = gate.run(A, async () => {
    log.push("one:start");
    await first.promise;
    log.push("one:end");
    return 1;
  });
  const two = gate.run(A, () => {
    log.push("two");
    return Promise.resolve(2);
  });
  const three = gate.run(A, () => {
    log.push("three");
    return Promise.resolve(3);
  });
  await flushMicrotasks();
  expect(log).toEqual(["one:start"]);
  first.resolve();
  expect(await Promise.all([one, two, three])).toEqual([1, 2, 3]);
  expect(log).toEqual(["one:start", "one:end", "two", "three"]);
});

test("another thread is not held up by a long section", async () => {
  const gate = createThreadGate();
  const hold = Promise.withResolvers<void>();
  const long = gate.run(A, () => hold.promise);
  const quick = await gate.run(B, () => Promise.resolve("done"));
  expect(quick).toBe("done");
  hold.resolve();
  await long;
});

test("a failed section reaches its caller and does not keep the next one waiting", async () => {
  const gate = createThreadGate();
  const failing = gate.run(A, () => Promise.reject(new Error("summary failed")));
  const next = gate.run(A, () => Promise.resolve("ran"));
  const caught = await rejectionOf(failing);
  expect(caught).toBeInstanceOf(Error);
  expect(await next).toBe("ran");
});

test("sections that start after everything has finished run at once", async () => {
  const gate = createThreadGate();
  await gate.run(A, () => Promise.resolve(1));
  const log: string[] = [];
  const pending = gate.run(A, () => {
    log.push("again");
    return Promise.resolve(2);
  });
  // 앞 구간이 없으면 약속 한 번을 기다릴 뿐 다른 구간을 기다리지 않는다
  await flushMicrotasks();
  expect(log).toEqual(["again"]);
  expect(await pending).toBe(2);
});
