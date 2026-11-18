// X-17 loop.ask를 drive 함수가 다시 만나는 경우(X.primitives.spec §4.4.3 재호출). 실제 호스트와 drive 락 중재자 위에서 단계 함수를 다시 부르게 하고,
// 답이 없을 때, 답이 있을 때, 답 뒤 재시작, 답 없이 재시작, 서로 다른 ask 둘, ask 앞의 turn과 spawn(기본 키와 명시 키), 임대의 계통 id와 반납된 임대의 명령 차단을 본다.
// 답은 임대를 반납하지 않고 같은 호출 안에서 `last`로 온다. 그래서 부여는 한 건이고 계통도 하나다. 승인 서비스만 대역이고 재시작은 같은 기록·루프·승인 저장소로 새 호스트를 만든다.
// 여러 요청을 차례로 묻는 진행 위치는 상태(`at`)에 커밋한다. 단계 함수 바깥의 변수에 두면 재시작 뒤 맞지 않는다.
import { expect, test } from "bun:test";
import { Type } from "typebox";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  AskCard,
  DriveCommand,
  DriveStepInput,
  StepResult,
} from "@fresnel/contracts/extensions";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost, flushMicrotasks } from "../../src/testing/index.ts";
import {
  acquiredOf,
  fakeApprovals,
  provideApprovals,
  releasedOf,
  type FakeApprovals,
  type Host,
} from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

/** 진행 위치 상태: 아직 묻지 않은 요청의 번호. 답이 온 요청 뒤에 커밋하며 넘어간다 */
type Progress = { readonly at: number };

/** 상태가 없는 명령(S가 never)과 진행 상태를 커밋하는 명령. never 명령은 Progress 단계 함수에도 들어간다 */
type Command = DriveCommand<never>;
type ProgressCommand = DriveCommand<Progress>;

const ProgressSchema = Type.Object({ at: Type.Integer({ minimum: 0 }) });
const progressDef = { state: { schema: ProgressSchema, initial: { at: 0 }, version: 1 } };

