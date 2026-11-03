// X-17 loop.ask를 drive 함수가 다시 만나는 경우(X.primitives.spec §4.4.3 재호출, §10 미결 X-17 재부여). 실제 호스트와 drive 락
// 중재자 위에서 drive 함수를 다시 부르게 하고, 답이 없을 때, 답이 있을 때, 답 뒤 재시작, 답 없이 재시작, 서로 다른 ask 둘,
// ask 앞의 turn과 spawn(기본 키와 명시 키), 재부여의 계통 id와 낡은 핸들의 펜싱을 본다. 승인 서비스만 대역이고 재시작은 같은 기록·루프·승인 저장소로 새 호스트를 만든다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { AskRequest, LoopHandle } from "@fresnel/contracts/extensions";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost } from "../../src/testing/index.ts";
import {
  acquiredOf,
  fakeApprovals,
  provideApprovals,
  releasedOf,
  type FakeApprovals,
  type Host,
} from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

const card: AskRequest["card"] = {
  questions: [
    {
      id: "q1",
      header: "Plan",
      text: "Proceed?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      multiSelect: false,
      allowFreeText: false,
    },
  ],
};

const answerJson = { q1: { selected: ["yes"] } };

/** drive 함수가 한 호출에서 본 것: 호출마다 돌려받은 결과(던져진 오류는 코드)를 순서대로 */
interface Run {
  readonly seen: string[];
}

function askRequest(requestId: string): AskRequest {
  return { requestId, card };
}

/** ask를 차례로 부르는 drive 그룹. 앞의 ask가 반납을 일으켜 던지면 그 호출은 거기서 끝난다 */
async function installAskChain(
  t: Host,
  name: string,
  run: Run,
  requestIds: readonly string[],
  before?: (loop: LoopHandle) => Promise<void>,
): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name }, (g) => {
      g.drive(async (loop) => {
        try {
          if (before !== undefined) await before(loop);
          await eachInOrder(requestIds, async (requestId) => {
            const outcome = await loop.ask(askRequest(requestId));
            run.seen.push(`${requestId}:${outcome.status}`);
            return "continue";
          });
        } catch (error) {
          run.seen.push(error instanceof PrimitiveError ? error.code : "not_primitive");
        }
      });
    }),
  );
}

/** 같은 기록·루프·승인 저장소로 만든 새 호스트. 프로세스 재시작을 흉내 낸다 */
async function restart(first: Host, approvals: FakeApprovals): Promise<Host> {
  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  await provideApprovals(second, approvals);
  return second;
}

async function answerAll(approvals: FakeApprovals, t: Host): Promise<void> {
  await eachInOrder([...approvals.created], async (request) => {
    if (approvals.service.get(request.approvalId)?.resolution !== null) return "continue";
    expect(
      await approvals.service.respond(request.approvalId, {
        decision: "answer",
        answer: answerJson,
      }),
    ).toEqual({ applied: true });
    return "continue";
  });
  await t.settled();
}

test("a restart before the answer waits on the same approval and opens no second one", async () => {
  const first = await createTestHost();
  const approvals = fakeApprovals(first.timers.now);
  await provideApprovals(first, approvals);
  const run: Run = { seen: [] };
  await installAskChain(first, "rerun-open", run, ["q1"]);
  const thread = first.newThread();
  await first.host.openThread(thread);
  await first.settled();
  expect(run.seen).toEqual(["lease_revoked"]);
  expect(approvals.created).toHaveLength(1);

  await first.host.closeThread(thread);
  const second = await restart(first, approvals);
  await installAskChain(second, "rerun-open", run, ["q1"]);
  await second.host.openThread(thread);
  await second.settled();

  // 다시 부여된 drive 락에서 drive 함수가 다시 불려 같은 ask에 닿고, 같은 승인에 다시 반납한다
  expect(run.seen).toEqual(["lease_revoked", "lease_revoked"]);
  expect(approvals.created).toHaveLength(1);
  expect(new Set(approvals.openedKeys).size).toBe(1);
  expect(second.host.leaseOf(thread)).toBeNull();
  expect(releasedOf(second, thread).map((released) => released.reason)).toEqual([
    "waiting",
    "waiting",
  ]);

  await answerAll(approvals, second);
  expect(run.seen).toEqual(["lease_revoked", "lease_revoked", "q1:answered"]);
  expect(approvals.created).toHaveLength(1);
});

