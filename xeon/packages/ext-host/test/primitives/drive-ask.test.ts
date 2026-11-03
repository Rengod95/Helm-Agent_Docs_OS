// X-17 loop.ask(X.primitives.spec §4.4.4) 시험. 승인 서비스 대역 위에서 첫 호출의 drive 락 반납, 답 뒤의 재부여와 재호출,
// 거부·만료의 결과, 대기 계수 제외, 끄기, 포트 부재를 본다. 시계와 타이머는 가짜다(결정적이다).
import { expect, test } from "bun:test";
import type { AskOutcome, AskRequest, DriveLockBudget } from "@fresnel/contracts/extensions";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost } from "../../src/testing/index.ts";
import {
  acquiredOf,
  eventsOf,
  fakeApprovals,
  onlyApproval,
  provideApprovals,
  releasedOf,
  type Host,
} from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

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
