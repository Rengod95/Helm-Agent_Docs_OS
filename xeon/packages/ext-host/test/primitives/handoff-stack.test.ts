// `handoff` 명령의 흐름 시험(drive-isolation.md 2.1, 2.6). 맡기기 체인의 복귀 값, 거부 결과(예외가 아니다), 맡은 쪽의 끊김,
// 대상이 부여 전에 꺼진 경우, 재시작 복원을 본다. 단계 함수와 명령 기록의 값을 맞춘다. 승인과 기록 저장소, 루프는 대역이다.
import { expect, test } from "bun:test";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type {
  DriveCommand,
  DriveFrameView,
  DriveOptions,
  StepResult,
} from "@fresnel/contracts/extensions";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { acquiredOf, releasedOf, type Host } from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

type Command = DriveCommand<never>;

/** 프레임 한 줄: 깊이, 플러그인, 상태 */
type Row = readonly [number, string | null, DriveFrameView["state"]];

/** 단계 함수가 불릴 때 본 것 */
interface Seen {
  readonly plugin: string;
  readonly last: StepResult | null;
  readonly calledBy: string | null;
  readonly frames: readonly Row[];
}

function rowsOf(t: Host, thread: ThreadId): Row[] {
  return t.host.driveFrames(thread).map((frame): Row => [frame.depth, frame.plugin, frame.state]);
}

function handoff(to: string, input: string): Command {
  return { do: "handoff", to, input };
}

function doneWith(result: JsonValue): Command {
  return { do: "done", result };
}

const DONE: Command = { do: "done" };
const YIELD: Command = { do: "yield" };

/** 단계 함수를 등록한다. 호출마다 본 것을 `seen`에 쌓고 `decide`가 고른 명령을 돌려준다 */
async function install(
  t: Host,
  thread: ThreadId,
  seen: Seen[],
  name: string,
  decide: (last: StepResult | null) => Command,
  options?: DriveOptions,
): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name }, (g) => {
      g.drive(({ last, frame }) => {
        seen.push({ plugin: name, last, calledBy: frame.calledBy, frames: rowsOf(t, thread) });
        return Promise.resolve(decide(last));
      }, options);
    }),
  );
}

test("a chain A to B to C returns each done result to the frame that handed off and empties the stack", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) =>
    last === null ? handoff("frame-b", "a to b") : DONE,
  );
  await install(t, thread, seen, "frame-b", (last) => {
    if (last === null) return handoff("frame-c", "b to c");
    return doneWith({ r: 2 });
  });
  await install(t, thread, seen, "frame-c", () => doneWith({ r: 1 }));
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  // 단계마다 본 스택: 맡긴 쪽은 waiting, 맨 위만 driving이다. 맡긴 쪽이 돌려받는 값은 `last`로 온다
  expect(seen).toEqual([
    {
      plugin: "frame-a",
      last: null,
      calledBy: null,
      frames: [
        [0, null, "driving"],
        [1, "frame-a", "driving"],
      ],
    },
    {
      plugin: "frame-b",
      last: null,
      calledBy: "frame-a",
      frames: [
        [0, null, "driving"],
        [1, "frame-a", "waiting"],
        [2, "frame-b", "driving"],
      ],
    },
    {
      plugin: "frame-c",
      last: null,
      calledBy: "frame-b",
      frames: [
        [0, null, "driving"],
        [1, "frame-a", "waiting"],
        [2, "frame-b", "waiting"],
        [3, "frame-c", "driving"],
      ],
    },
    {
      plugin: "frame-b",
      last: { kind: "handoff", status: "done", result: { r: 1 } },
      calledBy: "frame-a",
      frames: [
        [0, null, "driving"],
        [1, "frame-a", "waiting"],
        [2, "frame-b", "driving"],
      ],
    },
    {
      plugin: "frame-a",
      last: { kind: "handoff", status: "done", result: { r: 2 } },
      calledBy: null,
      frames: [
        [0, null, "driving"],
        [1, "frame-a", "driving"],
      ],
    },
  ]);

  // 기록: 부여마다 parent와 depth가 맡긴 쪽을 가리키고, 반납은 모두 done이다
  const grants = acquiredOf(t, thread);
  expect(grants.map((grant) => [grant.scopeId, grant.depth ?? null, grant.parent ?? null])).toEqual(
    [
      ["frame-a", 0, null],
      ["frame-b", 1, grants[0]?.leaseId ?? null],
      ["frame-c", 2, grants[1]?.leaseId ?? null],
    ],
  );
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-c", "done"],
    ["frame-b", "done"],
    ["frame-a", "done"],
  ]);
  expect(t.host.leaseOf(thread)).toBeNull();
  expect(rowsOf(t, thread)).toEqual([[0, null, "driving"]]);
});

