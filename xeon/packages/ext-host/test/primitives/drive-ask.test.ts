// X-17 loop.ask(X.primitives.spec §4.4.4) 시험. 승인 서비스 대역 위에서 첫 호출의 drive 락 반납, 답 뒤의 재부여와 재호출,
// 거부·만료의 결과, 대기 계수 제외, 끄기, 포트 부재를 본다. 시계와 타이머는 가짜다(결정적이다).
import { expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type { AskOutcome, AskRequest, DriveLockBudget } from "@fresnel/contracts/extensions";
import {
  LeaseAcquiredPayloadSchema,
  LeaseReleasedPayloadSchema,
  type LeaseAcquiredPayload,
  type LeaseReleasedPayload,
} from "@fresnel/contracts/records";
import {
  ApprovalServicePortKey,
  type ApprovalApplyOutcome,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResolution,
  type ApprovalResolvedBy,
  type ApprovalService,
} from "@fresnel/contracts/services";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

/** 시험이 대기 중인 승인에 넣는 해결. 질문 승인은 기억 범위가 once로 고정이라 싣지 않는다 */
interface Settlement {
  readonly decision: ApprovalDecision;
  readonly answer: JsonValue | null;
  readonly resolvedBy: ApprovalResolvedBy;
}

interface FakeEntry {
  readonly request: ApprovalRequest;
  resolution: ApprovalResolution | null;
  readonly waiters: Set<(resolution: ApprovalResolution) => void>;
}

interface FakeApprovals {
  readonly service: ApprovalService;
  /** 새로 만든 승인 요청. 같은 requestKey로 다시 연 요청은 세지 않는다 */
  readonly created: readonly ApprovalRequest[];
  /** open이 받은 requestKey를 받은 순서대로(재호출 포함) */
  readonly openedKeys: readonly string[];
  /** cancel이 받은 approvalId. 끄기와 재시작 시험에서 비어 있어야 한다 */
  readonly cancelled: readonly string[];
  /** 대기 중인 승인을 사용자 답 없이 해결한다(만료 같은 경로). 대기 중이 아니면 시험이 실패한다 */
  settle(approvalId: string, settlement: Settlement): void;
}

/** `ApprovalService` 전체를 메모리에서 구현한 대역. open은 requestKey로 멱등이고, 사용자 답은 respond로 넣는다 */
function fakeApprovals(now: () => number): FakeApprovals {
  const byId = new Map<string, FakeEntry>();
  const byKey = new Map<string, FakeEntry>();
  const created: ApprovalRequest[] = [];
  const openedKeys: string[] = [];
  const cancelled: string[] = [];

  function resolve(entry: FakeEntry, settlement: Settlement): void {
    const resolution: ApprovalResolution = {
      approvalId: entry.request.approvalId,
      decision: settlement.decision,
      answer: settlement.answer,
      remember: "once",
      requestedRemember: null,
      resolvedBy: settlement.resolvedBy,
    };
    entry.resolution = resolution;
    for (const wake of entry.waiters) wake(resolution);
    entry.waiters.clear();
  }

  /** 대기 중인 승인을 해결한다. 해결할 것이 없으면 false */
  function resolvePending(approvalId: string, settlement: Settlement): boolean {
    const entry = byId.get(approvalId);
    if (entry === undefined || entry.resolution !== null) return false;
    resolve(entry, settlement);
    return true;
  }

  /** 대화의 미해결 요청 */
  function pendingOf(threadId: ThreadId): ApprovalRequest[] {
    return [...byId.values()]
      .filter((entry) => entry.resolution === null && entry.request.origin.threadId === threadId)
      .map((entry) => entry.request);
  }

  const service: ApprovalService = {
    async request(input, signal) {
      const opened = await service.open(input);
      if (!opened.ok) return opened;
      if (opened.value.resolution !== null) return ok(opened.value.resolution);
      const waited = await service.wait(opened.value.request.approvalId, signal);
      // 신호가 끊긴 대기는 취소 해결로 돌려주되 커밋하지 않는다(실제 서비스와 같다). 요청을 닫는 일은 호출자의 몫이다
      if (!waited.ok) {
        return ok({
          approvalId: opened.value.request.approvalId,
          decision: "deny",
          answer: null,
          remember: "once",
          requestedRemember: null,
          resolvedBy: "cancelled",
        });
      }
      return ok(waited.value);
    },
    async respond(approvalId, response): Promise<ApprovalApplyOutcome> {
      const entry = byId.get(approvalId);
      if (entry === undefined) return { applied: false, reason: "unknown_approval" };
      if (entry.resolution !== null) return { applied: false, reason: "already_resolved" };
      resolve(entry, {
        decision: response.decision,
        answer: response.answer ?? null,
        resolvedBy: "user",
      });
      return { applied: true };
    },
    pending: pendingOf,
    async restore(threadId) {
      return ok(pendingOf(threadId));
    },
    async cancel(approvalId, _reason) {
      cancelled.push(approvalId);
      const applied = resolvePending(approvalId, {
        decision: "deny",
        answer: null,
        resolvedBy: "cancelled",
      });
      return { applied };
    },
    async open(input) {
      const key = `${input.origin.threadId}|${input.requestKey}`;
      openedKeys.push(input.requestKey);
      const known = byKey.get(key);
      if (known !== undefined) return ok({ request: known.request, resolution: known.resolution });
      const request: ApprovalRequest = {
        ...input,
        approvalId: `appr_${String(created.length + 1)}`,
        surfaceThreadId: input.origin.threadId,
        requestedAt: now(),
      };
      const entry: FakeEntry = { request, resolution: null, waiters: new Set() };
      byId.set(request.approvalId, entry);
      byKey.set(key, entry);
      created.push(request);
      return ok({ request, resolution: null });
    },
    async wait(approvalId, signal) {
      const entry = byId.get(approvalId);
      if (entry === undefined) return err({ kind: "unknown" });
      if (entry.resolution !== null) return ok(entry.resolution);
      const { waiters } = entry;
      const resolution = await new Promise<ApprovalResolution | undefined>((resolve) => {
        if (signal.aborted) {
          resolve(undefined);
          return;
        }
        function onAnswer(answered: ApprovalResolution): void {
          signal.removeEventListener("abort", onAbort);
          resolve(answered);
        }
        function onAbort(): void {
          waiters.delete(onAnswer);
          resolve(undefined);
        }
        waiters.add(onAnswer);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return resolution === undefined ? err({ kind: "aborted" }) : ok(resolution);
    },
    get(approvalId) {
      const entry = byId.get(approvalId);
      return entry === undefined
        ? undefined
        : { request: entry.request, resolution: entry.resolution };
    },
  };

  return {
    service,
    created,
    openedKeys,
    cancelled,
    settle(approvalId, settlement) {
      if (!resolvePending(approvalId, settlement)) {
        throw new Error(`no pending approval ${approvalId} to settle`);
      }
    },
  };
}

async function provideApprovals(t: Host, approvals: FakeApprovals): Promise<void> {
  await t.host.registerPlatform({
    name: "test-approvals",
    setup(ctx) {
      ctx.providePort(ApprovalServicePortKey, approvals.service);
    },
  });
}

/** 요청이 정확히 하나 있으면 그 요청을 돌려준다 */
function onlyApproval(approvals: FakeApprovals): ApprovalRequest {
  const [only, ...rest] = approvals.created;
  if (only === undefined || rest.length > 0) {
    throw new Error(`expected one approval, found ${String(approvals.created.length)}`);
  }
  return only;
}

function eventsOf(t: Host, thread: ThreadId, kind: string): unknown[] {
  return t.records
    .events(thread)
    .filter((event) => event.kind === kind)
    .map((event) => event.payload);
}

/** drive 락 부여 기록을 스키마로 읽는다. 기록이 맞지 않으면 시험을 실패시킨다 */
function acquiredOf(t: Host, thread: ThreadId): LeaseAcquiredPayload[] {
  return t.records.events(thread).flatMap((event): LeaseAcquiredPayload[] => {
    if (event.kind !== "lease.acquired") return [];
    const parsed = parse(LeaseAcquiredPayloadSchema, event.payload);
    if (!parsed.ok) throw new Error("lease.acquired does not match its schema");
    return [parsed.value];
  });
}

/** drive 락 반납 기록을 스키마로 읽는다. 기록이 맞지 않으면 시험을 실패시킨다 */
function releasedOf(t: Host, thread: ThreadId): LeaseReleasedPayload[] {
  return t.records.events(thread).flatMap((event): LeaseReleasedPayload[] => {
    if (event.kind !== "lease.released") return [];
    const parsed = parse(LeaseReleasedPayloadSchema, event.payload);
    if (!parsed.ok) throw new Error("lease.released does not match its schema");
    return [parsed.value];
  });
}

/** 질문 카드. 제목이 있는 선택지와 추천을 넣어 본문 옮김을 함께 본다 */
const questionCard: AskRequest["card"] = {
  questions: [
    {
      id: "q1",
      header: "Plan",
      text: "Proceed?",
      options: [
        { id: "yes", label: "Yes", description: "Run it now", recommended: true },
        { id: "no", label: "No" },
      ],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};

const questionBody = {
  questions: [
    {
      id: "q1",
      header: "Plan",
      text: "Proceed?",
      options: [
        { id: "yes", label: "Yes", description: "Run it now", recommended: true },
        { id: "no", label: "No" },
      ],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};

const answerJson = { q1: { selected: ["yes"] } };

const FULL_BUDGET: DriveLockBudget = { turns: 4, spawns: 8, tokens: 400_000 };

function askRequestOf(requestId: string, title?: string): AskRequest {
  return title === undefined
    ? { requestId, card: questionCard }
    : { requestId, card: questionCard, title };
}

/** `ask`를 부르는 drive 그룹이 본 것: 호출 수, 돌려받은 결과, 던져진 오류 코드, 호출 앞뒤의 예산 */
interface AskProbe {
  calls: number;
  readonly outcomes: AskOutcome[];
  readonly codes: string[];
  readonly budgets: DriveLockBudget[];
}

function newProbe(): AskProbe {
  return { calls: 0, outcomes: [], codes: [], budgets: [] };
}

/** `ask`를 한 번 부르는 drive 그룹. 거부는 오류 코드로 남기고 돌아간다 */
async function installAsker(
  t: Host,
  name: string,
  probe: AskProbe,
  request: AskRequest,
): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name }, (g) => {
      g.drive(async (loop) => {
        probe.calls += 1;
        probe.budgets.push(loop.budget);
        try {
          probe.outcomes.push(await loop.ask(request));
        } catch (error) {
          probe.codes.push(error instanceof PrimitiveError ? error.code : "not_primitive");
          probe.budgets.push(loop.budget);
        }
      });
    }),
  );
}

test("loop.ask opens one question approval and hands the drive lock back as waiting", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const probe = newProbe();
  await installAsker(t, "ask-one", probe, askRequestOf("q1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  expect(probe.calls).toBe(1);
  // 약속은 이행되지 않고 drive 락이 `waiting`으로 반납되어 lease_revoked로 거부된다
  expect(probe.codes).toEqual(["lease_revoked"]);
  expect(probe.outcomes).toEqual([]);
  // 기다리는 동안 turn·spawn 예산은 그대로다
  expect(probe.budgets).toEqual([FULL_BUDGET, FULL_BUDGET]);
  expect(approvals.created).toMatchObject([
    {
      origin: {
        threadId: thread,
        turnId: null,
        stepId: null,
        toolCallId: null,
        caller: "ext:ask-one",
      },
      requestKey: "h_2e1c249bc4d6095d2f7e69308fb746c5d562d286",
      title: "ask-one",
      remember: ["once"],
    },
  ]);
  expect(approvals.created.map((approval) => approval.body)).toEqual([
    { kind: "question", question: questionBody },
  ]);
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "ask-one", reason: "waiting" }]);
  expect(t.host.leaseOf(thread)).toBeNull();
});

test("an answered question re-grants the lock, and the replayed ask returns the same answer with no second approval", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const probe = newProbe();
  await installAsker(t, "ask-two", probe, askRequestOf("q1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  const approval = onlyApproval(approvals);
  expect(
    await approvals.service.respond(approval.approvalId, {
      decision: "answer",
      answer: answerJson,
    }),
  ).toEqual({ applied: true });
  await t.settled();

  // 답이 오면 Registration이 다시 후보가 되어 차수가 오른 새 drive 락을 받고, drive 함수가 다시 불린다
  const acquired = acquiredOf(t, thread);
  expect(acquired).toMatchObject([
    { scopeId: "ask-two", leaseEpoch: 1 },
    { scopeId: "ask-two", leaseEpoch: 2 },
  ]);
  expect(acquired[1]?.leaseId).not.toBe(acquired[0]?.leaseId);
  expect(probe.calls).toBe(2);
  // 같은 requestId의 재호출은 기록된 답을 돌려주고 승인을 새로 만들지 않는다
  expect(probe.outcomes).toEqual([{ status: "answered", answer: answerJson }]);
  expect(approvals.created).toHaveLength(1);
  expect(approvals.openedKeys).toHaveLength(2);
  expect(new Set(approvals.openedKeys).size).toBe(1);
  expect(probe.budgets).toEqual([FULL_BUDGET, FULL_BUDGET, FULL_BUDGET]);
  expect(releasedOf(t, thread)).toMatchObject([{ reason: "waiting" }]);
});

test("a denied question returns the user's feedback and takes its title from loop.ask", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const probe = newProbe();
  await installAsker(t, "ask-deny", probe, askRequestOf("q1", "Confirm plan"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  const approval = onlyApproval(approvals);
  await approvals.service.respond(approval.approvalId, {
    decision: "deny",
    answer: { feedback: "not now" },
  });
  await t.settled();

  expect(probe.outcomes).toStrictEqual([
    { status: "denied", resolvedBy: "user", feedback: "not now" },
  ]);
  expect(approvals.created.map((created) => created.title)).toEqual(["Confirm plan"]);
});

test("an expired question is denied as expired, with no feedback key", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const probe = newProbe();
  await installAsker(t, "ask-expire", probe, askRequestOf("q1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  const approval = onlyApproval(approvals);
  approvals.settle(approval.approvalId, { decision: "deny", answer: null, resolvedBy: "expired" });
  await t.settled();

  expect(probe.outcomes).toStrictEqual([{ status: "denied", resolvedBy: "expired" }]);
});

test("a question that waits for the user does not count toward the lease wait limit", async () => {
  const t = await createTestHost({ settings: { activeDriver: "wait-ask", leaseWaitLimit: 4 } });
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const asker = newProbe();
  await installAsker(t, "wait-ask", asker, askRequestOf("q1"));
  let ticks = 0;
  await t.host.install(
    makeGroupUnit({ name: "wait-turns" }, (g) => {
      g.drive(
        async (loop) => {
          ticks += 1;
          await loop.turn({
            input: { kind: "user", content: `tick ${String(ticks)}` },
            requestId: `tick-${String(ticks)}`,
          });
        },
        { limits: { maxTurns: 10 } },
      );
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  // 질문을 기다리는 그룹이 drive 락을 반납하면 다음 후보가 drive 락을 받는다
  expect(acquiredOf(t, thread)).toMatchObject([{ scopeId: "wait-ask" }, { scopeId: "wait-turns" }]);
  // leaseWaitLimit(4)보다 많은 턴 정착 경계를 넘긴다. 답을 기다리는 그룹이 대기 계수에 들었다면 여기서 거부됐을 것이다.
  // wait-turns가 drive 락을 받기 전 세인 대기는 한도(4) 안이어서 이 시험에서 거부가 나지 않는다
  await eachInOrder([1, 2, 3, 4, 5], async () => {
    await t.boundary(thread).turnSettled();
    await t.settled();
    return "continue";
  });
  expect(eventsOf(t, thread, "lease.rejected")).toEqual([]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "wait-turns", status: "active" });
  expect(asker.codes).toEqual(["lease_revoked"]);
  expect(ticks).toBe(6);
});

test("disabling a waiting group leaves its approval pending, and a later answer grants no lock", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const probe = newProbe();
  await installAsker(t, "ask-off", probe, askRequestOf("q1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  const approval = onlyApproval(approvals);
  t.host.registration("ask-off")?.disable();
  await t.settled();
  expect(t.host.registration("ask-off")?.status).toBe("disabled");
  // 승인은 사용자의 것이라 끄기와 함께 닫지 않는다
  expect(approvals.cancelled).toEqual([]);
  expect(approvals.service.get(approval.approvalId)?.resolution).toBeNull();

  expect(
    await approvals.service.respond(approval.approvalId, {
      decision: "answer",
      answer: answerJson,
    }),
  ).toEqual({ applied: true });
  await t.settled();
  // 꺼진 Registration은 후보가 아니므로 답이 와도 새 drive 락이 생기지 않는다
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(probe.calls).toBe(1);
  expect(approvals.cancelled).toEqual([]);
});

test("loop.ask without the approval port is refused as port_unavailable and keeps the lock", async () => {
  const t = await createTestHost();
  const probe = newProbe();
  await installAsker(t, "ask-bare", probe, askRequestOf("q1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  expect(probe.codes).toEqual(["port_unavailable"]);
  expect(probe.budgets).toEqual([FULL_BUDGET, FULL_BUDGET]);
  expect(eventsOf(t, thread, "lease.released")).toEqual([]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ask-bare", status: "active" });
});

test("an invalid ask request is refused as record_invalid before any approval is opened", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const probe = newProbe();
  await installAsker(t, "ask-bad", probe, { requestId: "", card: questionCard });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  expect(probe.codes).toEqual(["record_invalid"]);
  expect(approvals.created).toEqual([]);
  // 입력이 맞지 않는 호출은 drive 락을 반납하지 않는다
  expect(eventsOf(t, thread, "lease.released")).toEqual([]);
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "ask-bad", status: "active" });
});

test("a stored answer that is not a question answer is refused as record_invalid", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const probe = newProbe();
  await installAsker(t, "ask-broken", probe, askRequestOf("q1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  const approval = onlyApproval(approvals);
  approvals.settle(approval.approvalId, { decision: "answer", answer: "yes", resolvedBy: "user" });
  await t.settled();

  expect(probe.codes).toEqual(["lease_revoked", "record_invalid"]);
  expect(probe.outcomes).toEqual([]);
});
