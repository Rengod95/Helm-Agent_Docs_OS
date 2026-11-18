// 주도 프레임이 가로챈 사용자 메시지의 기록과 재시작 복원 시험(AGE-26, drive-isolation.md 2.4, 2.6).
// 메시지는 받았다고 답하기 전에 `lease.user_input`(held)로 남고, 단계 함수가 `turn`으로 처리하거나 코어 루프로 돌려보낸 뒤 settled가 남는다.
// 재시작 뒤 held이고 settled가 없는 메시지는 플러그인에 다시 전달된다(최소 한 번 전달, `last.requestId`가 같다).
import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DriveCommand, PostItem, StepResult } from "@fresnel/contracts/extensions";
import {
  LeaseUserInputPayloadSchema,
  type LeaseUserInputPayload,
} from "@fresnel/contracts/records";
import { DRIVE_INPUT_MAX_BYTES } from "../../src/primitives/lease.ts";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { createTestHost, fixedIdFactory, type MemoryLoopOptions } from "../../src/testing/index.ts";
import { until } from "../isolation/support/fake-process.ts";
import { acquiredOf, type Host } from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

type Command = DriveCommand<never>;

const ids = fixedIdFactory(9500);
const TURN = ids.next("trn");
const SCRIPTED: MemoryLoopOptions = {
  runTurn: () => Promise.resolve({ outcome: { turnId: TURN, status: "completed" }, usage: null }),
};

const GO: PostItem = { kind: "user", content: "go" };
const LIMITS = { maxTurns: 4 };

interface Seen {
  readonly last: StepResult | null;
}

/** 첫 단계는 쉬고(`yield`), 사용자 메시지는 `turn`으로 처리하는 플러그인. `hold`가 참이면 메시지를 받고 단계가 끝나지 않는다 */
async function install(
  t: Host,
  name: string,
  seen: Seen[],
  options: { readonly hold?: { current: boolean }; readonly firstGo?: boolean } = {},
): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name }, (g) => {
      g.drive(({ last }) => {
        seen.push({ last });
        if (last === null) {
          return Promise.resolve<Command>(
            options.firstGo === true ? { do: "turn", input: GO } : { do: "yield" },
          );
        }
        if (last.kind === "user") {
          if (options.hold?.current === true) return new Promise<Command>(() => {});
          return Promise.resolve<Command>({ do: "turn", input: last.message });
        }
        return Promise.resolve<Command>({ do: "yield" });
      });
    }),
  );
}

function userInputsOf(t: Host, thread: ThreadId): LeaseUserInputPayload[] {
  return t.records.events(thread).flatMap((event): LeaseUserInputPayload[] => {
    if (event.kind !== "lease.user_input") return [];
    const parsed = parse(LeaseUserInputPayloadSchema, event.payload);
    if (!parsed.ok) throw new Error("lease.user_input does not match its schema");
    return [parsed.value];
  });
}

async function seed(
  t: Host,
  thread: ThreadId,
  requestId: string,
  drafts: readonly {
    kind: "lease.acquired" | "lease.requested" | "lease.user_input";
    payload: unknown;
  }[],
): Promise<void> {
  await t.records.commit({
    threadId: thread,
    requestId,
    drafts: drafts.map((draft) =>
      makeDraft(t.ids, { threadId: thread, kind: draft.kind, payload: draft.payload }),
    ),
  });
}

const PROFILE_ACQUIRED = {
  leaseId: "ls-p",
  scopeId: "ui-p",
  lineageId: "ls-p",
  limits: LIMITS,
  leaseEpoch: 1,
  depth: 0,
};

