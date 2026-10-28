import { expect, test } from "bun:test";
import { createTestHost } from "../../src/testing/index.ts";
import type { DispatchPolicy } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeUnit } from "./fixtures/support.ts";

const settled = (t: Awaited<ReturnType<typeof createTestHost>>) => ({
  turnId: t.ids.next("trn"),
  aborted: false,
});

test("snapshot ignores mid-dispatch changes", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "snap-a", points: ["boundary.settle.after"], loadIndex: 0 }, (g) => {
      let added = false;
      g.on("boundary.settle.after", () => {
        calls.push("a");
        if (!added) {
          added = true;
          g.on("boundary.settle.after", () => {
            calls.push("added");
          });
        }
      });
    }),
  );
  const off = { current: () => {} };
  await t.host.install(
    makeUnit({ name: "snap-b", points: ["boundary.settle.after"], loadIndex: 1 }, (g) => {
      off.current = g.on("boundary.settle.after", () => {
        calls.push("b");
      });
    }),
  );
  await t.host.dispatch("boundary.settle.after", settled(t), {
    threadId: thread,
    dispatchKey: "1",
  });
  expect(calls).toEqual(["a", "b"]);
  off.current();
  calls.length = 0;
  await t.host.dispatch("boundary.settle.after", settled(t), {
    threadId: thread,
    dispatchKey: "2",
  });
  expect(calls).toEqual(["a", "added"]);
});

test("order is tier load seq", async () => {
  const tiers: Record<string, number> = {
    "ord-user": 1,
    "ord-guard": 0,
    "ord-core": 4,
    "ord-user2": 1,
  };
  const policy: DispatchPolicy = {
    tierOf: (entry) => tiers[entry.extension] ?? 9,
    budgetMs: () => null,
    onHandlerFailure: () => {},
  };
  const t = await createTestHost({ policy });
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  // 로드 순서와 tier가 엇갈리게 설치한다
  const specs = [
    { name: "ord-core", loadIndex: 0 },
    { name: "ord-user2", loadIndex: 3 },
    { name: "ord-user", loadIndex: 2 },
    { name: "ord-guard", loadIndex: 5 },
  ];
  await eachInOrder(specs, async (spec) => {
    await t.host.install(
      makeUnit(
        { name: spec.name, points: ["boundary.settle.after"], loadIndex: spec.loadIndex },
        (g) => {
          g.on("boundary.settle.after", () => {
            calls.push(`${spec.name}#1`);
          });
          g.on("boundary.settle.after", () => {
            calls.push(`${spec.name}#2`);
          });
        },
      ),
    );
    return "continue";
  });
  await t.host.dispatch("boundary.settle.after", settled(t), {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(calls).toEqual([
    "ord-guard#1",
    "ord-guard#2",
    "ord-user#1",
    "ord-user#2",
    "ord-user2#1",
    "ord-user2#2",
    "ord-core#1",
    "ord-core#2",
  ]);
});

test("unsubscribe idempotent", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  const off = { current: () => {} };
  await t.host.install(
    makeUnit({ name: "unsub", points: ["boundary.settle.after"] }, (g) => {
      off.current = g.on("boundary.settle.after", () => {
        calls.push("x");
      });
      g.on("boundary.settle.after", () => {
        calls.push("y");
      });
    }),
  );
  off.current();
  off.current();
  await t.host.dispatch("boundary.settle.after", settled(t), {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(calls).toEqual(["y"]);
});
