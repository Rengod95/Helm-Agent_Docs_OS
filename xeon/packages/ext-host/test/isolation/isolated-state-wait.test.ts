// 격리 호스트의 상태 이전(`migrateState`), 줄 세운 상태 갱신(`updateState`)과 사용자 대기(`awaitUser`) 시험.
// 실제 자식 런타임을 메모리 파이프로 엔진에 잇는다(동등성 시험과 같은 방식). 결과는 엔진 쪽 상태와 시계 멈춤 호출로 값을 비교한다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { CommandResourceDef } from "../../src/primitives/resources.ts";
import { createIsolatedEntry, type PluginHostSupervisor } from "../../src/index.ts";
import {
  DEFAULT_DISPATCH_POLICY,
  type DispatchPolicy,
  type HandlerEntryInfo,
  type HandlerGate,
  type HandlerRunOutcome,
} from "../../src/primitives/dispatch-types.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeManifest, makeUnit, snapshotOf } from "../primitives/fixtures/support.ts";
import { extension as stateExtension } from "./fixtures/state-plugin.ts";
import { extension as waitExtension } from "./fixtures/await-user-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

const V1 = Type.Object({ n: Type.Integer({ minimum: 0 }) });

/** 상태 픽스처의 매니페스트. 등록 이름은 `sv`다 */
const STATE_MANIFEST = { ...makeManifest({ name: "sv", hooks: [] }), entry: "./state-plugin.ts" };

/** 대기 픽스처의 매니페스트. 등록 이름은 `aw`고 `tool.call.before`를 듣는다 */
const WAIT_MANIFEST = {
  ...makeManifest({ name: "aw", hooks: ["tool.call.before"] }),
  entry: "./await-user-plugin.ts",
};

function isolatedEntry(
  manifest: typeof STATE_MANIFEST,
  port: FakeProcessPort,
  clock: ManualClock,
  onSupervisor?: (supervisor: PluginHostSupervisor) => void,
) {
  return createIsolatedEntry({
    ...(onSupervisor === undefined ? {} : { onSupervisor }),
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

/** 같은 픽스처를 엔진 안에서 직접 설치한다(격리와 같은 결과인지 비교하는 쪽) */
async function installInEngine(
  t: TestHost,
  manifest: typeof STATE_MANIFEST,
  entry: typeof stateExtension,
): Promise<void> {
  const outcome = await t.host.install({
    manifest,
    entry,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
}

/** 격리 확장을 설치하고 설치 상태가 `applied`인지 확인한다 */
async function installIsolated(
  t: TestHost,
  manifest: typeof STATE_MANIFEST,
  port: FakeProcessPort,
  clock: ManualClock,
  onSupervisor?: (supervisor: PluginHostSupervisor) => void,
): Promise<void> {
  const outcome = await t.host.install({
    manifest,
    entry: isolatedEntry(manifest, port, clock, onSupervisor),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied"]);
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

function ctxOf(thread: ThreadId, invocationId: string) {
  return { threadId: thread, invocationId, signal: new AbortController().signal };
}

/** 자식이 엔진에 보낸 `engine.call` 중 `method`인 것의 수. 자식이 엔진을 부른 횟수다 */
function engineCallsOf(port: FakeProcessPort, method: string): number {
  const text = port.children[0]?.emitted() ?? "";
  return text.split(`"method":"${method}"`).length - 1;
}

/** 상태 픽스처를 격리로 올린 호스트. 스레드는 열려 있다 */
async function stateHost(): Promise<{
  readonly t: TestHost;
  readonly port: FakeProcessPort;
  readonly thread: ThreadId;
}> {
  const t = await createTestHost();
  const port = createFakeProcessPort();
  await installIsolated(t, STATE_MANIFEST, port, createManualClock());
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, port, thread };
}

test("a stored version 1 document is migrated by the isolated child and committed as version 2", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.openThread(thread);
  await first.host.install(
    makeUnit(
      {
        name: "sv",
        hooks: ["boundary.settle.after"],
        def: { state: { schema: V1, initial: { n: 0 }, version: 1 } },
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          await g.commit({ n: 4 });
        });
      },
    ),
  );
  await first.host.dispatch(
    "boundary.settle.after",
    { turnId: first.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "seed" },
  );

  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  const port = createFakeProcessPort();
  await installIsolated(second, STATE_MANIFEST, port, createManualClock());
  await second.host.openThread(thread);
  await second.settled();

  expect(port.children[0]?.received()).toContain('"method":"state.migrate"');
  const snapshot = await snapshotOf(second.records, thread);
  expect(snapshot.states).toMatchObject([
    { version: 2, rev: 2, doc: { count: 4, label: "from 1" } },
  ]);
});

test("the state.migrate request carries a time limit equal to the init time limit", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.openThread(thread);
  await first.host.install(
    makeUnit(
      {
        name: "sv",
        hooks: ["boundary.settle.after"],
        def: { state: { schema: V1, initial: { n: 0 }, version: 1 } },
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          await g.commit({ n: 4 });
        });
      },
    ),
  );
  await first.host.dispatch(
    "boundary.settle.after",
    { turnId: first.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "seed" },
  );

  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  const limits = new Map<string, number | undefined>();
  await installIsolated(
    second,
    STATE_MANIFEST,
    createFakeProcessPort(),
    createManualClock(),
    (supervisor) => {
      const call = supervisor.call.bind(supervisor);
      supervisor.call = (method, params, options) => {
        limits.set(method, options?.deadlineMs);
        return call(method, params, options);
      };
    },
  );
  await second.host.openThread(thread);
  await second.settled();

  // 초기화 한도(`initTimeoutMs: 1000`)와 같은 값이다
  expect(limits.get("state.migrate")).toBe(1000);
});

test("updateState twice at once applies both changes in order and the state is their sum", async () => {
  const { t, port, thread } = await stateHost();
  const twice = commandNamed(t, "twice");
  const isolated = await twice.handler("", ctxOf(thread, "inv-1"));
  expect(isolated).toBe("count 1 count 2");
  expect(engineCallsOf(port, "updateState")).toBe(2);
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ version: 2, doc: { count: 2, label: "" } }]);

  // 같은 픽스처를 엔진 안에서 돌리면 같은 답이다
  const inEngine = await createTestHost();
  await installInEngine(inEngine, STATE_MANIFEST, stateExtension);
  const engineThread = inEngine.newThread();
  await inEngine.host.openThread(engineThread);
  expect(await commandNamed(inEngine, "twice").handler("", ctxOf(engineThread, "inv-1"))).toBe(
    isolated,
  );
});

