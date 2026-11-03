import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { extReadViewOf } from "../../src/index.ts";
import type { DispatchPolicy } from "../../src/primitives/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

/** 이름별 tier. guard(0)는 고정 순위라 순서 덮어쓰기가 움직이지 못한다 */
const TIER_OF: Readonly<Record<string, number>> = {
  "ord-guard": 0,
  "ord-a": 1,
  "ord-b": 1,
  "ord-c": 3,
};

interface OrderingPolicy {
  readonly policy: DispatchPolicy;
  /** 다음 단계 경계에서 적용할 순서를 보류한다. 바로 적용되지는 않는다 */
  queue(order: readonly string[] | undefined): void;
  boundaries(): number;
}

/** 보류된 순서 변경을 onStepBoundary에서 적용하는 정책. 운영 계층이 하는 일을 흉내 낸다 */
function orderingPolicy(): OrderingPolicy {
  let applied: readonly string[] | undefined;
  let pending: { readonly order: readonly string[] | undefined } | undefined;
  let boundaryCalls = 0;
  return {
    policy: {
      tierOf: (entry) => TIER_OF[entry.extension] ?? 0,
      budgetMs: () => null,
      onHandlerFailure: () => {},
      handlerOrder: () => applied,
      onStepBoundary: () => {
        boundaryCalls += 1;
        if (pending !== undefined) {
          applied = pending.order;
          pending = undefined;
        }
      },
    },
    queue(order) {
      pending = { order };
    },
    boundaries: () => boundaryCalls,
  };
}

async function setup(ordering: OrderingPolicy) {
  const t = await createTestHost({ policy: ordering.policy });
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, thread };
}

/** 같은 `boundary.settle.after`(tap) 훅에 이름을 밀어 넣는 핸들러. loadIndex를 따로 줘서 기본 순서가 분명하다 */
async function installRecorder(
  t: TestHost,
  name: string,
  loadIndex: number,
  calls: string[],
): Promise<void> {
  await t.host.install(
    makeUnit({ name, loadIndex, hooks: ["boundary.settle.after"] }, (g) => {
      g.on("boundary.settle.after", () => {
        calls.push(name);
      });
    }),
  );
}

async function installRecorders(t: TestHost, calls: string[]): Promise<void> {
  await installRecorder(t, "ord-guard", 0, calls);
  await installRecorder(t, "ord-a", 1, calls);
  await installRecorder(t, "ord-b", 2, calls);
  await installRecorder(t, "ord-c", 3, calls);
}

/** 한 번 디스패치하고, 그 디스패치가 부른 핸들러 이름을 호출 순서대로 돌려준다 */
async function settleOrder(
  t: TestHost,
  thread: ThreadId,
  calls: string[],
  dispatchKey: string,
): Promise<string[]> {
  const from = calls.length;
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey },
  );
  return calls.slice(from);
}

async function turnBefore(t: TestHost, thread: ThreadId, dispatchKey: string): Promise<void> {
  await t.host.dispatch(
    "boundary.turn.before",
    { turnId: t.ids.next("trn") },
    { threadId: thread, dispatchKey },
  );
}

async function stepBefore(t: TestHost, thread: ThreadId, dispatchKey: string): Promise<void> {
  await t.host.dispatch(
    "boundary.step.before",
    { stepIndex: 0, stepId: t.ids.next("stp"), timestamp: 0 },
    { threadId: thread, dispatchKey },
  );
}

test("default order: guard first, then by tier, then by load index", async () => {
  const ordering = orderingPolicy();
  const { t, thread } = await setup(ordering);
  const calls: string[] = [];
  await installRecorders(t, calls);
  expect(await settleOrder(t, thread, calls, "ord-default")).toEqual([
    "ord-guard",
    "ord-a",
    "ord-b",
    "ord-c",
  ]);
});

test("override applies from the next step boundary and can move a tier 1 handler after a tier 3 handler", async () => {
  const ordering = orderingPolicy();
  const { t, thread } = await setup(ordering);
  const calls: string[] = [];
  await installRecorders(t, calls);
  ordering.queue(["ord-c", "ord-a"]);
  // 경계 전에는 보류 중인 순서가 적용되지 않는다
  expect(await settleOrder(t, thread, calls, "ord-before-boundary")).toEqual([
    "ord-guard",
    "ord-a",
    "ord-b",
    "ord-c",
  ]);
  await stepBefore(t, thread, "ord-boundary");
  // guard 뒤 rest는 [a, b, c]다. a와 c가 차지한 자리에 c, a 순서로 놓인다. b는 자리를 지킨다
  expect(await settleOrder(t, thread, calls, "ord-after-boundary")).toEqual([
    "ord-guard",
    "ord-c",
    "ord-b",
    "ord-a",
  ]);
});

test("a guard handler stays first even when the override lists it last", async () => {
  const ordering = orderingPolicy();
  const { t, thread } = await setup(ordering);
  const calls: string[] = [];
  await installRecorders(t, calls);
  ordering.queue(["ord-c", "ord-b", "ord-a", "ord-guard"]);
  await stepBefore(t, thread, "ord-boundary");
  expect(await settleOrder(t, thread, calls, "ord-guard-last")).toEqual([
    "ord-guard",
    "ord-c",
    "ord-b",
    "ord-a",
  ]);
});

test("onStepBoundary runs once for each boundary.turn.before and boundary.step.before dispatch, and for no other hook", async () => {
  const ordering = orderingPolicy();
  const { t, thread } = await setup(ordering);
  const calls: string[] = [];
  await installRecorders(t, calls);
  await settleOrder(t, thread, calls, "ord-count-settle-0");
  expect(ordering.boundaries()).toBe(0);
  await turnBefore(t, thread, "ord-count-turn");
  expect(ordering.boundaries()).toBe(1);
  await stepBefore(t, thread, "ord-count-step");
  expect(ordering.boundaries()).toBe(2);
  await settleOrder(t, thread, calls, "ord-count-settle-1");
  expect(ordering.boundaries()).toBe(2);
});

test("extReadViewOf().handlers() lists the hook's handlers in the same order as dispatch", async () => {
  const ordering = orderingPolicy();
  const { t, thread } = await setup(ordering);
  const calls: string[] = [];
  await installRecorders(t, calls);
  ordering.queue(["ord-c", "ord-a"]);
  await stepBefore(t, thread, "ord-boundary");
  const dispatched = await settleOrder(t, thread, calls, "ord-read-view");
  const listed = extReadViewOf(t.host)
    .handlers()
    .filter((row) => row.point === "boundary.settle.after")
    .map((row) => row.scopeId);
  expect(listed).toEqual(dispatched);
  expect(listed).toEqual(["ord-guard", "ord-c", "ord-b", "ord-a"]);
});
