// 주도권 스택과 시작 요청 큐(drive-isolation.md 2.1, 2.2)의 구조 시험. 부여는 사용자 시작과 프로필 시작 요청으로만 생기고,
// 스택은 맨 위만 주도하며, 질문 대기는 임대를 반납하지 않고, 재시작은 열린 임대 목록으로 스택을 다시 세운다.
// 승인 서비스와 기록 저장소는 대역이다. 맡기기(`handoff`)와 깊이 상한의 소비는 이 단계에 없다.
import { expect, test } from "bun:test";
import type { AskCard, DriveCommand, StepResult } from "@fresnel/contracts/extensions";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { createTestHost } from "../../src/testing/index.ts";
import {
  acquiredOf,
  fakeApprovals,
  onlyApproval,
  provideApprovals,
  releasedOf,
} from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

/** 상태가 없는 그룹의 명령(S가 never). 어떤 단계 함수에도 그대로 들어간다 */
type Command = DriveCommand<never>;

function yieldCommand(): Command {
  return { do: "yield" };
}

const questionCard: AskCard = {
  questions: [
    {
      id: "q1",
      header: "Go",
      text: "Go?",
      options: [{ id: "yes", label: "Yes" }],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};

const answer = { q1: { selected: ["yes"] } };

test("a user start grants the frame at depth 0 with no parent", async () => {
  const t = await createTestHost();
  let calls = 0;
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(() => {
        calls += 1;
        return Promise.resolve(yieldCommand());
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(acquiredOf(t, thread)).toEqual([]);

  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();
  const [grant] = acquiredOf(t, thread);
  expect(grant).toMatchObject({ scopeId: "frame-a", leaseEpoch: 1, depth: 0 });
  expect(grant?.parent).toBeUndefined();
  expect(calls).toBe(1);
  expect(
    t.host.driveFrames(thread).map((frame) => [frame.depth, frame.plugin, frame.state]),
  ).toEqual([
    [0, null, "driving"],
    [1, "frame-a", "driving"],
  ]);
});

test("a second user start waits in the queue while the stack is busy, and is granted when the stack empties", async () => {
  const t = await createTestHost();
  const calls: string[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(() => {
        calls.push("a");
        return Promise.resolve(yieldCommand());
      });
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      g.drive(() => {
        calls.push("b");
        return Promise.resolve(yieldCommand());
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a"]);

  // 스택이 차 있으므로 두 번째 사용자 요청은 큐에 남고 부여되지 않는다
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  await t.settled();
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a"]);
  expect(calls).not.toContain("b");

  // frame-a가 같은 상태 판에서 두 번 정착하면 idle로 내려가고, 큐의 요청이 그다음 경계에서 부여된다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "frame-a", reason: "idle" }]);
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
  expect(calls).toContain("b");
});

test("an enabled drive with no start request takes no frame", async () => {
  const t = await createTestHost();
  let calls = 0;
  await t.host.install(
    makeGroupUnit({ name: "frame-idle" }, (g) => {
      g.drive(() => {
        calls += 1;
        return Promise.resolve(yieldCommand());
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(acquiredOf(t, thread)).toEqual([]);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(calls).toBe(0);
  expect(t.host.driveFrames(thread)).toHaveLength(1);
});

test("a restored stack shows the lower frame waiting and only the top frame calls its drive", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-low" }, (g) => {
      g.drive(() => {
        calls.push("low");
        return Promise.resolve(yieldCommand());
      });
    }),
  );
  const seenDepths: number[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-high" }, (g) => {
      g.drive(({ frame }) => {
        calls.push("high");
        seenDepths.push(frame.frameDepth);
        return Promise.resolve(yieldCommand());
      });
    }),
  );
  // 저장된 기록: 아래 프레임(depth 0)과 그 위 프레임(parent가 아래, depth 1). 재시작이 읽을 열린 임대 두 개다
  const limits = { maxTurns: 4 };
  await t.records.commit({
    threadId: thread,
    requestId: "seed:frames",
    drafts: [
      makeDraft(t.ids, {
        threadId: thread,
        kind: "lease.acquired",
        payload: {
          leaseId: "lease-low",
          scopeId: "frame-low",
          lineageId: "lease-low",
          limits,
          leaseEpoch: 1,
          depth: 0,
        },
      }),
      makeDraft(t.ids, {
        threadId: thread,
        kind: "lease.acquired",
        payload: {
          leaseId: "lease-high",
          scopeId: "frame-high",
          lineageId: "lease-high",
          limits,
          leaseEpoch: 1,
          depth: 1,
          parent: "lease-low",
        },
      }),
    ],
  });

  await t.host.openThread(thread);
  // 복원 직후의 스택: 아래는 기다림, 맨 위는 주도 중이다
  expect(
    t.host.driveFrames(thread).map((frame) => [frame.depth, frame.plugin, frame.state]),
  ).toEqual([
    [0, null, "driving"],
    [1, "frame-low", "waiting"],
    [2, "frame-high", "driving"],
  ]);
  await t.settled();
  // 맨 위만 단계 함수를 부른다. 깊이는 스택 인덱스 + 1로 보인다
  expect(calls).toEqual(["high"]);
  expect(seenDepths).toEqual([2]);
  expect(acquiredOf(t, thread)).toHaveLength(2);
});

test("an ask keeps the frame asking, resumes the same run with the answer, and after a restart waits on the same approval", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const lasts: (StepResult | null)[] = [];
  await t.host.install(
    makeGroupUnit({ name: "frame-ask" }, (g) => {
      g.drive(({ last }) => {
        lasts.push(last);
        return Promise.resolve(
          last === null ? { do: "ask", card: questionCard, requestId: "q1" } : yieldCommand(),
        );
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "frame-ask" });
  await t.settled();

  // 질문 대기: 임대는 반납하지 않는다. 프레임 상태만 asking이다
  expect(lasts).toEqual([null]);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(t.host.driveFrames(thread).map((frame) => frame.state)).toEqual(["driving", "asking"]);

  // 답이 오면 같은 호출 안에서 단계 함수가 답을 `last`로 받는다. 재부여는 없다
  const approval = onlyApproval(approvals);
  expect(
    await approvals.service.respond(approval.approvalId, { decision: "answer", answer }),
  ).toEqual({ applied: true });
  await t.settled();
  expect(lasts).toEqual([null, { kind: "ask", answer: "answered", value: answer }]);
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(t.host.driveFrames(thread).map((frame) => frame.state)).toEqual(["driving", "driving"]);
});

test("after a restart the same question waits on its pending approval and opens no second one", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const lasts: (StepResult | null)[] = [];
  const askStep = makeGroupUnit({ name: "frame-ask-again" }, (g) => {
    g.drive(({ last }) => {
      lasts.push(last);
      return Promise.resolve(
        last === null ? { do: "ask", card: questionCard, requestId: "q1" } : yieldCommand(),
      );
    });
  });
  await t.host.install(askStep);
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "frame-ask-again" });
  await t.settled();
  expect(lasts).toEqual([null]);

  // 프로세스 재시작: 옛 호스트를 닫고 같은 기록과 승인 서비스로 새 호스트를 연다
  await t.host.dispose();
  const next = await t.restart();
  await provideApprovals(next, approvals);
  await next.host.install(askStep);
  await next.host.openThread(thread);
  await next.settled();

  // 같은 requestId의 질문은 기존 미해결 승인을 돌려받아 다시 기다린다. 새 승인은 없다
  expect(lasts).toEqual([null, null]);
  expect(approvals.created).toHaveLength(1);
  expect(approvals.openedKeys).toHaveLength(2);
  expect(new Set(approvals.openedKeys).size).toBe(1);
  expect(next.host.driveFrames(thread).map((frame) => frame.state)).toEqual(["driving", "asking"]);

  // 답을 주면 복원된 호출이 그 답을 받는다
  const approval = onlyApproval(approvals);
  expect(
    await approvals.service.respond(approval.approvalId, { decision: "answer", answer }),
  ).toEqual({ applied: true });
  await next.settled();
  expect(lasts).toEqual([null, null, { kind: "ask", answer: "answered", value: answer }]);
  expect(acquiredOf(next, thread)).toHaveLength(1);
});

test("a user stop revokes every frame and empties the start queue, and a later user start works again", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeGroupUnit({ name: "frame-a" }, (g) => {
      g.drive(() => Promise.resolve(yieldCommand()));
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "frame-b" }, (g) => {
      g.drive(() => Promise.resolve(yieldCommand()));
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  expect(t.host.startDrive(thread, "frame-a").ok).toBe(true);
  await t.settled();
  // 보유 중에 다음 요청을 큐에 넣는다
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  await t.settled();

  await t.boundary(thread).turnSettled({ userInterrupted: true });
  await t.settled();
  expect(releasedOf(t, thread)).toMatchObject([{ scopeId: "frame-a", reason: "revoked" }]);
  // 큐가 비어 있으므로 frame-b는 부여되지 않는다
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a"]);
  expect(t.host.driveFrames(thread)).toHaveLength(1);

  // 사용자의 다음 명령은 다시 주도를 시작한다
  expect(t.host.startDrive(thread, "frame-b").ok).toBe(true);
  await t.settled();
  expect(acquiredOf(t, thread).map((grant) => grant.scopeId)).toEqual(["frame-a", "frame-b"]);
});

test("a profile start on a new conversation grants once, and reopening with the lease open grants nothing more", async () => {
  const t = await createTestHost();
  let calls = 0;
  await t.host.install(
    makeGroupUnit({ name: "frame-p" }, (g) => {
      g.drive(() => {
        calls += 1;
        return Promise.resolve(yieldCommand());
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread, { startDrive: "frame-p" });
  await t.settled();
  expect(acquiredOf(t, thread)).toMatchObject([{ scopeId: "frame-p", depth: 0 }]);
  expect(calls).toBe(1);

  // 열린 임대가 있는 대화를 다시 열면 프로필 요청을 만들지 않는다. 복원된 임대가 이어진다
  await t.host.openThread(thread, { startDrive: "frame-p" });
  await t.settled();
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(t.host.driveFrames(thread)).toHaveLength(2);
});