test("an update that finds the engine's state changed by another request conflicts once and retries from the current state", async () => {
  const { t, port, thread } = await stateHost();
  const hold = commandNamed(t, "hold");
  const bump = commandNamed(t, "bump");
  const release = commandNamed(t, "release");

  // `hold`은 요청을 시작해 스냅샷(count 0)을 쥔 채 기다린다
  const held = hold.handler("", ctxOf(thread, "inv-hold"));
  await until(() => port.children[0]?.received().includes('"hold"') === true, "the hold request");
  // 다른 요청이 같은 상태를 1로 올린다. 엔진의 현재 문서는 count 1이 된다
  expect(await bump.handler("", ctxOf(thread, "inv-bump"))).toBe("count 1");
  // `hold`가 깨어나 스냅샷 0으로 낸 갱신은 충돌하고, 엔진의 현재 문서 1로 한 번 더 해서 2가 된다
  expect(await release.handler("", ctxOf(thread, "inv-release"))).toBe("released");
  expect(await held).toBe("count 2");
  expect(engineCallsOf(port, "updateState")).toBe(3);
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ version: 2, doc: { count: 2 } }]);
});

/** 대기가 시계를 멈추고 돌리는 순서를 적는 정책. 핸들러마다 이 가짜 gate를 쓴다 */
function gatedPolicy(calls: string[]): DispatchPolicy {
  const gate: HandlerGate = {
    pause: () => {
      calls.push("pause");
    },
    resume: () => {
      calls.push("resume");
    },
  };
  async function run<T>(
    _entry: HandlerEntryInfo,
    work: (signal: AbortSignal, gate: HandlerGate) => T | Promise<T>,
  ): Promise<HandlerRunOutcome<T>> {
    try {
      const value = await work(new AbortController().signal, gate);
      return { kind: "settled", value, activeMs: 0 };
    } catch (error: unknown) {
      return { kind: "threw", error, activeMs: 0 };
    }
  }
  return { ...DEFAULT_DISPATCH_POLICY, run };
}

function reasonsOf(failures: readonly { readonly reason: string }[]): readonly string[] {
  return failures.map((failure) => failure.reason);
}

function toolCall(toolName: string, toolCallId: string) {
  return { toolCallId, toolName, input: {} };
}

test("awaitUser pauses the handler's budget clock while the user is awaited and resumes it after", async () => {
  const calls: string[] = [];
  const t = await createTestHost({ policy: gatedPolicy(calls) });
  const port = createFakeProcessPort();
  await installIsolated(t, WAIT_MANIFEST, port, createManualClock());
  const thread = t.newThread();
  await t.host.openThread(thread);

  const decided = await t.host.dispatch("tool.call.before", toolCall("answer", "call-a"), {
    threadId: thread,
    dispatchKey: "k-answer",
  });
  expect(reasonsOf(decided.failures)).toEqual([]);
  expect(calls).toEqual(["pause", "resume"]);

  // 같은 픽스처를 엔진 안에서 돌리면 같은 호출 순서와 같은 판정이다
  const inEngineCalls: string[] = [];
  const inEngine = await createTestHost({ policy: gatedPolicy(inEngineCalls) });
  await installInEngine(inEngine, WAIT_MANIFEST, waitExtension);
  const engineThread = inEngine.newThread();
  await inEngine.host.openThread(engineThread);
  const inEngineDecided = await inEngine.host.dispatch(
    "tool.call.before",
    toolCall("answer", "call-a"),
    { threadId: engineThread, dispatchKey: "k-answer" },
  );
  expect(inEngineCalls).toEqual(calls);
  expect(reasonsOf(inEngineDecided.failures)).toEqual([]);
});

test("a request that ends while the user is still awaited resumes the clock it paused", async () => {
  const calls: string[] = [];
  const t = await createTestHost({ policy: gatedPolicy(calls) });
  const port = createFakeProcessPort();
  await installIsolated(t, WAIT_MANIFEST, port, createManualClock());
  const thread = t.newThread();
  await t.host.openThread(thread);

  const hanging = t.host.dispatch("tool.call.before", toolCall("hang", "call-h"), {
    threadId: thread,
    dispatchKey: "k-hang",
  });
  // 엔진이 `begin`을 처리해 시계를 멈춘 것을 본 뒤에 자식을 죽인다. 끝 신호는 오지 않는다
  await until(() => calls.length === 1, "the pause of the hanging wait");
  port.children[0]?.crash();
  const died = await hanging;
  expect(reasonsOf(died.failures)).toEqual(["process_exit"]);
  expect(calls).toEqual(["pause", "resume"]);
});
