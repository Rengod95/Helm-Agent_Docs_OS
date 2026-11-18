// 재시작 뒤 맡기기와 시작 요청 복원 시험(AGE-26, drive-isolation.md 2.1, 2.6). 맡긴 입력이 기록에 실리고 재시작 뒤 맡은 프레임이 같은 입력으로 이어 가며,
// 끝난 직후 재시작해도 맡긴 쪽이 결과를 받고, 대기 중이던 시작 요청이 되살아난다. 상한을 넘는 입력은 거절하고 이유가 돌아온다.
import { expect, test } from "bun:test";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type { DriveCommand, StepResult } from "@fresnel/contracts/extensions";
import { LeaseRequestedPayloadSchema } from "@fresnel/contracts/records";
import { parse } from "@fresnel/contracts";
import { DRIVE_INPUT_MAX_BYTES } from "../../src/primitives/lease.ts";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { acquiredOf, releasedOf, type Host } from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

type Command = DriveCommand<never>;

interface Seen {
  readonly plugin: string;
  readonly last: StepResult | null;
  readonly calledBy: string | null;
  readonly input: JsonValue | null;
}

const LIMITS = { maxTurns: 4 };

async function install(
  t: Host,
  seen: Seen[],
  name: string,
  decide: (last: StepResult | null) => Command,
): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name }, (g) => {
      g.drive(({ last, frame }) => {
        seen.push({ plugin: name, last, calledBy: frame.calledBy, input: frame.input });
        return Promise.resolve(decide(last));
      });
    }),
  );
}

function requestedOf(t: Host, thread: ThreadId): ReturnType<typeof parseRequested>[] {
  return t.records
    .events(thread)
    .filter((event) => event.kind === "lease.requested")
    .map((event) => parseRequested(event.payload));
}

function parseRequested(payload: unknown) {
  const parsed = parse(LeaseRequestedPayloadSchema, payload);
  if (!parsed.ok) throw new Error("lease.requested does not match its schema");
  return parsed.value;
}

async function seed(
  t: Host,
  thread: ThreadId,
  requestId: string,
  drafts: readonly {
    kind: "lease.acquired" | "lease.released" | "lease.requested" | "drive.command_settled";
    payload: unknown;
  }[],
): Promise<void> {
  await t.records.commit({
    threadId: thread,
    requestId,
    drafts: drafts.map((draft) =>
      makeDraft(t.ids, {
        threadId: thread,
        kind: draft.kind,
        payload: draft.payload,
      }),
    ),
  });
}

test("a handoff input is recorded on the granted frame and the request is recorded first", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-a", (last) =>
    last === null ? { do: "handoff", to: "rs-b", input: { need: "plugin", n: 3 } } : { do: "done" },
  );
  await install(t, seen, "rs-b", () => ({ do: "done", result: { ok: true } }));
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "rs-a", { input: { go: 1 } }).ok).toBe(true);
  await t.settled();

  const [a, b] = acquiredOf(t, thread);
  expect(a?.input).toEqual({ go: 1 });
  expect(b?.input).toEqual({ need: "plugin", n: 3 });
  expect(b?.parent).toBe(a?.leaseId);
  // 요청 기록은 사용자 명령과 맡기기 둘이고, 부여가 그 요청을 가리킨다
  const requested = requestedOf(t, thread);
  expect(requested.map((request) => [request.scopeId, request.trigger, request.status])).toEqual([
    ["rs-a", "user", "queued"],
    ["rs-b", "handoff", "queued"],
  ]);
  expect([a?.requestId, b?.requestId]).toEqual(requested.map((request) => request.requestId));
  // B가 끝낼 때 결과가 반납 기록에 실린다
  expect(releasedOf(t, thread).find((released) => released.scopeId === "rs-b")?.result).toEqual({
    ok: true,
  });
});

test("a restart in the middle of a handoff gives the handed-off frame the same input and its caller still waits", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  let bDone = false;
  await install(t, seen, "rs-a", (last) =>
    last === null ? { do: "handoff", to: "rs-b", input: { need: "x" } } : { do: "done" },
  );
  await install(t, seen, "rs-b", () => (bDone ? { do: "done", result: "r" } : { do: "yield" }));
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "rs-a").ok).toBe(true);
  await t.settled();
  expect(seen.map((call) => call.plugin)).toEqual(["rs-a", "rs-b"]);

  // 재시작: 대화를 닫고 같은 기록으로 다시 연다
  await t.host.closeThread(thread);
  await t.host.openThread(thread);
  bDone = true;
  await t.settled();

  const bCalls = seen.filter((call) => call.plugin === "rs-b");
  const afterRestart = bCalls.at(-1);
  expect(afterRestart?.input).toEqual({ need: "x" });
  expect(afterRestart?.calledBy).toBe("rs-a");
  // B가 끝나자 A가 결과를 받는다
  expect(seen.findLast((call) => call.plugin === "rs-a")?.last).toEqual({
    kind: "handoff",
    status: "done",
    result: "r",
  });
});