test("a handoff that is refused for self or for an unknown plugin gives a refused result and changes nothing", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-solo", (last) => {
    if (last === null) return handoff("frame-solo", "me");
    if (last.kind === "refused" && last.code === "self_handoff") return handoff("ghost", "who");
    return DONE;
  });
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-solo").ok).toBe(true);
  await t.settled();

  expect(seen.map((call) => call.last)).toEqual([
    null,
    { kind: "refused", code: "self_handoff" },
    { kind: "refused", code: "target_unavailable" },
  ]);
  // 거부는 예외가 아니므로 임대는 done으로 끝나고 다른 기록은 없다
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-solo"]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
});

test("a handoff to a plugin already on the stack is refused as already_in_stack and the stack stays as it was", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) =>
    last === null ? handoff("frame-b", "down") : doneWith({ from: "a" }),
  );
  await install(t, thread, seen, "frame-b", (last) => {
    if (last === null) return handoff("frame-a", "back up");
    return DONE;
  });
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  const refusal = seen.find((call) => call.plugin === "frame-b" && call.last !== null);
  expect(refusal?.last).toEqual({ kind: "refused", code: "already_in_stack" });
  // 맡긴 쪽은 B가 done으로 물러난 결과를 받는다. B는 `null`이 아닌 값을 본 뒤 done했다
  expect(seen.at(-1)).toEqual({
    plugin: "frame-a",
    last: { kind: "handoff", status: "done", result: null },
    calledBy: null,
    frames: [
      [0, null, "driving"],
      [1, "frame-a", "driving"],
    ],
  });
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-b", "done"],
    ["frame-a", "done"],
  ]);
});

test("a handoff past the depth limit is refused as depth_limit, and the stack and the records do not change", async () => {
  const t = await createTestHost({ settings: { driveMaxDepth: 2 } });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) =>
    last === null ? handoff("frame-b", "one") : DONE,
  );
  await install(t, thread, seen, "frame-b", (last) => {
    if (last === null) return handoff("frame-c", "two");
    return DONE;
  });
  await install(t, thread, seen, "frame-c", () => DONE);
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  // 상한 2에서 프레임 셋째(C)는 들어갈 수 없다. B는 거부 결과를 받고 같은 프레임에서 계속한다
  const refused = seen.filter((call) => call.plugin === "frame-b" && call.last !== null);
  expect(refused.map((call) => call.last)).toEqual([{ kind: "refused", code: "depth_limit" }]);
  expect(refused[0]?.frames).toEqual([
    [0, null, "driving"],
    [1, "frame-a", "waiting"],
    [2, "frame-b", "driving"],
  ]);
  expect(seen.map((call) => call.plugin)).not.toContain("frame-c");
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-b", "done"],
    ["frame-a", "done"],
  ]);
});

test("a handed-off frame that fails with an error releases with error and its caller resumes with aborted", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) => {
    if (last === null) return handoff("frame-b", "risky");
    return DONE;
  });
  await install(t, thread, seen, "frame-b", (): Command => {
    throw new Error("step failed");
  });
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  expect(seen.at(-1)).toEqual({
    plugin: "frame-a",
    last: { kind: "handoff", status: "aborted", result: null },
    calledBy: null,
    frames: [
      [0, null, "driving"],
      [1, "frame-a", "driving"],
    ],
  });
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-b", "error"],
    ["frame-a", "done"],
  ]);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(1);
});

