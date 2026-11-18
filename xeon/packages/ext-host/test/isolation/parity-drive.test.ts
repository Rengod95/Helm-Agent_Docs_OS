// 주도 동등성 시험(drive-isolation.md 1.1, 2.1, 3.3). 같은 주도 시나리오를 엔진 안(`createTestHost` 위에 직접 등록)과
// 격리 자식(메모리 파이프)에서 돌려, 명령 순서와 결과, 기록(명령 결과, 임대 부여와 반납), 상태 문서와 판, 맡기기 A→B→A,
// 거부, 프로세스 죽음을 값으로 비교한다. 비교 대상이 비어 있지 않은지 먼저 단언한다.
// 이 시험은 제품을 고치지 않는다. 다르면 어느 필드가 왜 다른지 보고한다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { ok } from "@fresnel/contracts";
import type { PluginModelValue, ToolResultView } from "@fresnel/contracts/capabilities";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type {
  DriveFrameView,
  ExtensionEntry,
  ExtensionManifest,
} from "@fresnel/contracts/extensions";
import type { LeaseAcquiredPayload, LeaseReleasedPayload } from "@fresnel/contracts/records";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import {
  acquiredOf,
  eventsOf,
  fakeApprovals,
  onlyApproval,
  provideApprovals,
  releasedOf,
} from "../primitives/fixtures/fake-approvals.ts";
import {
  fakeModels,
  fakeTools,
  provideModelsPort,
  provideToolsPort,
} from "../primitives/fixtures/fake-plugin-calls.ts";
import { makeManifest, snapshotOf } from "../primitives/fixtures/support.ts";
import { MAX_DRIVE_TOOL_COMMANDS } from "../../src/primitives/lease.ts";
import {
  setFailure,
  setObserver,
  type FailureMode,
  type StepView,
} from "./fixtures/drive-probe.ts";
import { extension as callsExtension } from "./fixtures/drive-calls-plugin.ts";
import { extension as parityExtension } from "./fixtures/drive-parity-plugin.ts";
import { extension as handoffA } from "./fixtures/handoff-a-plugin.ts";
import { extension as handoffB } from "./fixtures/handoff-b-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

/** 설치 방식. 엔진 안은 엔트리 함수를 그대로 올리고, 격리는 자식을 메모리 파이프로 잇는다 */
type Placement = "engine" | "isolated";

/** 한 번 돌린 것의 배치. A가 맡기고 B가 받는다 */
interface Config {
  readonly a: Placement;
  readonly b: Placement;
}

/** 기준(둘 다 엔진 안) */
const BASELINE: Config = { a: "engine", b: "engine" };

/** 기준, 한쪽만 격리 두 가지, 둘 다 격리. 첫 항목이 기준이다 */
const CONFIGS: readonly Config[] = [
  BASELINE,
  { a: "engine", b: "isolated" },
  { a: "isolated", b: "engine" },
  { a: "isolated", b: "isolated" },
];

/** 엔트리 파일은 픽스처 루트 아래의 파일이다. 등록 이름은 매니페스트 이름과 같다 */
function manifestOf(name: string, file: string): ExtensionManifest {
  return { ...makeManifest({ name, hooks: [], group: {}, drives: true }), entry: file };
}

const PARITY = manifestOf("dp", "./drive-parity-plugin.ts");
const CALLS = manifestOf("dc", "./drive-calls-plugin.ts");
const HA = manifestOf("ha", "./handoff-a-plugin.ts");
const HB = manifestOf("hb", "./handoff-b-plugin.ts");

/** 격리 항목. 자식은 `port`로 띄우고 시계는 시험이 쥔다. 단계 시간 한도는 움직이지 않으므로 시계는 멈춰 있다 */
function isolatedEntry(
  manifest: ExtensionManifest,
  port: FakeProcessPort,
  clock: ManualClock,
): ExtensionEntry {
  return createIsolatedEntry({
    manifest,
    root: FIXTURE_ROOT,
    versionId: `${manifest.name}-1`,
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger([]),
    initTimeoutMs: 1000,
  });
}

