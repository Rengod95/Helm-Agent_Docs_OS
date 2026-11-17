// X-17 loop.ask(X.primitives.spec §4.4.4) 시험. 승인 서비스 대역 위에서 `ask` 명령의 drive 락 반납, 답 뒤의 재부여와 재호출,
// 거부·만료의 결과, 대기 계수 제외, 끄기, 포트 부재를 본다. 시계와 타이머는 가짜다(결정적이다).
// 단계 함수는 `ask` 명령을 돌려주고 결과는 다음 단계의 `last`로 받는다. 기다리는 동안에는 단계 함수가 다시 불리지 않는다.
import { expect, test } from "bun:test";
import type {
  AskCard,
  AskRequest,
  DriveCommand,
  DriveLockBudget,
  StepResult,
} from "@fresnel/contracts/extensions";
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

/** 상태가 없는 그룹의 명령(S가 never). 어떤 단계 함수에도 그대로 들어간다 */
type Command = DriveCommand<never>;

const questionCard: AskCard = {
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

function yieldOf(): Command {
  return { do: "yield" };
}

function turnOf(content: string, requestId: string): Command {
  return { do: "turn", input: { kind: "user", content }, requestId };
}

/** `AskRequest`를 `ask` 명령으로 옮긴다. 생략한 선택 필드는 싣지 않는다(exactOptionalPropertyTypes) */
function askOf(request: AskRequest): Command {
  return request.title === undefined
    ? { do: "ask", card: request.card, requestId: request.requestId }
    : { do: "ask", card: request.card, requestId: request.requestId, title: request.title };
}

/**
 * `ask`를 부르는 drive 그룹이 본 것: 단계 함수가 불린 차례마다의 `last`와 `budget`. 첫 단계는 `last`가 null이다.
 * 기다리는 동안에는 단계 함수가 다시 불리지 않으므로 `last` 목록에 그 반납은 나타나지 않는다
 */
interface AskProbe {
  readonly lasts: (StepResult | null)[];
  readonly budgets: DriveLockBudget[];
}

function newProbe(): AskProbe {
  return { lasts: [], budgets: [] };
}

/** `ask` 명령 하나를 내는 drive 그룹. 결과를 받은 뒤의 단계는 그대로 끝낸다 */
async function installAsker(
  t: Host,
  name: string,
  probe: AskProbe,
  request: AskRequest,
): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name }, (g) => {
      g.drive(({ last, budget }) => {
        probe.lasts.push(last);
        probe.budgets.push(budget);
        return Promise.resolve(last === null ? askOf(request) : yieldOf());
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

  // 답을 기다리는 `ask`는 결과를 주지 않고 drive 락을 `waiting`으로 반납한다. 단계 함수는 그 한 번만 불린다
  expect(probe.lasts).toEqual([null]);
  // 기다리는 동안 turn·spawn 예산은 그대로다(처음 본 예산이 가득 찬 값)
  expect(probe.budgets).toEqual([FULL_BUDGET]);
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

  // 답이 오면 Registration이 다시 후보가 되어 차수가 오른 새 drive 락을 받고, 단계 함수가 `last` null로 다시 불린다
  const acquired = acquiredOf(t, thread);
  expect(acquired).toMatchObject([
    { scopeId: "ask-two", leaseEpoch: 1 },
    { scopeId: "ask-two", leaseEpoch: 2 },
  ]);
  expect(acquired[1]?.leaseId).not.toBe(acquired[0]?.leaseId);
  // 재부여된 단계는 같은 ask를 다시 내고, 기록된 답을 다음 단계의 `last`로 받는다
  expect(probe.lasts).toEqual([null, null, { kind: "ask", answer: "answered", value: answerJson }]);
  expect(approvals.created).toHaveLength(1);
  expect(approvals.openedKeys).toHaveLength(2);
  expect(new Set(approvals.openedKeys).size).toBe(1);
  // 재부여된 뒤 예산도 가득 차 있다(기다리는 동안 소모하지 않았다)
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

  // 사람이 거부하면 `denied`이고 사유는 피드백이다. 거부 뒤 임대가 다시 부여되어 단계 함수가 `last` null로 한 번 더 불린다
  expect(probe.lasts).toStrictEqual([
    null,
    null,
    { kind: "denied", by: "human", reason: "not now" },
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

  // 만료도 답 없는 해결이라 임대가 다시 부여되고, 단계 함수가 `last` null로 한 번 더 불린 뒤 expired를 받는다
  expect(probe.lasts).toStrictEqual([null, null, { kind: "ask", answer: "expired", value: null }]);
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
        ({ last }) => {
          if (last !== null) return Promise.resolve(yieldOf());
          ticks += 1;
          return Promise.resolve(turnOf(`tick ${String(ticks)}`, `tick-${String(ticks)}`));
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
  expect(asker.lasts).toEqual([null]);
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
  expect(probe.lasts).toEqual([null]);
  expect(approvals.cancelled).toEqual([]);
});

test("loop.ask without the approval port is refused as port_unavailable and keeps the lock", async () => {
  const t = await createTestHost();
  const probe = newProbe();
  await installAsker(t, "ask-bare", probe, askRequestOf("q1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  // 거부는 `refused` 결과로 다음 단계에 온다. 임대와 예산은 그대로다
  expect(probe.lasts).toEqual([null, { kind: "refused", code: "port_unavailable" }]);
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

  expect(probe.lasts).toEqual([null, { kind: "refused", code: "record_invalid" }]);
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

  // 재부여된 단계의 ask가 기록된 답을 읽다가 거부된다. 그 거부가 다음 단계의 `last`다
  expect(probe.lasts).toEqual([null, null, { kind: "refused", code: "record_invalid" }]);
  expect(probe.budgets).toEqual([FULL_BUDGET, FULL_BUDGET, FULL_BUDGET]);
});