test("an answered ask is returned again by every re-run, also after a restart", async () => {
  const first = await createTestHost();
  const approvals = fakeApprovals(first.timers.now);
  await provideApprovals(first, approvals);
  const run: Run = { seen: [] };
  await installAskChain(first, "rerun-done", run, ["q1"]);
  const thread = first.newThread();
  await first.host.openThread(thread);
  await first.settled();
  await answerAll(approvals, first);
  expect(run.seen).toEqual(["lease_revoked", "q1:answered"]);

  await first.host.closeThread(thread);
  const second = await restart(first, approvals);
  await installAskChain(second, "rerun-done", run, ["q1"]);
  await second.host.openThread(thread);
  await second.settled();

  // 열린 drive 락으로 이어 가며 drive 함수가 다시 불리고, 기록된 답이 그대로 돌아온다
  expect(run.seen).toEqual(["lease_revoked", "q1:answered", "q1:answered"]);
  expect(approvals.created).toHaveLength(1);
  expect(new Set(approvals.openedKeys).size).toBe(1);
  expect(acquiredOf(second, thread)).toHaveLength(2);
  expect(releasedOf(second, thread).map((released) => released.reason)).toEqual(["waiting"]);
  expect(second.host.leaseOf(thread)).not.toBeNull();
});

test("a second, different ask opens its own approval and the first stays answered", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-two", run, ["q1", "q2"]);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(run.seen).toEqual(["lease_revoked"]);
  expect(approvals.created).toHaveLength(1);

  await answerAll(approvals, t);
  // 첫 ask는 기록된 답을 받고, 둘째 ask가 새 승인을 연다
  expect(run.seen).toEqual(["lease_revoked", "q1:answered", "lease_revoked"]);
  expect(approvals.created).toHaveLength(2);
  expect(new Set(approvals.created.map((approval) => approval.requestKey)).size).toBe(2);

  await answerAll(approvals, t);
  expect(run.seen).toEqual([
    "lease_revoked",
    "q1:answered",
    "lease_revoked",
    "q1:answered",
    "q2:answered",
  ]);
  expect(approvals.created).toHaveLength(2);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["waiting", "waiting"]);

  // 재시작 뒤에도 둘 다 기록된 답이고 새 승인은 없다
  await t.host.closeThread(thread);
  const second = await restart(t, approvals);
  await installAskChain(second, "rerun-two", run, ["q1", "q2"]);
  await second.host.openThread(thread);
  await second.settled();
  expect(run.seen.slice(5)).toEqual(["q1:answered", "q2:answered"]);
  expect(approvals.created).toHaveLength(2);
});

test("a turn with an explicit requestId before the ask is not run again after the answer", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-turn-explicit", run, ["q1"], async (loop) => {
    await loop.turn({ input: { kind: "user", content: "go" }, requestId: "step-1" });
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.turns).toHaveLength(1);

  await answerAll(approvals, t);
  expect(run.seen).toEqual(["lease_revoked", "q1:answered"]);
  expect(t.loop.turns).toHaveLength(1);
});

/** `waiting` 반납 바로 뒤의 재부여는 새 `leaseId`를 받되 앞 drive 락의 계통 id를 이어받는다(REQ-X-04) */
function expectOneLineage(t: Host, thread: ThreadId, grants: number): string {
  const acquired = acquiredOf(t, thread);
  expect(acquired).toHaveLength(grants);
  const [first] = acquired;
  if (first === undefined) throw new Error("no lease.acquired");
  expect(first.lineageId).toBe(first.leaseId);
  expect(new Set(acquired.map((grant) => grant.leaseId)).size).toBe(grants);
  expect(acquired.map((grant) => grant.lineageId)).toEqual(acquired.map(() => first.lineageId));
  return first.lineageId;
}

test("a turn with the default key before the ask is not run again after the answer", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-turn-default", run, ["q1"], async (loop) => {
    await loop.turn({ input: { kind: "user", content: "go" } });
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.turns).toHaveLength(1);

  await answerAll(approvals, t);
  expect(run.seen).toEqual(["lease_revoked", "q1:answered"]);
  // F.extensions.spec §4.6: 같은 순서로 같은 호출을 하면 이미 커밋된 turn은 다시 실행되지 않는다
  expect(t.loop.turns).toHaveLength(1);
  const lineage = expectOneLineage(t, thread, 2);
  expect(t.loop.turns.map((turn) => turn.requestId)).toEqual([`${lineage}:0.0`]);
});