test("a claimed message is recorded as held before the claim answers and as settled after the turn that took it", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, "ui-p", seen);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  expect(userInputsOf(t, thread)).toEqual([]);

  const message: PostItem = { kind: "user", content: "hello" };
  expect(await t.host.claimUserInput(thread, message, "m1")).toBe(true);
  // 답이 돌아온 시점에 held 기록은 이미 있다
  expect(userInputsOf(t, thread)).toEqual([
    { requestId: "m1", scopeId: "ui-p", status: "held", input: message },
  ]);
  await t.settled();

  expect(lastsOf(seen)).toEqual([{ kind: "user", message, requestId: "m1" }]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
  expect(userInputsOf(t, thread)).toEqual([
    { requestId: "m1", scopeId: "ui-p", status: "held", input: message },
    { requestId: "m1", scopeId: "ui-p", status: "settled" },
  ]);
});

test("a message resubmitted with the same request id is not delivered twice", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, "ui-p", seen);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  const message: PostItem = { kind: "user", content: "hello" };
  expect(await t.host.claimUserInput(thread, message, "m1")).toBe(true);
  await t.settled();
  expect(await t.host.claimUserInput(thread, message, "m1")).toBe(true);
  await t.settled();

  expect(lastsOf(seen)).toHaveLength(1);
  expect(t.loop.turns).toHaveLength(1);
  expect(userInputsOf(t, thread).map((entry) => entry.status)).toEqual(["held", "settled"]);
});

test("a message too large to record is not claimed, so the input queue receives it as usual", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, "ui-p", seen);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  const big: PostItem = { kind: "user", content: "x".repeat(DRIVE_INPUT_MAX_BYTES + 1) };
  expect(await t.host.claimUserInput(thread, big, "m-big")).toBe(false);
  await t.settled();
  expect(seen).toEqual([]);
  expect(userInputsOf(t, thread)).toEqual([]);
});

test("a profile's start drive that was waiting for its first message waits again after a restart", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, "ui-p", seen);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  expect(t.host.leaseOf(thread)).not.toBeNull();
  expect(seen).toEqual([]);

  // 재시작: 기록에는 프로필 프레임(`lease.acquired`)만 있고 처리된 메시지가 없다
  await t.host.closeThread(thread);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  expect(t.host.leaseOf(thread)).not.toBeNull();
  expect(seen).toEqual([]);
  expect(t.loop.turns).toEqual([]);

  // 첫 메시지가 오면 그 메시지가 첫 단계의 입력이다(먼저 사용자 말이다)
  const message: PostItem = { kind: "user", content: "hello again" };
  expect(await t.host.claimUserInput(thread, message, "m1")).toBe(true);
  await t.settled();
  expect(lastsOf(seen)).toEqual([{ kind: "user", message, requestId: "m1" }]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
});

test("a profile's start drive that already took its first message does not wait again after a restart", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, "ui-p", seen);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  const message: PostItem = { kind: "user", content: "hello" };
  expect(await t.host.claimUserInput(thread, message, "m1")).toBe(true);
  await t.settled();
  expect(lastsOf(seen)).toHaveLength(1);

  await t.host.closeThread(thread);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  // 처리된 메시지가 있으니 기다리지 않고 단계 함수를 다시 묻는다. 메시지는 다시 전달되지 않는다
  expect(lastsOf(seen)).toEqual([{ kind: "user", message, requestId: "m1" }, null]);
  expect(t.loop.turns).toHaveLength(1);
});

test("a message held but not delivered before a restart reaches the first step of the restored profile frame", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, "ui-p", seen);
  const message: PostItem = { kind: "user", content: "before the crash" };
  await seed(t, thread, "seed:held", [
    { kind: "lease.acquired", payload: PROFILE_ACQUIRED },
    {
      kind: "lease.user_input",
      payload: { requestId: "m1", scopeId: "ui-p", status: "held", input: message },
    },
  ]);
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();

  // 프로필의 시작 주도는 메시지가 첫 단계의 입력이다(그 앞에 null 단계가 없다)
  expect(lastsOf(seen)).toEqual([{ kind: "user", message, requestId: "m1" }]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
  expect(userInputsOf(t, thread).filter((entry) => entry.status === "settled")).toEqual([
    { requestId: "m1", scopeId: "ui-p", status: "settled" },
  ]);
});