test("a queued handoff whose target is turned off before it is granted is dropped, and the caller resumes with aborted", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) => {
    if (last !== null) return DONE;
    // 맡기기를 내기 전에 대상을 끈다. 부여 경계에서 대상을 쓸 수 없으니 요청을 버리고 맡긴 쪽을 끊김으로 잇는다
    t.host.registration("frame-b")?.disable();
    return handoff("frame-b", "never");
  });
  await install(t, thread, seen, "frame-b", () => DONE);
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();

  // 맡기기는 명령 시점에 받아들여졌고(refused가 아니다) 부여 경계에서 버려졌다
  expect(seen.map((call) => call.last)).toEqual([
    null,
    { kind: "handoff", status: "aborted", result: null },
  ]);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.code === "scope_notice")).toHaveLength(1);
  expect(seen.filter((call) => call.plugin === "frame-b")).toEqual([]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a"]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
});

test("after a restart with a stack of A and B, only B calls its step and B's done resumes A with handoff done", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", () => DONE);
  await install(t, thread, seen, "frame-b", (last) => (last === null ? doneWith({ r: 3 }) : DONE));
  // 저장된 기록: 아래 프레임 A(depth 0)와 맡긴 B(depth 1, parent가 A). 재시작이 읽을 열린 임대 두 개다
  const limits = { maxTurns: 4 };
  await t.records.commit({
    threadId: thread,
    requestId: "seed:handoff-restart",
    drafts: [
      makeDraft(t.ids, {
        threadId: thread,
        kind: "lease.acquired",
        payload: {
          leaseId: "lease-a",
          scopeId: "frame-a",
          lineageId: "lease-a",
          limits,
          leaseEpoch: 1,
          depth: 0,
          requestId: "rq-a",
        },
      }),
      makeDraft(t.ids, {
        threadId: thread,
        kind: "lease.acquired",
        payload: {
          leaseId: "lease-b",
          scopeId: "frame-b",
          lineageId: "lease-b",
          limits,
          leaseEpoch: 1,
          depth: 1,
          parent: "lease-a",
        },
      }),
    ],
  });
  await t.host.openThread(thread);
  expect(rowsOf(t, thread)).toEqual([
    [0, null, "driving"],
    [1, "frame-a", "waiting"],
    [2, "frame-b", "driving"],
  ]);
  await t.settled();

  // 맨 위 B만 부른다. 맡긴 쪽 호출은 B가 done하기 전에는 없다. B의 calledBy는 기록의 parent로 찾은 A다
  expect(seen).toEqual([
    {
      plugin: "frame-b",
      last: null,
      calledBy: "frame-a",
      frames: [
        [0, null, "driving"],
        [1, "frame-a", "waiting"],
        [2, "frame-b", "driving"],
      ],
    },
    {
      plugin: "frame-a",
      last: { kind: "handoff", status: "done", result: { r: 3 } },
      calledBy: null,
      frames: [
        [0, null, "driving"],
        [1, "frame-a", "driving"],
      ],
    },
  ]);
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-b", "done"],
    ["frame-a", "done"],
  ]);
});

test("a handed-off frame that is turned off while idle releases as disabled and its caller resumes with aborted", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, thread, seen, "frame-a", (last) =>
    last === null ? handoff("frame-b", "x") : DONE,
  );
  await install(t, thread, seen, "frame-b", () => YIELD);
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();
  expect(rowsOf(t, thread).map((row) => row[1])).toEqual([null, "frame-a", "frame-b"]);

  // 맡은 프레임이 유휴인 동안 등록을 끈다. 그 프레임과 위가 `disabled`로 내려가고, 맡긴 쪽은 끊김으로 이어 간다
  t.host.registration("frame-b")?.disable();
  await t.settled();
  expect(releasedOf(t, thread).map((released) => [released.scopeId, released.reason])).toEqual([
    ["frame-b", "disabled"],
    ["frame-a", "done"],
  ]);
  expect(seen.at(-1)?.last).toEqual({ kind: "handoff", status: "aborted", result: null });
  expect(t.host.driveFrames(thread)).toHaveLength(1);
});