test("a spawn with the default key before the ask is not run again after the answer", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-spawn-default", run, ["q1"], async (loop) => {
    await loop.spawn({ agent: "worker", task: "child" });
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.spawns).toHaveLength(1);

  await answerAll(approvals, t);
  expect(run.seen).toEqual(["lease_revoked", "q1:answered"]);
  expect(t.loop.spawns).toHaveLength(1);
  const lineage = expectOneLineage(t, thread, 2);
  expect(t.loop.spawns.map((spawn) => spawn.requestId)).toEqual([`${lineage}:0.0`]);
});

async function turnBeforeAsk(loop: LoopHandle): Promise<void> {
  await loop.turn({ input: { kind: "user", content: "go" } });
}

test("a default-key turn, an ask, the answer and a restart run the turn once", async () => {
  const first = await createTestHost();
  const approvals = fakeApprovals(first.timers.now);
  await provideApprovals(first, approvals);
  const run: Run = { seen: [] };
  await installAskChain(first, "rerun-restart-turn", run, ["q1"], turnBeforeAsk);
  const thread = first.newThread();
  await first.host.openThread(thread);
  await first.settled();

  // 답이 오기 전에 재시작: 새 호스트의 부여가 `waiting` 반납의 계통을 기록에서 이어받는다
  await first.host.closeThread(thread);
  const second = await restart(first, approvals);
  await installAskChain(second, "rerun-restart-turn", run, ["q1"], turnBeforeAsk);
  await second.host.openThread(thread);
  await second.settled();
  expect(first.loop.turns).toHaveLength(1);

  await answerAll(approvals, second);
  expect(run.seen).toEqual(["lease_revoked", "lease_revoked", "q1:answered"]);
  expect(first.loop.turns).toHaveLength(1);
  expectOneLineage(second, thread, 3);

  // 답 뒤 다시 한 번 재시작: 열린 drive 락을 이어 가고 turn은 그대로 하나다
  await second.host.closeThread(thread);
  const third = await restart(first, approvals);
  await installAskChain(third, "rerun-restart-turn", run, ["q1"], turnBeforeAsk);
  await third.host.openThread(thread);
  await third.settled();
  expect(run.seen).toEqual(["lease_revoked", "lease_revoked", "q1:answered", "q1:answered"]);
  expect(first.loop.turns).toHaveLength(1);
});

test("two asks in one run keep one lineage and the default-key turn runs once", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-two-turn", run, ["q1", "q2"], async (loop) => {
    await loop.turn({ input: { kind: "user", content: "go" } });
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  await answerAll(approvals, t);
  await answerAll(approvals, t);
  expect(run.seen).toEqual([
    "lease_revoked",
    "q1:answered",
    "lease_revoked",
    "q1:answered",
    "q2:answered",
  ]);
  expect(t.loop.turns).toHaveLength(1);
  expectOneLineage(t, thread, 3);
});

test("a handle from before the re-grant is fenced with lease_revoked", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  const handles: LoopHandle[] = [];
  await installAskChain(t, "rerun-fence", run, ["q1"], (loop) => {
    handles.push(loop);
    return Promise.resolve();
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  await answerAll(approvals, t);
  expect(handles).toHaveLength(2);
  const [stale, fresh] = handles;
  if (stale === undefined || fresh === undefined) throw new Error("missing handles");

  // 계통이 같아도 낡은 handle은 펜싱된다. 같은 기본 키 turn이어도 새 handle만 통과한다
  const turn = { input: { kind: "user", content: "late" } } as const;
  const rejected = await stale.turn(turn).then(
    () => "resolved",
    (error: unknown) => (error instanceof PrimitiveError ? error.code : "not_primitive"),
  );
  expect(rejected).toBe("lease_revoked");
  expect(t.loop.turns).toHaveLength(0);
  const [first, second] = acquiredOf(t, thread);
  expect(first?.lineageId).toBe(second?.lineageId);
  expect(first?.leaseId).not.toBe(second?.leaseId);
  expect(t.host.leaseOf(thread)?.leaseId).toBe(second?.leaseId);
});
