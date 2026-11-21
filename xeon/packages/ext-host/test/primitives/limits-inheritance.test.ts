// 맡은 프레임의 한도 상속(drive-isolation.md 2.3). 맡은 프레임의 한도는 실효 한도를 맡긴 쪽의 남은 양으로 한 번 더 줄이고,
// 맡은 쪽이 쓴 턴·서브에이전트는 맡긴 쪽의 사용량에도 더해진다. 단계 함수가 받는 `budget`과 `driveFrames`의 값을 본다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  DriveCommand,
  DriveFrameView,
  DriveLockBudget,
  DriveOptions,
  StepResult,
} from "@fresnel/contracts/extensions";
import { createTestHost, fixedIdFactory, type MemoryLoopOptions } from "../../src/testing/index.ts";
import { acquiredOf, releasedOf, type Host } from "./fixtures/fake-approvals.ts";
import { makeOrchestrationUnit } from "./fixtures/support.ts";

type Command = DriveCommand<never>;

const ids = fixedIdFactory(9000);
const TURN = ids.next("trn");
const CHILD = ids.next("thr");
/** 턴과 서브에이전트가 모두 끝나는 루프. 사용량은 0이라 한도는 횟수만 센다 */
const SCRIPTED: MemoryLoopOptions = {
  runTurn: () => Promise.resolve({ outcome: { turnId: TURN, status: "completed" }, usage: null }),
  runSpawn: () =>
    Promise.resolve({ outcome: { childThreadId: CHILD, status: "completed" }, usage: null }),
};

const GO: Command = { do: "turn", input: { kind: "user", content: "go" } };
const DONE: Command = { do: "done" };

/** 단계 함수가 불릴 때 본 것: 예산과 맨 위의 `last`, 그 순간의 `driveFrames` 전체 */
interface Seen {
  readonly plugin: string;
  readonly last: StepResult | null;
  readonly budget: DriveLockBudget;
  readonly frames: readonly DriveFrameView[];
}

async function install(
  t: Host,
  thread: ThreadId,
  seen: Seen[],
  name: string,
  decide: (last: StepResult | null) => Command,
  options?: DriveOptions,
): Promise<void> {
  await t.host.install(
    makeOrchestrationUnit({ name }, (g) => {
      g.drive(({ last, budget }) => {
        seen.push({ plugin: name, last, budget, frames: t.host.driveFrames(thread) });
        return Promise.resolve(decide(last));
      }, options);
    }),
  );
}

test("a handed-off frame's turn limit is the caller's remaining turns, and its turn is charged to the caller", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(
    t,
    thread,
    seen,
    "frame-a",
    (last) => {
      if (last === null) return GO;
      if (last.kind === "ok" && last.of === "turn")
        return { do: "handoff", to: "frame-b", input: "x" };
      return DONE;
    },
    { limits: { maxTurns: 3 } },
  );
  await install(t, thread, seen, "frame-b", (last) => (last === null ? GO : DONE));
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  // A의 예산: 처음 3, 자기 턴 한 번 뒤 2, B가 턴 한 번 쓴 뒤 1이다. B는 A의 남은 2를 넘지 못하므로 한도 2이고,
  // 자기 턴 한 번 뒤에는 남은 1이다
  const calls = (name: string) => seen.filter((call) => call.plugin === name);
  expect(calls("frame-a").map((call) => call.budget.turns)).toEqual([3, 2, 1]);
  expect(calls("frame-b").map((call) => call.budget.turns)).toEqual([2, 1]);

  // B가 턴을 쓴 뒤 맨 위 B의 사용량은 자기 1이고, 맡긴 A의 사용량은 자기 1과 B의 1을 합한 2다
  const bSecond = calls("frame-b")[1];
  expect(bSecond?.frames.map((view) => [view.plugin, view.used.turns, view.limits.turns])).toEqual([
    [null, 0, undefined],
    ["frame-a", 2, 3],
    ["frame-b", 1, 2],
  ]);

  const grants = acquiredOf(t, thread);
  expect(grants.map((grant) => [grant.scopeId, grant.limits.maxTurns])).toEqual([
    ["frame-a", 3],
    ["frame-b", 2],
  ]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done", "done"]);
});

test("a handed-off frame whose caller has no turns left is released as budget at once, and the caller resumes as aborted", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(
    t,
    thread,
    seen,
    "frame-a",
    (last) => {
      if (last === null) return GO;
      if (last.kind === "ok" && last.of === "turn")
        return { do: "handoff", to: "frame-b", input: "x" };
      return DONE;
    },
    { limits: { maxTurns: 1 } },
  );
  await install(t, thread, seen, "frame-b", () => GO);
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  // B는 한도 0으로 태어나 턴을 시작하지 못한다. 턴 전에 예산 검사에서 내려가고, 맡긴 A는 끊김으로 이어진다
  expect(seen.filter((call) => call.plugin === "frame-b").map((call) => call.budget.turns)).toEqual(
    [0],
  );
  expect(seen.filter((call) => call.plugin === "frame-a").map((call) => call.last)).toEqual([
    null,
    { kind: "ok", of: "turn", value: { turnId: TURN, status: "completed" } },
    { kind: "handoff", status: "aborted", result: null },
  ]);
  expect(t.loop.turns).toHaveLength(1);
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-b", "budget"],
    ["frame-a", "done"],
  ]);
});

test("a spawn by a handed-off frame is charged to the caller's spawns and the caller's budget shrinks", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) =>
    last === null ? { do: "handoff", to: "frame-b", input: "x" } : DONE,
  );
  await install(t, thread, seen, "frame-b", (last) =>
    last === null ? { do: "spawn", agent: "worker", task: "child" } : DONE,
  );
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  // 서브에이전트 하나는 맡은 쪽이 쓴 것이고 맡긴 쪽의 spawns에도 더해진다
  const bSecond = seen.filter((call) => call.plugin === "frame-b")[1];
  expect(bSecond?.frames.map((view) => [view.plugin, view.used.spawns])).toEqual([
    [null, 0],
    ["frame-a", 1],
    ["frame-b", 1],
  ]);
  expect(seen.findLast((call) => call.plugin === "frame-a")?.budget.spawns).toBe(7);
  expect(t.loop.spawns).toHaveLength(1);
});

test("a handed-off frame that asks for less keeps its own smaller limit", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) =>
    last === null ? { do: "handoff", to: "frame-b", input: "x" } : DONE,
  );
  await install(t, thread, seen, "frame-b", () => DONE, { limits: { maxTurns: 1 } });
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  // 맡긴 쪽의 남은 4턴보다 작은 자기 요청 1턴을 그대로 쓴다
  expect(seen.filter((call) => call.plugin === "frame-b").map((call) => call.budget.turns)).toEqual(
    [1],
  );
  expect(acquiredOf(t, thread)[1]?.limits.maxTurns).toBe(1);
});
