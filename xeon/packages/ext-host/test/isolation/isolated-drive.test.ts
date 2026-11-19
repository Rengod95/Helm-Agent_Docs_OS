// 격리 주도(`drive.step`) 시험. 단계 함수는 격리 자식이 돌리고 명령은 엔진이 실행한다(drive-isolation.md 1.1, 3.2, 3.3).
// 실제 자식 런타임을 메모리 파이프로 엔진에 잇는다. 결과는 엔진 쪽 기록과 상태 문서의 값으로 비교하고, 같은 픽스처를
// 엔진 안에서 돌린 결과와도 맞춘다. 시나리오는 `start` 명령이 `startDrive`로 넘기는 입력의 `scenario`로 고른다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { parseJson } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { PLUGIN_HOST_MAX_FRAME_BYTES, type PostItem } from "@fresnel/contracts/extensions";
import type { CommandResourceDef } from "../../src/primitives/resources.ts";
import { createIsolatedEntry } from "../../src/index.ts";
import {
  createTestHost,
  fixedIdFactory,
  type MemoryLoopOptions,
  type TestHost,
} from "../../src/testing/index.ts";
import { makeManifest, snapshotOf } from "../primitives/fixtures/support.ts";
import { acquiredOf, eventsOf, releasedOf } from "../primitives/fixtures/fake-approvals.ts";
import { extension as driveExtension } from "./fixtures/drive-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

/** 단계 시간 한도(ms). 시험에서는 이 값을 주입하고 manual 시계를 이 값만큼 옮겨 한도를 넘긴다 */
const DEADLINE_MS = 1000;

/** 주도 픽스처의 매니페스트. 등록 이름은 `dr`이고 그룹 멤버이며 `drives`를 쓴다 */
const DRIVE_MANIFEST = {
  ...makeManifest({ name: "dr", hooks: [], group: {}, drives: true }),
  entry: "./drive-plugin.ts",
};

/** 턴의 결과를 고정한다. 명령 요청 id와 턴 id가 두 호스트에서 같아 기록을 값으로 비교할 수 있다 */
const ids = fixedIdFactory(9100);
const TURN = ids.next("trn");
const SCRIPTED: MemoryLoopOptions = {
  runTurn: () => Promise.resolve({ outcome: { turnId: TURN, status: "completed" }, usage: null }),
};

/** 턴 하나의 결과가 `seen`에 적히는 글(단계 함수가 `JSON.stringify(last)`로 적는다) */
const SEEN_TURN = JSON.stringify({
  kind: "ok",
  of: "turn",
  value: { turnId: TURN, status: "completed" },
});

/** 격리 자식을 띄우는 항목. 프로세스 포트와 시계를 시험이 쥔다 */
function isolatedEntry(port: FakeProcessPort, clock: ManualClock) {
  return createIsolatedEntry({
    manifest: DRIVE_MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "dr-1",
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger([]),
    initTimeoutMs: 1000,
    driveStepDeadlineMs: DEADLINE_MS,
  });
}

function isCommandDef(value: unknown): value is CommandResourceDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "handler" in value &&
    typeof value.handler === "function"
  );
}

function commandNamed(t: TestHost, name: string): CommandResourceDef {
  const def = t.host.resources.list("command").find((record) => record.name === name)?.def;
  if (!isCommandDef(def)) throw new Error(`no command ${name}`);
  return def;
}

let invocations = 0;

/** `start` 명령을 부른다. 시나리오 이름을 인자로 주면 그 이름이 시작 요청의 입력이 된다. 결과는 명령의 답이다 */
function startOf(t: TestHost, thread: ThreadId, scenario: string) {
  invocations += 1;
  return commandNamed(t, "start").handler(scenario, {
    threadId: thread,
    invocationId: `inv-${String(invocations)}`,
    signal: new AbortController().signal,
  });
}

/** 자식이 엔진에서 받은 `drive.step` 요청의 수 */
function stepsSent(port: FakeProcessPort): number {
  const text = port.children[0]?.received() ?? "";
  return text.split('"method":"drive.step"').length - 1;
}