test("a message delivered but not settled before a restart is delivered again with the same request id", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  const hold = { current: true };
  await install(t, "ui-p", seen, { hold });
  await t.host.openThread(thread, { startDrive: "ui-p" });
  await t.settled();
  const message: PostItem = { kind: "user", content: "taken but unfinished" };
  expect(await t.host.claimUserInput(thread, message, "m1")).toBe(true);
  await until(() => seen.length === 1, "the step that took the message");
  // 단계가 끝나지 않아 settled는 없다. 이 상태에서 프로세스가 죽는다
  expect(userInputsOf(t, thread).map((entry) => entry.status)).toEqual(["held"]);

  // 기록만 남기고 새 호스트로 다시 연다
  const events = t.records.events(thread);
  const restarted = await createTestHost({ loop: SCRIPTED });
  const restoredThread = restarted.newThread();
  const again: Seen[] = [];
  await install(restarted, "ui-p", again);
  await restarted.records.commit({
    threadId: restoredThread,
    requestId: "seed:copy",
    drafts: events
      .filter((event) => event.kind === "lease.acquired" || event.kind === "lease.user_input")
      .map((event) =>
        makeDraft(restarted.ids, {
          threadId: restoredThread,
          kind: event.kind === "lease.acquired" ? "lease.acquired" : "lease.user_input",
          payload: event.payload,
        }),
      ),
  });
  await restarted.host.openThread(restoredThread, { startDrive: "ui-p" });
  await restarted.settled();

  expect(lastsOf(again)).toEqual([{ kind: "user", message, requestId: "m1" }]);
  expect(restarted.loop.turns.map((turn) => turn.input)).toEqual([message]);
  expect(userInputsOf(restarted, restoredThread).map((entry) => entry.status)).toEqual([
    "held",
    "settled",
  ]);
});

test("a message held while a user start request waited for its lease reaches that frame after a restart", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, "ui-u", seen);
  const message: PostItem = { kind: "user", content: "while queued" };
  await seed(t, thread, "seed:queued", [
    {
      kind: "lease.requested",
      payload: { requestId: "rq-u", scopeId: "ui-u", status: "queued", trigger: "user" },
    },
    {
      kind: "lease.user_input",
      payload: { requestId: "m1", scopeId: "ui-u", status: "held", input: message },
    },
  ]);
  await t.host.openThread(thread);
  await t.settled();

  // 사용자 명령이 시작한 주도는 첫 단계(last null)가 먼저 돌고 메시지는 그 뒤 단계의 입력이다
  expect(lastsOf(seen)).toEqual([null, { kind: "user", message, requestId: "m1" }]);
  expect(acquiredOf(t, thread).map((grant) => grant.requestId)).toEqual(["rq-u"]);
  expect(t.loop.turns.map((turn) => turn.input)).toEqual([message]);
});

test("a held message that no frame and no request can take goes back to the input queue and is settled", async () => {
  const t = await createTestHost({ loop: SCRIPTED });
  const thread = t.newThread();
  const message: PostItem = { kind: "user", content: "nobody home" };
  await seed(t, thread, "seed:orphan", [
    {
      kind: "lease.user_input",
      payload: { requestId: "m1", scopeId: "ui-gone", status: "held", input: message },
    },
  ]);
  await t.host.openThread(thread);
  await t.settled();

  expect(t.queue.items).toEqual([
    {
      threadId: thread,
      scopeId: "ui-gone",
      requestId: "user-return:m1",
      when: "followUp",
      item: message,
    },
  ]);
  expect(userInputsOf(t, thread).map((entry) => entry.status)).toEqual(["held", "settled"]);
});

/** 단계 함수가 받은 `last`에서 turn 결과(플러그인이 `yield`로 넘기는 되돌림)를 뺀다 */
function lastsOf(seen: readonly Seen[]): (StepResult | null)[] {
  return seen.map((call) => call.last).filter((last) => last === null || last.kind !== "ok");
}