test("when the handed-off frame had just finished before a restart, its caller receives the result", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-a", (last) => (last === null ? { do: "yield" } : { do: "done" }));
  await install(t, seen, "rs-b", () => ({ do: "done" }));
  // 저장된 기록: A, A가 맡긴 B, 결과가 실린 B의 반납. A가 결과를 받기 전에 끊겼다
  await seed(t, thread, "seed:just-finished", [
    {
      kind: "lease.acquired",
      payload: {
        leaseId: "ls-a",
        scopeId: "rs-a",
        lineageId: "ls-a",
        limits: LIMITS,
        leaseEpoch: 1,
        depth: 0,
        requestId: "rq-a",
      },
    },
    {
      kind: "lease.acquired",
      payload: {
        leaseId: "ls-b",
        scopeId: "rs-b",
        lineageId: "ls-b",
        limits: LIMITS,
        leaseEpoch: 1,
        depth: 1,
        parent: "ls-a",
        input: { need: "x" },
      },
    },
    {
      kind: "lease.released",
      payload: { leaseId: "ls-b", scopeId: "rs-b", reason: "done", result: { built: "p1" } },
    },
  ]);
  await t.host.openThread(thread);
  await t.settled();

  expect(seen[0]).toEqual({
    plugin: "rs-a",
    last: { kind: "handoff", status: "done", result: { built: "p1" } },
    calledBy: null,
    input: null,
  });
});

test("a handed-off frame that ended with an error before a restart gives its caller aborted, and a consumed result is not given twice", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-a", () => ({ do: "yield" }));
  await seed(t, thread, "seed:aborted", [
    {
      kind: "lease.acquired",
      payload: {
        leaseId: "ls-a",
        scopeId: "rs-a",
        lineageId: "ls-a",
        limits: LIMITS,
        leaseEpoch: 1,
        depth: 0,
        requestId: "rq-a",
      },
    },
    {
      kind: "lease.acquired",
      payload: {
        leaseId: "ls-b",
        scopeId: "rs-b",
        lineageId: "ls-b",
        limits: LIMITS,
        leaseEpoch: 1,
        depth: 1,
        parent: "ls-a",
      },
    },
    { kind: "lease.released", payload: { leaseId: "ls-b", scopeId: "rs-b", reason: "error" } },
  ]);
  await t.host.openThread(thread);
  await t.settled();
  expect(seen[0]?.last).toEqual({ kind: "handoff", status: "aborted", result: null });
});

test("a result the caller already consumed (a command settled after it) is not given again after a restart", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-a", () => ({ do: "yield" }));
  await seed(t, thread, "seed:consumed", [
    {
      kind: "lease.acquired",
      payload: {
        leaseId: "ls-a",
        scopeId: "rs-a",
        lineageId: "ls-a",
        limits: LIMITS,
        leaseEpoch: 1,
        depth: 0,
        requestId: "rq-a",
      },
    },
    {
      kind: "lease.acquired",
      payload: {
        leaseId: "ls-b",
        scopeId: "rs-b",
        lineageId: "ls-b",
        limits: LIMITS,
        leaseEpoch: 1,
        depth: 1,
        parent: "ls-a",
      },
    },
    {
      kind: "lease.released",
      payload: { leaseId: "ls-b", scopeId: "rs-b", reason: "done", result: 1 },
    },
    {
      kind: "drive.command_settled",
      payload: { scopeId: "rs-a", requestId: "cmd-1", command: "turn", outcome: "completed" },
    },
  ]);
  await t.host.openThread(thread);
  await t.settled();
  expect(seen[0]?.last).toBeNull();
});

test("a handoff request that was queued but not granted before a restart is granted afterwards with its input", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-a", (last) => (last === null ? { do: "yield" } : { do: "done" }));
  await install(t, seen, "rs-b", () => ({ do: "done", result: 7 }));
  await seed(t, thread, "seed:queued-handoff", [
    {
      kind: "lease.acquired",
      payload: {
        leaseId: "ls-a",
        scopeId: "rs-a",
        lineageId: "ls-a",
        limits: LIMITS,
        leaseEpoch: 1,
        depth: 0,
        requestId: "rq-a",
      },
    },
    {
      kind: "lease.requested",
      payload: {
        requestId: "rq-1",
        scopeId: "rs-b",
        status: "queued",
        trigger: "handoff",
        parent: "ls-a",
        input: { q: 1 },
      },
    },
  ]);
  await t.host.openThread(thread);
  await t.settled();

  // 맡긴 쪽은 다시 묻지 않고 기다리다 B가 끝난 뒤 결과를 받는다. B는 기록된 입력으로 돈다
  expect(seen.map((call) => [call.plugin, call.last, call.input])).toEqual([
    ["rs-b", null, { q: 1 }],
    ["rs-a", { kind: "handoff", status: "done", result: 7 }, null],
  ]);
  expect(acquiredOf(t, thread).at(-1)?.requestId).toBe("rq-1");
});