/** 격리 주도 픽스처를 올린 호스트. 스레드는 열려 있고 주도는 아직 시작하지 않았다 */
async function isolatedHost(): Promise<{
  readonly t: TestHost;
  readonly port: FakeProcessPort;
  readonly clock: ManualClock;
  readonly thread: ThreadId;
}> {
  const t = await createTestHost({ loop: SCRIPTED });
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const outcome = await t.host.install({
    manifest: DRIVE_MANIFEST,
    entry: isolatedEntry(port, clock),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, port, clock, thread };
}

/** 상태 문서의 `seen` 글을 값으로 읽는다. 글이 JSON이 아니면 시험이 실패한다 */
function seenOf(doc: unknown): unknown {
  if (typeof doc !== "object" || doc === null || !("seen" in doc) || typeof doc.seen !== "string") {
    throw new Error("the state document has no seen text");
  }
  const parsed = parseJson(doc.seen);
  if (!parsed.ok) throw new Error("the seen text is not JSON");
  return parsed.value;
}

test("a turn and then a commit with done run in the isolated child, and the engine records what the engine runs", async () => {
  const { t, port, thread } = await isolatedHost();
  expect(await startOf(t, thread, "basic")).toBe("started");
  await t.settled();

  // 명령 순서: 턴 하나(요청 id turn-1), 그다음 상태 커밋과 끝. 단계 함수가 본 직전 결과가 상태에 적힌다
  expect(port.children[0]?.received()).toContain('"method":"drive.step"');
  expect(t.loop.turns.map((turn) => turn.requestId)).toEqual(["turn-1"]);
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states.map((state) => state.doc)).toEqual([{ count: 1, seen: SEEN_TURN }]);
  expect(acquiredOf(t, thread)).toHaveLength(1);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["done"]);
  expect(eventsOf(t, thread, "drive.command_settled")).toEqual([
    { scopeId: "dr", requestId: "turn-1", command: "turn", outcome: "completed", ref: TURN },
  ]);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);

  // 같은 픽스처를 엔진 안에서 돌리면 명령 순서, 상태 문서, 반납 사유, 명령 결과 사건이 같다
  const inEngine = await createTestHost({ loop: SCRIPTED });
  const outcome = await inEngine.host.install({
    manifest: DRIVE_MANIFEST,
    entry: driveExtension,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const engineThread = inEngine.newThread();
  await inEngine.host.openThread(engineThread);
  expect(await startOf(inEngine, engineThread, "basic")).toBe("started");
  await inEngine.settled();
  expect(inEngine.loop.turns.map((turn) => turn.requestId)).toEqual(["turn-1"]);
  expect(
    (await snapshotOf(inEngine.records, engineThread)).states.map((state) => state.doc),
  ).toEqual(snapshot.states.map((state) => state.doc));
  expect(releasedOf(inEngine, engineThread).map((released) => released.reason)).toEqual(["done"]);
  expect(eventsOf(inEngine, engineThread, "drive.command_settled")).toEqual(
    eventsOf(t, thread, "drive.command_settled"),
  );
});