const card: AskCard = {
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

/** 단계 함수가 본 것: 호출마다 `last`를 이름으로 적은 목록. 첫 단계는 "start", 묻는 요청의 답은 "요청id:답" */
interface Run {
  readonly seen: string[];
}

function yieldOf(): Command {
  return { do: "yield" };
}

function askOf(requestId: string): Command {
  return { do: "ask", card, requestId };
}

/** 기본 키 turn: 엔진이 `${임대 계통}:${상태 판}.${순번}`으로 키를 정한다 */
function turnDefault(content: string): Command {
  return { do: "turn", input: { kind: "user", content } };
}

function turnExplicit(content: string, requestId: string): Command {
  return { do: "turn", input: { kind: "user", content }, requestId };
}

function spawnDefault(): Command {
  return { do: "spawn", agent: "worker", task: "child" };
}

function commitAt(at: number, next: Command): ProgressCommand {
  return { do: "commit", state: { at }, next };
}

/** `last`를 시험에서 읽는 이름. 답이 온 요청은 요청 id와 답을 함께 적는다 */
function labelOf(last: StepResult | null, pending: string): string {
  if (last === null) return "start";
  if (last.kind === "ok") return last.of;
  if (last.kind === "ask") return `${pending}:${last.answer}`;
  if (last.kind === "refused") return `refused:${last.code}`;
  return last.kind;
}

/**
 * 요청 id들을 차례로 묻는 단계 함수. 첫 요청 앞에 `before`가 있으면 그 명령을 먼저 낸다(재생되는 명령이다).
 * 답을 받은 요청 뒤에는 다음 요청으로 진행 위치를 커밋하고 그 요청을 낸다. 마지막 요청의 답 뒤에는 끝낸다.
 */
function chainStep(
  run: Run,
  requestIds: readonly string[],
  before?: Command,
): (input: DriveStepInput<Progress>) => Promise<ProgressCommand> {
  return ({ state, last }) => {
    run.seen.push(labelOf(last, requestIds[state.at] ?? ""));
    const ask = (at: number): Command => askOf(requestIds[at] ?? "");
    if (last === null) {
      return Promise.resolve(before !== undefined && state.at === 0 ? before : ask(state.at));
    }
    if (last.kind === "ok") return Promise.resolve(ask(state.at));
    if (last.kind === "ask" && state.at + 1 < requestIds.length) {
      return Promise.resolve(commitAt(state.at + 1, ask(state.at + 1)));
    }
    return Promise.resolve(yieldOf());
  };
}

/** ask를 차례로 묻는 drive 그룹. 진행 위치는 상태에 두고, 앞 명령이 `before`로 주어지면 첫 요청 앞에 낸다 */
async function installAskChain(
  t: Host,
  name: string,
  run: Run,
  requestIds: readonly string[],
  before?: Command,
): Promise<void> {
  await t.host.install(
    makeGroupUnit({ name, def: progressDef }, (g) => {
      g.drive(chainStep(run, requestIds, before));
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
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await first.settled();
  first.host.startDrive(thread, "rerun-open");
  await first.settled();
  expect(run.seen).toEqual(["start"]);
  expect(approvals.created).toHaveLength(1);

  await first.host.closeThread(thread);
  const second = await restart(first, approvals);
  await installAskChain(second, "rerun-open", run, ["q1"]);
  // 열린 임대가 남아 있으므로 시작 요청은 쓰지 않고 복원된 스택을 잇는다
  await second.host.openThread(thread);
  await second.settled();

  // 복원된 맨 위 프레임의 단계 함수가 다시 불려 같은 ask에 닿고, 같은 승인을 다시 기다린다
  expect(run.seen).toEqual(["start", "start"]);
  expect(approvals.created).toHaveLength(1);
  expect(new Set(approvals.openedKeys).size).toBe(1);
  // 임대는 반납하지 않았으므로 그대로 붙어 있고 새 부여도 없다
  expect(second.host.leaseOf(thread)).toMatchObject({ scopeId: "rerun-open", status: "active" });
  expect(releasedOf(second, thread)).toEqual([]);
  expect(acquiredOf(second, thread)).toHaveLength(1);

  await answerAll(approvals, second);
  expect(run.seen).toEqual(["start", "start", "q1:answered"]);
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
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await first.settled();
  first.host.startDrive(thread, "rerun-done");
  await first.settled();
  await answerAll(approvals, first);
  // 답은 같은 호출 안에서 `last`로 오고, 단계 함수는 끝내기(yield)로 돌아간다. 임대는 그대로 남는다
  expect(run.seen).toEqual(["start", "q1:answered"]);

  await first.host.closeThread(thread);
  const second = await restart(first, approvals);
  await installAskChain(second, "rerun-done", run, ["q1"]);
  await second.host.openThread(thread);
  await second.settled();

  // 복원된 임대로 단계 함수가 다시 불리고, 기록된 답이 그대로 돌아온다. 새 승인도 새 부여도 없다
  expect(run.seen).toEqual(["start", "q1:answered", "start", "q1:answered"]);
  expect(approvals.created).toHaveLength(1);
  expect(new Set(approvals.openedKeys).size).toBe(1);
  expect(acquiredOf(second, thread)).toHaveLength(1);
  expect(releasedOf(second, thread)).toEqual([]);
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
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "rerun-two");
  await t.settled();
  expect(run.seen).toEqual(["start"]);
  expect(approvals.created).toHaveLength(1);

  await answerAll(approvals, t);
  // 첫 ask는 기록된 답을 같은 호출 안에서 받고, 진행 위치를 옮긴 뒤 둘째 ask가 새 승인을 연다
  expect(run.seen).toEqual(["start", "q1:answered"]);
  expect(approvals.created).toHaveLength(2);
  expect(new Set(approvals.created.map((approval) => approval.requestKey)).size).toBe(2);

  await answerAll(approvals, t);
  expect(run.seen).toEqual(["start", "q1:answered", "q2:answered"]);
  expect(approvals.created).toHaveLength(2);
  expect(releasedOf(t, thread)).toEqual([]);

  // 재시작 뒤에는 진행 위치(at=1)가 커밋되어 있어 둘째 ask만 다시 묻는다. 새 승인은 없다
  await t.host.closeThread(thread);
  const second = await restart(t, approvals);
  await installAskChain(second, "rerun-two", run, ["q1", "q2"]);
  await second.host.openThread(thread);
  await second.settled();
  expect(run.seen.slice(3)).toEqual(["start", "q2:answered"]);
  expect(approvals.created).toHaveLength(2);
});

test("a turn with an explicit requestId before the ask is not run again after the answer", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-turn-explicit", run, ["q1"], turnExplicit("go", "step-1"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "rerun-turn-explicit");
  await t.settled();
  expect(t.loop.turns).toHaveLength(1);

  await answerAll(approvals, t);
  // 답은 ask의 `last`로만 오고 앞의 turn은 다시 내지 않는다
  expect(run.seen).toEqual(["start", "turn", "q1:answered"]);
  expect(t.loop.turns).toHaveLength(1);
});

/** 임대의 계통은 하나다. 답을 기다리는 임대는 반납하지 않으므로 부여가 한 건이고, 그 계통 id는 첫 임대의 leaseId와 같다 */
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
  await installAskChain(t, "rerun-turn-default", run, ["q1"], turnDefault("go"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "rerun-turn-default");
  await t.settled();
  expect(t.loop.turns).toHaveLength(1);

  await answerAll(approvals, t);
  expect(run.seen).toEqual(["start", "turn", "q1:answered"]);
  // F.extensions.spec §4.6: 같은 순서로 같은 호출을 하면 이미 커밋된 turn은 다시 실행되지 않는다
  expect(t.loop.turns).toHaveLength(1);
  const lineage = expectOneLineage(t, thread, 1);
  expect(t.loop.turns.map((turn) => turn.requestId)).toEqual([`${lineage}:0.0`]);
});