test("a queued user start request survives a restart, and a dropped one does not", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-keep", () => ({ do: "done" }));
  await install(t, seen, "rs-gone", () => ({ do: "done" }));
  await seed(t, thread, "seed:user-requests", [
    {
      kind: "lease.requested",
      payload: {
        requestId: "rq-keep",
        scopeId: "rs-keep",
        status: "queued",
        trigger: "user",
        input: { topic: "t" },
      },
    },
    {
      kind: "lease.requested",
      payload: { requestId: "rq-gone", scopeId: "rs-gone", status: "queued", trigger: "user" },
    },
    {
      kind: "lease.requested",
      payload: { requestId: "rq-gone", scopeId: "rs-gone", status: "dropped", trigger: "user" },
    },
  ]);
  await t.host.openThread(thread);
  await t.settled();

  expect(seen.map((call) => [call.plugin, call.input])).toEqual([["rs-keep", { topic: "t" }]]);
  expect(acquiredOf(t, thread).map((grant) => grant.requestId)).toEqual(["rq-keep"]);
});

test("a start request granted before a restart is not queued again", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-once", () => ({ do: "done" }));
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "rs-once", { input: 1 }).ok).toBe(true);
  await t.settled();
  expect(seen).toHaveLength(1);

  await t.host.closeThread(thread);
  await t.host.openThread(thread);
  await t.settled();
  expect(seen).toHaveLength(1);
});

test("a handoff input over the limit is refused with input_too_large and nothing is recorded", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  const big = "x".repeat(DRIVE_INPUT_MAX_BYTES + 1);
  await install(t, seen, "rs-a", (last) =>
    last === null ? { do: "handoff", to: "rs-b", input: big } : { do: "done" },
  );
  await install(t, seen, "rs-b", () => ({ do: "done" }));
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "rs-a").ok).toBe(true);
  await t.settled();

  expect(seen.map((call) => [call.plugin, call.last])).toEqual([
    ["rs-a", null],
    ["rs-a", { kind: "refused", code: "input_too_large" }],
  ]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["rs-a"]);
  expect(requestedOf(t, thread).map((request) => request.scopeId)).toEqual(["rs-a"]);
});

test("a user start input over the limit is refused as input_too_large and a done result over the limit is refused", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-a", (last) =>
    last === null ? { do: "done", result: "y".repeat(DRIVE_INPUT_MAX_BYTES + 1) } : { do: "done" },
  );
  await t.host.openThread(thread);
  expect(
    t.host.startDrive(thread, "rs-a", { input: "x".repeat(DRIVE_INPUT_MAX_BYTES + 1) }),
  ).toEqual({
    ok: false,
    error: { kind: "input_too_large" },
  });
  expect(requestedOf(t, thread)).toEqual([]);

  expect(t.host.startDrive(thread, "rs-a").ok).toBe(true);
  await t.settled();
  expect(seen.map((call) => call.last)).toEqual([
    null,
    { kind: "refused", code: "result_too_large" },
  ]);
  expect(releasedOf(t, thread).map((released) => released.result)).toEqual([undefined]);
});

test("a death right after a handoff request and before the receiver's frame (the grant commit did not land) lets the handoff continue after a restart", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const seen: Seen[] = [];
  await install(t, seen, "rs-a", (last) =>
    last === null ? { do: "handoff", to: "rs-b", input: { need: "y" } } : { do: "done" },
  );
  await install(t, seen, "rs-b", () => ({ do: "done", result: 9 }));
  // 맡기기 요청 기록(`lease.requested`)이 닿은 직후의 커밋(받는 쪽의 부여)이 닿기 전에 프로세스가 죽는 것을 흉내 낸다:
  // 요청 기록이 성공하면 그 다음 커밋 하나를 거부시킨다
  const commit = t.records.commit.bind(t.records);
  let armed = true;
  Object.defineProperty(t.records, "commit", {
    value: async (request: Parameters<typeof commit>[0]) => {
      const result = await commit(request);
      const handoffRecorded = request.drafts.some(
        (draft) =>
          draft.kind === "lease.requested" && parseRequested(draft.payload).trigger === "handoff",
      );
      if (armed && handoffRecorded) {
        armed = false;
        t.records.failNext("busy");
      }
      return result;
    },
  });
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "rs-a").ok).toBe(true);
  await t.settled();
  // 요청은 기록됐지만 받는 쪽의 프레임은 없다
  expect(requestedOf(t, thread).map((request) => [request.scopeId, request.trigger])).toEqual([
    ["rs-a", "user"],
    ["rs-b", "handoff"],
  ]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["rs-a"]);
  expect(seen.filter((call) => call.plugin === "rs-b")).toEqual([]);

  await t.host.closeThread(thread);
  await t.host.openThread(thread);
  await t.settled();

  // 재시작 뒤 이어진다: 받는 쪽이 기록된 입력으로 돌고, 끝나면 맡긴 쪽이 결과를 받는다
  expect(seen.filter((call) => call.plugin === "rs-b")).toEqual([
    { plugin: "rs-b", last: null, calledBy: "rs-a", input: { need: "y" } },
  ]);
  expect(seen.findLast((call) => call.plugin === "rs-a")?.last).toEqual({
    kind: "handoff",
    status: "done",
    result: 9,
  });
  expect(acquiredOf(t, thread).at(-1)?.requestId).toBe(requestedOf(t, thread)[1]?.requestId);
});