/** 플러그인 하나를 올린다. 격리면 자식 포트를 돌려주고, 엔진 안이면 `null`이다 */
async function installPlugin(
  t: TestHost,
  manifest: ExtensionManifest,
  placement: Placement,
  extension: ExtensionEntry,
  loadIndex: number,
): Promise<FakeProcessPort | null> {
  const port = placement === "isolated" ? createFakeProcessPort() : null;
  const entry = port === null ? extension : isolatedEntry(manifest, port, createManualClock());
  const outcome = await t.host.install({
    manifest,
    entry,
    loadIndex,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
  return port;
}

/** 자식이 엔진에서 받은 `drive.step` 요청의 수. 엔진 안은 자식이 없어 0이다 */
function driveSteps(port: FakeProcessPort | null): number {
  const text = port?.children[0]?.received() ?? "";
  return text.split('"method":"drive.step"').length - 1;
}

/** 격리로 올린 플러그인은 자식이 하나 있고 `drive.step`을 받았다. 엔진 안은 자식이 없다 */
function expectPlacement(placement: Placement, port: FakeProcessPort | null): void {
  if (placement === "engine") {
    expect(port).toBeNull();
    return;
  }
  expect(port?.children).toHaveLength(1);
  expect(driveSteps(port)).toBeGreaterThan(0);
}

/** 단계 함수 한 번이 본 것: 입력의 값과 그 순간의 엔진 스택 읽기 */
interface TraceRow extends StepView {
  readonly frames: readonly DriveFrameView[];
}

/** 한 번의 돌림에서 값으로 모은 것. 두 방식의 값을 이 모양으로 비교한다 */
interface Recorded {
  readonly trace: readonly TraceRow[];
  /** `drive.command_settled` 사건의 payload(요청 id, 명령 종류, 결과 요약, 참조) */
  readonly commands: readonly unknown[];
  readonly acquired: readonly LeaseAcquiredPayload[];
  readonly released: readonly LeaseReleasedPayload[];
  /** 저장된 상태 문서와 판. 사건의 id는 비교하지 않는다 */
  readonly states: readonly {
    readonly scopeId: string;
    readonly rev: number;
    readonly doc: JsonValue;
  }[];
}

/** 관찰자를 건다. 단계 함수가 불릴 때마다 엔진의 스택을 읽어 적는다. 엔진 안과 격리가 같은 자리를 쓴다 */
function observeInto(t: TestHost, thread: ThreadId, trace: TraceRow[]): void {
  setObserver((view) => {
    trace.push({ ...view, frames: t.host.driveFrames(thread) });
  });
}

async function collect(
  t: TestHost,
  thread: ThreadId,
  trace: readonly TraceRow[],
): Promise<Recorded> {
  const snapshot = await snapshotOf(t.records, thread);
  return {
    trace,
    commands: eventsOf(t, thread, "drive.command_settled"),
    acquired: acquiredOf(t, thread),
    released: releasedOf(t, thread),
    states: snapshot.states.map((state) => ({
      scopeId: state.scopeId,
      rev: state.rev,
      doc: state.doc,
    })),
  };
}

/** 질문 카드의 답. 시나리오의 ask 명령에 `answered`로 돌아온다 */
const ANSWER: JsonValue = { q1: { selected: ["yes"] } };

interface SingleRun {
  readonly recorded: Recorded;
  readonly port: FakeProcessPort | null;
}

/** 단일 플러그인 시나리오: turn → commit(+ask) → 답 → spawn → commit(+yield) → 사용자 메시지 → done */
async function runSingle(placement: Placement): Promise<SingleRun> {
  const t = await createTestHost();
  const approvals = fakeApprovals(t.timers.now);
  await provideApprovals(t, approvals);
  const port = await installPlugin(t, PARITY, placement, parityExtension, 0);
  const thread = t.newThread();
  await t.host.openThread(thread);
  const trace: TraceRow[] = [];
  observeInto(t, thread, trace);
  try {
    expect(t.host.startDrive(thread, "dp").ok).toBe(true);
    await t.settled();
    // ask가 승인을 기다린다. 사용자가 답한다
    const approval = onlyApproval(approvals);
    expect(
      await approvals.service.respond(approval.approvalId, { decision: "answer", answer: ANSWER }),
    ).toEqual({ applied: true });
    await t.settled();
    // 여기서 `yield`로 멈춘다. 사용자 메시지가 와야 다음 단계가 돈다
    expect(await t.host.claimUserInput(thread, { kind: "user", content: "again" }, "msg-1")).toBe(
      true,
    );
    // 사용자 메시지는 큐를 거쳐 다음 단계로 간다. 단계가 done을 내고 임대가 반납될 때까지 기다린다
    await until(() => t.host.leaseOf(thread) === null, "the drive to end after the user message");
    await t.settled();
  } finally {
    setObserver(null);
  }
  return { recorded: await collect(t, thread, trace), port };
}

test("one plugin's command sequence, records and committed state are the same in-engine and isolated", async () => {
  const expected = await runSingle("engine");
  const actual = await runSingle("isolated");

  // 비교 대상이 비어 있지 않고, 기준이 의도대로 돌았는지 먼저 본다
  expect(expected.recorded.trace.length).toBeGreaterThan(0);
  expect(expected.recorded.commands.length).toBeGreaterThan(0);
  expect(expected.recorded.acquired.length).toBeGreaterThan(0);
  expect(expected.recorded.released.length).toBeGreaterThan(0);
  expect(expected.recorded.states.length).toBeGreaterThan(0);
  // 명령 순서: turn, commit(+ask), 답, spawn, commit(+yield), 사용자 메시지, done. `yield` 뒤에는 엔진이 `last: null`로
  // 한 번 다시 부른다(호출 조건이 실행 중에 지나갔다, 2.4). 그 단계는 상태 `n`으로 `yield`를 낸다
  expect(expected.recorded.trace.map((row) => row.last?.kind ?? null)).toEqual([
    null,
    "ok",
    "ask",
    "ok",
    null,
    "user",
  ]);
  expect(expected.recorded.trace.map((row) => row.state.n)).toEqual([0, 0, 1, 1, 2, 2]);
  expect(
    expected.recorded.trace[0]?.frames.map((frame) => [frame.depth, frame.plugin, frame.state]),
  ).toEqual([
    [0, null, "driving"],
    [1, "dp", "driving"],
  ]);
  expect(expected.recorded.trace.at(-1)?.last).toEqual({
    kind: "user",
    message: { kind: "user", content: "again" },
    requestId: "msg-1",
  });
  expect(expected.recorded.commands).toHaveLength(3);
  expect(expected.recorded.released.map((released) => released.reason)).toEqual(["done"]);

  expectPlacement("isolated", actual.port);
  expect(actual.recorded.trace).toEqual(expected.recorded.trace);
  expect(actual.recorded.commands).toEqual(expected.recorded.commands);
  expect(actual.recorded.acquired).toEqual(expected.recorded.acquired);
  expect(actual.recorded.released).toEqual(expected.recorded.released);
  expect(actual.recorded.states).toEqual(expected.recorded.states);
});

interface ChainRun {
  readonly recorded: Recorded;
  readonly portA: FakeProcessPort | null;
  readonly portB: FakeProcessPort | null;
}

/**
 * 배치마다 한 번씩 돌린다. 관찰자가 전역이라 돌림은 차례로 한다(병렬이면 값이 섞인다). 반복문 대신 재귀를 쓴다
 */
async function runEach(
  configs: readonly Config[],
  mode: string,
  options: { readonly driveMaxDepth?: number } = {},
): Promise<readonly { readonly config: Config; readonly run: ChainRun }[]> {
  const [first, ...rest] = configs;
  if (first === undefined) return [];
  const run = await runChain(first, mode, options);
  return [{ config: first, run }, ...(await runEach(rest, mode, options))];
}

/** A를 시작한다. 입력의 `mode`는 A가 B에게 그대로 넘긴다(drive-probe와 handoff-steps.ts의 갈래를 고른다) */
async function runChain(
  config: Config,
  mode: string,
  options: { readonly driveMaxDepth?: number } = {},
): Promise<ChainRun> {
  const t = await createTestHost(
    options.driveMaxDepth === undefined
      ? {}
      : { settings: { driveMaxDepth: options.driveMaxDepth } },
  );
  const portA = await installPlugin(t, HA, config.a, handoffA, 0);
  const portB = await installPlugin(t, HB, config.b, handoffB, 1);
  const thread = t.newThread();
  await t.host.openThread(thread);
  const trace: TraceRow[] = [];
  observeInto(t, thread, trace);
  try {
    expect(t.host.startDrive(thread, "ha", { input: { mode } }).ok).toBe(true);
    await t.settled();
  } finally {
    setObserver(null);
  }
  return { recorded: await collect(t, thread, trace), portA, portB };
}

/** 프레임 한 줄 모양: 깊이, 플러그인, 상태 */
function framesOf(row: TraceRow): readonly (readonly [number, string | null, string])[] {
  return row.frames.map((frame) => [frame.depth, frame.plugin, frame.state]);
}

test("A hands off to B, B's result comes back to A as done, and the values are the same in all four placements", async () => {
  const expected = await runChain(BASELINE, "turn");
  const base = expected.recorded;

  // 기준이 의도대로 돌았는지 먼저 본다: A, B, B(턴 결과), A 순서로 불리고 스택이 위로 쌓였다가 내려간다
  expect(base.trace.length).toBeGreaterThan(0);
  expect(base.commands.length).toBeGreaterThan(0);
  expect(base.acquired.map((grant) => [grant.scopeId, grant.depth ?? null])).toEqual([
    ["ha", 0],
    ["hb", 1],
  ]);
  expect(base.released.map((released) => [released.scopeId, released.reason])).toEqual([
    ["hb", "done"],
    ["ha", "done"],
  ]);
  expect(base.trace.map((row) => row.plugin)).toEqual(["ha", "hb", "hb", "ha"]);
  expect(base.trace.map(framesOf)).toEqual([
    [
      [0, null, "driving"],
      [1, "ha", "driving"],
    ],
    [
      [0, null, "driving"],
      [1, "ha", "waiting"],
      [2, "hb", "driving"],
    ],
    [
      [0, null, "driving"],
      [1, "ha", "waiting"],
      [2, "hb", "driving"],
    ],
    [
      [0, null, "driving"],
      [1, "ha", "driving"],
    ],
  ]);
  expect(base.trace[1]?.frame).toEqual({ frameDepth: 2, calledBy: "ha", input: { mode: "turn" } });
  expect(base.trace.at(-1)?.last).toMatchObject({
    kind: "handoff",
    status: "done",
    result: { turn: expect.any(String) },
  });
  expect(base.states.map((state) => state.scopeId)).toEqual(["ha"]);

  const actuals = await runEach(CONFIGS.slice(1), "turn");
  for (const { config, run: actual } of actuals) {
    expectPlacement(config.a, actual.portA);
    expectPlacement(config.b, actual.portB);
    expect(actual.recorded.trace).toEqual(base.trace);
    expect(actual.recorded.commands).toEqual(base.commands);
    expect(actual.recorded.acquired).toEqual(base.acquired);
    expect(actual.recorded.released).toEqual(base.released);
    expect(actual.recorded.states).toEqual(base.states);
  }
});

test("a handoff past the depth limit is refused as depth_limit, and A resumes with the refusal, in all four placements", async () => {
  const expected = await runChain(BASELINE, "turn", { driveMaxDepth: 1 });
  const base = expected.recorded;

  // 상한 1에서는 A의 맡기기가 거부된다. B는 실행되지 않고 A는 거부 결과를 받아 끝낸다
  expect(base.trace.length).toBeGreaterThan(0);
  expect(base.trace.map((row) => row.plugin)).toEqual(["ha", "ha"]);
  expect(base.trace.at(-1)?.last).toEqual({ kind: "refused", code: "depth_limit" });
  expect(base.acquired.map((grant) => grant.scopeId)).toEqual(["ha"]);
  expect(base.released.map((released) => [released.scopeId, released.reason])).toEqual([
    ["ha", "done"],
  ]);
  expect(base.states).toEqual([
    {
      scopeId: "ha",
      rev: 1,
      doc: { n: 1, seen: JSON.stringify({ kind: "refused", code: "depth_limit" }) },
    },
  ]);

  const actuals = await runEach(CONFIGS.slice(1), "turn", { driveMaxDepth: 1 });
  for (const { config, run: actual } of actuals) {
    expectPlacement(config.a, actual.portA);
    // B는 거부되어 한 번도 불리지 않았다
    expect(driveSteps(actual.portB)).toBe(0);
    expect(actual.recorded.trace).toEqual(base.trace);
    expect(actual.recorded.commands).toEqual(base.commands);
    expect(actual.recorded.acquired).toEqual(base.acquired);
    expect(actual.recorded.released).toEqual(base.released);
    expect(actual.recorded.states).toEqual(base.states);
  }
});

test("B's handoff to itself is refused as self_handoff, and B resumes with the refusal, in all four placements", async () => {
  const expected = await runChain(BASELINE, "self");
  const base = expected.recorded;

  // B가 자기 자신에게 맡기면 거부 결과를 같은 프레임에서 받고, 그 뒤 done을 내면 A가 그 결과를 받는다
  expect(base.trace.length).toBeGreaterThan(0);
  expect(base.trace.map((row) => row.plugin)).toEqual(["ha", "hb", "hb", "ha"]);
  expect(base.trace[2]?.last).toEqual({ kind: "refused", code: "self_handoff" });
  expect(base.trace[2]?.frames.map((frame) => frame.plugin)).toEqual([null, "ha", "hb"]);
  expect(base.trace.at(-1)?.last).toMatchObject({
    kind: "handoff",
    status: "done",
    result: { refused: "self_handoff" },
  });
  expect(base.released.map((released) => [released.scopeId, released.reason])).toEqual([
    ["hb", "done"],
    ["ha", "done"],
  ]);

  const actuals = await runEach(CONFIGS.slice(1), "self");
  for (const { config, run: actual } of actuals) {
    expectPlacement(config.a, actual.portA);
    expectPlacement(config.b, actual.portB);
    expect(actual.recorded.trace).toEqual(base.trace);
    expect(actual.recorded.commands).toEqual(base.commands);
    expect(actual.recorded.acquired).toEqual(base.acquired);
    expect(actual.recorded.released).toEqual(base.released);
    expect(actual.recorded.states).toEqual(base.states);
  }
});

interface DyingRun {
  readonly recorded: Recorded;
  /** 맡은 쪽 등록의 주도 상태(`registrations()`의 `drive`) */
  readonly registration: string | undefined;
  /** 오류 진단의 코드 */
  readonly errorCodes: readonly string[];
}

/**
 * A가 B에게 맡기고 B의 첫 단계가 일어난다. 입력은 항상 같은 `fail`이고 실패 방식만 고른다. `hang`은 격리 B의 자식을
 * 시험이 끝낸다(단계 중 프로세스 죽음), `throw`는 B의 단계가 던진다. `hang`은 B가 격리인 배치에서만 쓴다.
 */
async function runDying(config: Config, failure: FailureMode): Promise<DyingRun> {
  const t = await createTestHost();
  await installPlugin(t, HA, config.a, handoffA, 0);
  const portB = await installPlugin(t, HB, config.b, handoffB, 1);
  const thread = t.newThread();
  await t.host.openThread(thread);
  const trace: TraceRow[] = [];
  observeInto(t, thread, trace);
  setFailure(failure);
  try {
    expect(t.host.startDrive(thread, "ha", { input: { mode: "fail" } }).ok).toBe(true);
    if (failure === "hang") {
      expect(portB).not.toBeNull();
      // B의 단계가 끝나지 않는 상태에서 자식을 끝낸다. 엔진은 그 단계를 프로세스가 끝났다고 받는다
      await until(() => driveSteps(portB) === 1, "the step of hb that never ends");
      portB?.children[0]?.crash();
    }
    await t.settled();
  } finally {
    setObserver(null);
    setFailure("throw");
  }
  return {
    recorded: await collect(t, thread, trace),
    registration: t.host.registrations().find((info) => info.id === "hb")?.drive,
    errorCodes: t.diagnostics
      .filter((diagnostic) => diagnostic.level === "error")
      .map((diagnostic) => diagnostic.code),
  };
}

test("B's process dying mid-step gives A an aborted handoff, the same as B's step throwing in-engine; the registration difference is asserted apart", async () => {
  const baseline = await runDying({ a: "engine", b: "engine" }, "throw");
  const deathFromEngine = await runDying({ a: "engine", b: "isolated" }, "hang");
  const deathFromIsolated = await runDying({ a: "isolated", b: "isolated" }, "hang");
  const throwIsolated = await runDying({ a: "isolated", b: "isolated" }, "throw");

  // 기준: B가 던지면 B 프레임이 error로 내려가고 A는 끊김을 받는다
  const base = baseline.recorded;
  expect(base.trace.length).toBeGreaterThan(0);
  expect(base.trace.map((row) => row.plugin)).toEqual(["ha", "hb", "ha"]);
  expect(base.trace.at(-1)?.last).toEqual({ kind: "handoff", status: "aborted", result: null });
  expect(base.acquired.length).toBeGreaterThan(0);
  expect(base.released.map((released) => [released.scopeId, released.reason])).toEqual([
    ["hb", "error"],
    ["ha", "done"],
  ]);
  expect(base.states.map((state) => state.doc)).toEqual([
    { n: 1, seen: JSON.stringify({ kind: "handoff", status: "aborted", result: null }) },
  ]);

  // 죽음과 던짐은 같은 값을 낸다: 추적, 기록, 상태
  for (const run of [deathFromEngine, deathFromIsolated, throwIsolated]) {
    expect(run.recorded.trace).toEqual(base.trace);
    expect(run.recorded.commands).toEqual(base.commands);
    expect(run.recorded.acquired).toEqual(base.acquired);
    expect(run.recorded.released).toEqual(base.released);
    expect(run.recorded.states).toEqual(base.states);
  }

  // 알려진 차이(문서화): 프로세스 죽음은 주도 등록을 error로 표시하지 않고 진단 코드는 process_exit다.
  // 단계 안의 던짐은 등록을 error로 표시하고 진단 코드는 handler_failed다. 이 차이는 drive-isolation.md 3.3의 정정이다.
  expect(baseline.registration).toBe("error");
  expect(baseline.errorCodes).toContain("handler_failed");
  expect(throwIsolated.registration).toBe("error");
  expect(throwIsolated.errorCodes).toContain("handler_failed");
  expect(deathFromEngine.registration).toBe("registered");
  expect(deathFromIsolated.registration).toBe("registered");
  expect(deathFromEngine.errorCodes).toContain("process_exit");
  expect(deathFromIsolated.errorCodes).toContain("process_exit");
});

const TOOL_VIEW: ToolResultView = {
  content: "file text",
  structuredContent: { lines: 3 },
  isError: false,
  details: null,
};

interface CallsRun {
  readonly recorded: Recorded;
  readonly port: FakeProcessPort | null;
  /** 엔진이 도구 포트에 건 요청 가운데 값으로 비교할 필드 */
  readonly toolRequests: readonly unknown[];
  /** 엔진이 모델 포트에 건 요청 가운데 값으로 비교할 필드 */
  readonly modelRequests: readonly unknown[];
}

/** `model`·`tool` 명령을 내는 주도를 돌린다. 모델은 같은 요청 id의 두 번째 호출을 재생으로 답한다 */
async function runCalls(placement: Placement, mode: string): Promise<CallsRun> {
  const t = await createTestHost();
  const tools = fakeTools(() => ok(TOOL_VIEW));
  const seenModelRequests = new Set<string>();
  const models = fakeModels((request) => {
    const replayed = seenModelRequests.has(request.requestId);
    seenModelRequests.add(request.requestId);
    return ok({
      text: "yes",
      usage: { input: 30, output: 10, total: 40 },
      stopReason: "stop",
      replayed,
    });
  });
  await provideToolsPort(t, tools.port);
  await provideModelsPort(t, models.port);
  const port = await installPlugin(t, CALLS, placement, callsExtension, 0);
  const thread = t.newThread();
  await t.host.openThread(thread);
  const trace: TraceRow[] = [];
  observeInto(t, thread, trace);
  try {
    expect(t.host.startDrive(thread, "dc", { input: { mode } }).ok).toBe(true);
    await t.settled();
  } finally {
    setObserver(null);
  }
  return {
    recorded: await collect(t, thread, trace),
    port,
    toolRequests: tools.requests.map((request) => ({
      plugin: request.plugin,
      via: request.via,
      target: request.target,
      input: request.input,
      requestId: request.requestId,
    })),
    modelRequests: models.requests.map((request) => ({
      plugin: request.plugin,
      requestId: request.requestId,
      messages: request.messages,
      label: request.label,
    })),
  };
}

test("model and tool commands run the same in-engine and isolated: order, settled records, result values, token charge and request id replay", async () => {
  const expected = await runCalls("engine", "calls");
  const actual = await runCalls("isolated", "calls");

  // 기준: model(m1) → tool(t1) → model(m1 재생) → done
  expect(expected.recorded.trace.map((row) => row.last?.kind ?? null)).toEqual([
    null,
    "ok",
    "ok",
    "ok",
  ]);
  expect(
    expected.recorded.trace.map((row) => (row.last?.kind === "ok" ? row.last.of : null)),
  ).toEqual([null, "model", "tool", "model"]);
  const modelResult: PluginModelValue = {
    text: "yes",
    usage: { input: 30, output: 10, total: 40 },
    stopReason: "stop",
  };
  expect(expected.recorded.trace[1]?.last).toEqual({ kind: "ok", of: "model", value: modelResult });
  expect(expected.recorded.trace[2]?.last).toEqual({ kind: "ok", of: "tool", value: TOOL_VIEW });
  expect(expected.recorded.trace[3]?.last).toEqual({ kind: "ok", of: "model", value: modelResult });
  // 토큰 차감: 첫 모델 호출이 40을 쓰고, 같은 요청 id의 재생은 다시 차감하지 않는다
  expect(expected.recorded.trace.map((row) => row.budget.tokens)).toEqual([100, 60, 60, 60]);
  expect(expected.recorded.commands).toMatchObject([
    { scopeId: "dc", requestId: "m1", command: "model", outcome: "completed" },
    { scopeId: "dc", requestId: "t1", command: "tool", outcome: "completed" },
  ]);
  expect(expected.toolRequests).toEqual([
    {
      plugin: { name: "dc", scopeId: "dc" },
      via: "drive",
      target: { kind: "tool", name: "read" },
      input: { path: "a.txt" },
      requestId: "t1",
    },
  ]);
  expect(expected.modelRequests).toHaveLength(2);

  expectPlacement("isolated", actual.port);
  expect(actual.recorded.trace).toEqual(expected.recorded.trace);
  expect(actual.recorded.commands).toEqual(expected.recorded.commands);
  expect(actual.recorded.acquired).toEqual(expected.recorded.acquired);
  expect(actual.recorded.released).toEqual(expected.recorded.released);
  expect(actual.recorded.states).toEqual(expected.recorded.states);
  expect(actual.toolRequests).toEqual(expected.toolRequests);
  expect(actual.modelRequests).toEqual(expected.modelRequests);
});

test("a tool-only drive is ended by the tool command limit as budget, the same in-engine and isolated", async () => {
  const expected = await runCalls("engine", "forever");
  const actual = await runCalls("isolated", "forever");

  expect(expected.toolRequests).toHaveLength(MAX_DRIVE_TOOL_COMMANDS);
  expect(expected.recorded.released.map((released) => released.reason)).toEqual(["budget"]);
  expectPlacement("isolated", actual.port);
  expect(actual.toolRequests).toEqual(expected.toolRequests);
  expect(actual.recorded.trace).toEqual(expected.recorded.trace);
  expect(actual.recorded.commands).toEqual(expected.recorded.commands);
  expect(actual.recorded.released).toEqual(expected.recorded.released);
  expect(actual.recorded.states).toEqual(expected.recorded.states);
});