test("the step receives the budget, the frame and the last result as real values, the same as in the engine", async () => {
  const { t, thread } = await isolatedHost();
  expect(await startOf(t, thread, "inspect")).toBe("started");
  await t.settled();

  // 첫 단계: 직전 결과 없음(null), 남은 예산은 기본 한도(4턴, 8번, 400000 토큰), 프레임 깊이 1, 맡긴 쪽 없음, 입력은 시작 요청의 값
  const expected = {
    budget: { turns: 4, spawns: 8, tokens: 400000 },
    frame: { frameDepth: 1, calledBy: null, input: { scenario: "inspect" } },
    last: null,
  };
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states.map((state) => state.doc)).toEqual([
    { count: 0, seen: expect.any(String) },
  ]);
  expect(seenOf(snapshot.states[0]?.doc)).toEqual(expected);

  const inEngine = await createTestHost({ loop: SCRIPTED });
  await inEngine.host.install({
    manifest: DRIVE_MANIFEST,
    entry: driveExtension,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  const engineThread = inEngine.newThread();
  await inEngine.host.openThread(engineThread);
  expect(await startOf(inEngine, engineThread, "inspect")).toBe("started");
  await inEngine.settled();
  const engineSnapshot = await snapshotOf(inEngine.records, engineThread);
  expect(seenOf(engineSnapshot.states[0]?.doc)).toEqual(expected);
});

test("a process that dies in the middle of a step releases the frame with error and leaves the drive usable: the next start resumes from the committed state", async () => {
  const { t, port, thread } = await isolatedHost();
  // 턴 하나를 하고 상태를 올린 뒤 쉰다. 사용자 메시지가 와서 다음 단계가 끝나지 않는다
  expect(await startOf(t, thread, "steps")).toBe("started");
  await t.settled();
  expect(t.host.leaseOf(thread)).not.toBeNull();
  expect(await t.host.claimUserInput(thread, { kind: "user", content: "wait" }, "msg-1")).toBe(
    true,
  );
  await until(() => stepsSent(port) >= 3, "the step that waits for the user");
  // 사용자 메시지는 다음 단계의 `last`로 실제 값이 간다
  expect(port.children[0]?.received()).toContain(
    '"last":{"kind":"user","message":{"kind":"user","content":"wait"},"requestId":"msg-1"}',
  );

  // 자식이 단계 중에 끝났다(프로세스 종료)
  port.children[0]?.crash();
  await t.settled();

  // 프레임은 오류 반납되지만 주도 등록은 오류로 표시되지 않는다. 감독이 다음 호출에서 다시 띄울 수 있다
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["error"]);
  expect(t.diagnostics.map((diagnostic) => diagnostic.code)).toContain("process_exit");
  expect(t.host.registrations()[0]?.drive).toBe("registered");

  // 새 시작 요청은 새 프로세스가 새 프레임을 맡아 커밋된 상태(count 1)에서 이어 간다. 턴은 다시 돌지 않는다
  expect(await startOf(t, thread, "resume")).toBe("started");
  await t.settled();
  expect(port.children).toHaveLength(2);
  expect(t.loop.turns.map((turn) => turn.requestId)).toEqual(["turn-1"]);
  expect((await snapshotOf(t.records, thread)).states.map((state) => state.doc)).toEqual([
    { count: 1, seen: SEEN_TURN },
  ]);
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["error", "done"]);
});

test("a step that does not end is stopped at its time limit: the process is killed, the frame goes down with process_killed, and the drive is not marked failed", async () => {
  const { t, port, clock, thread } = await isolatedHost();
  expect(await startOf(t, thread, "hang")).toBe("started");
  await until(() => stepsSent(port) === 1, "the step that never ends");

  // 시간 한도를 넘긴다. 감독이 프로세스를 멈추고 프레임을 내린다
  clock.advance(DEADLINE_MS);
  await t.settled();

  expect(port.children[0]?.signals).toContain("SIGTERM");
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["error"]);
  expect(t.diagnostics.map((diagnostic) => diagnostic.code)).toContain("process_killed");
  expect(t.host.registrations()[0]?.drive).toBe("registered");
  expect(t.loop.turns).toEqual([]);
});

test("a command that does not match its schema fails the step: the frame goes down, the drive is marked error, the child stays alive, and a new start is refused", async () => {
  const { t, port, thread } = await isolatedHost();
  // 질문 카드가 질문을 하나도 갖지 않는다. 타입은 맞고 스키마는 맞지 않는다
  expect(await startOf(t, thread, "shape")).toBe("started");
  await t.settled();

  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["error"]);
  expect(t.diagnostics.map((diagnostic) => diagnostic.code)).toContain("handler_failed");
  expect(t.host.registrations()[0]?.drive).toBe("error");
  expect(port.children).toHaveLength(1);
  expect(port.children[0]?.isAlive()).toBe(true);
  expect(t.loop.turns).toEqual([]);

  // 오류로 표시된 주도 등록은 새 시작을 받지 않는다(엔진 안과 같은 값)
  expect(await startOf(t, thread, "basic")).toBe("refused drive_error");
  await t.settled();
  expect(stepsSent(port)).toBe(1);
});