test("a spawn with the default key before the ask is not run again after the answer", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-spawn-default", run, ["q1"], spawnDefault());
  const thread = t.newThread();
  await t.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "rerun-spawn-default");
  await t.settled();
  expect(t.loop.spawns).toHaveLength(1);

  await answerAll(approvals, t);
  expect(run.seen).toEqual(["start", "spawn", "q1:answered"]);
  expect(t.loop.spawns).toHaveLength(1);
  const lineage = expectOneLineage(t, thread, 1);
  expect(t.loop.spawns.map((spawn) => spawn.requestId)).toEqual([`${lineage}:0.0`]);
});

test("a default-key turn, an ask, the answer and a restart run the turn once", async () => {
  const first = await createTestHost();
  const approvals = fakeApprovals(first.timers.now);
  await provideApprovals(first, approvals);
  const run: Run = { seen: [] };
  await installAskChain(first, "rerun-restart-turn", run, ["q1"], turnDefault("go"));
  const thread = first.newThread();
  await first.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await first.settled();
  first.host.startDrive(thread, "rerun-restart-turn");
  await first.settled();
  expect(run.seen).toEqual(["start", "turn"]);

  // 답이 오기 전에 재시작: 복원된 맨 위 프레임이 다시 불려 같은 turn 키를 내고(이미 커밋되어 다시 실행되지 않는다), 같은 ask를 기다린다
  await first.host.closeThread(thread);
  const second = await restart(first, approvals);
  await installAskChain(second, "rerun-restart-turn", run, ["q1"], turnDefault("go"));
  await second.host.openThread(thread);
  await second.settled();
  expect(first.loop.turns).toHaveLength(1);
  expect(run.seen).toEqual(["start", "turn", "start", "turn"]);

  await answerAll(approvals, second);
  expect(run.seen).toEqual(["start", "turn", "start", "turn", "q1:answered"]);
  expect(first.loop.turns).toHaveLength(1);
  expectOneLineage(second, thread, 1);

  // 답 뒤 다시 한 번 재시작: 복원된 임대의 단계 함수가 다시 불려 turn은 그대로 하나이고, 기록된 답이 돌아온다
  await second.host.closeThread(thread);
  const third = await restart(first, approvals);
  await installAskChain(third, "rerun-restart-turn", run, ["q1"], turnDefault("go"));
  await third.host.openThread(thread);
  await third.settled();
  expect(run.seen.slice(5)).toEqual(["start", "turn", "q1:answered"]);
  expect(first.loop.turns).toHaveLength(1);
});

test("two asks in one run keep one lineage and the default-key turn runs once", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const run: Run = { seen: [] };
  await installAskChain(t, "rerun-two-turn", run, ["q1", "q2"], turnDefault("go"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  // 열기 적용이 정착한 뒤에 시작 요청을 넣는다(겹치면 적용이 한 번 더 돌아 단계 함수가 한 번 더 불린다)
  await t.settled();
  t.host.startDrive(thread, "rerun-two-turn");
  await t.settled();
  await answerAll(approvals, t);
  await answerAll(approvals, t);
  expect(run.seen).toEqual(["start", "turn", "q1:answered", "q2:answered"]);
  expect(t.loop.turns).toHaveLength(1);
  expectOneLineage(t, thread, 1);
});

test("a command from a step whose lease was revoked while it waited is not run", async () => {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const gate: { open: () => void } = { open: () => {} };
  const opened = new Promise<void>((resolve) => {
    gate.open = resolve;
  });
  await t.host.install(
    makeGroupUnit({ name: "rerun-fence" }, (g) => {
      g.drive(async ({ last }) => {
        // 첫 단계는 명령을 내기 전에 기다린다. 기다리는 동안 사용자 중단으로 임대가 반납된다
        if (last !== null) return yieldOf();
        await opened;
        return turnDefault("late");
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "rerun-fence");
  await flushMicrotasks(200);
  await t.boundary(thread).turnSettled({ userInterrupted: true });
  // 기다림이 끝나도 반납된 임대의 turn은 포트에 닿지 않는다
  gate.open();
  await t.settled();
  expect(t.loop.turns).toHaveLength(0);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["revoked"]);
  expect(t.host.leaseOf(thread)).toBeNull();
  expect(acquiredOf(t, thread)).toHaveLength(1);
});