test("a host restart while the isolated step waits after a recorded turn restores the lease, replays that turn and records nothing twice", async () => {
  const first = await isolatedHost();
  expect(await startOf(first.t, first.thread, "replay")).toBe("started");
  await until(() => stepsSent(first.port) === 2, "the step after the turn");
  expect(first.t.loop.turns.map((turn) => turn.requestId)).toEqual(["turn-1"]);
  const settledBefore = eventsOf(first.t, first.thread, "drive.command_settled");
  expect(settledBefore).toHaveLength(1);

  // 호스트를 내리고 같은 기록으로 새 호스트를 연다. 열린 임대는 같은 계통으로 되살아나 단계 함수를 다시 부른다
  await first.t.host.dispose();
  const second = await first.t.restart();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const outcome = await second.host.install({
    manifest: DRIVE_MANIFEST,
    entry: isolatedEntry(port, clock),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  await second.host.openThread(first.thread);
  await until(() => stepsSent(port) === 2, "the restored step after the replayed turn");

  // 턴은 기록된 결과로 돌아오고 다시 돌지 않는다. 명령 결과 사건도 하나만 남는다
  expect(second.loop.turns.map((turn) => turn.requestId)).toEqual(["turn-1"]);
  expect(eventsOf(second, first.thread, "drive.command_settled")).toEqual(settledBefore);
  expect(acquiredOf(second, first.thread)).toHaveLength(1);
});

// 프레임 상한(16 MiB) 시험. 받는 쪽이 격리 플러그인이면 한 줄 상한(16 MiB에서 뼈대 몫 64 KiB를 뺀 값)을 넘는 입력은 기록하기 전에
// 거절한다(X.loading-trust §4.9.3). 받아 기록한 뒤 단계가 `frame_too_large`로 실패해 등록이 `driveError`가 되는 길은 닫혔다.
// 엔진 안의 등록은 같은 입력을 512 MiB까지 받는다(isolated가 아닌 시험: `lease.test.ts`).
// 이 시험은 조각 칸이 없는 엔진(`transferMaxBytes` 없음)이라 옛 상한이 남는다. 협상된 상한(조각 전송이 켜진 격리 등록)은
// `transfer-drive.test.ts`가 값으로 본다(AGE-59: 협상 상한 − 64 KiB, 옛 자식과 칸 없는 엔진은 옛 상한).

/** 상한 바로 안쪽(받아진다)과 바로 바깥(거절된다) 글 길이. JSON 글자 따옴표 두 개가 더해진다 */
const ISOLATED_LIMIT = PLUGIN_HOST_MAX_FRAME_BYTES - 64 * 1024;

test("a start input over the isolated limit is refused before anything is recorded, and the drive stays usable", async () => {
  const { t, port, thread } = await isolatedHost();
  const over = "x".repeat(ISOLATED_LIMIT);
  const refused = t.host.startDrive(thread, "dr", { input: over });
  expect(refused).toEqual({ ok: false, error: { kind: "input_too_large" } });
  await t.settled();

  expect(stepsSent(port)).toBe(0);
  expect(eventsOf(t, thread, "lease.requested")).toEqual([]);
  expect(acquiredOf(t, thread)).toEqual([]);
  expect(t.diagnostics.filter((diagnostic) => diagnostic.code === "handler_failed")).toEqual([]);
  expect(t.host.registrations()[0]?.drive).not.toBe("error");

  // 상한 안의 입력(따옴표 두 개를 더해도 안)은 받아진다
  const within = "x".repeat(ISOLATED_LIMIT - 1024);
  expect(t.host.startDrive(thread, "dr", { input: within }).ok).toBe(true);
});

test("a user message over the isolated limit is not claimed or recorded: the core loop takes it and the frame is untouched", async () => {
  const { t, port, thread } = await isolatedHost();
  expect(await startOf(t, thread, "steps")).toBe("started");
  await t.settled();
  const sentBefore = stepsSent(port);

  const huge: PostItem = { kind: "user", content: "x".repeat(ISOLATED_LIMIT) };
  expect(await t.host.claimUserInput(thread, huge, "msg-big")).toBe(false);
  await t.settled();

  expect(eventsOf(t, thread, "lease.user_input")).toEqual([]);
  expect(stepsSent(port)).toBe(sentBefore);
  expect(port.children[0]?.isAlive()).toBe(true);
  expect(releasedOf(t, thread)).toEqual([]);
  expect(t.host.registrations()[0]?.drive).not.toBe("error");

  // 상한 안의 메시지는 가로챈다
  const small: PostItem = { kind: "user", content: "hello" };
  expect(await t.host.claimUserInput(thread, small, "msg-small")).toBe(true);
});
