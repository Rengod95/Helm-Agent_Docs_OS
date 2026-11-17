// 동등성 시험(M5b-1 part 2): 같은 플러그인 픽스처를 (a) 엔진 안에서, (b) 격리 자식(runPluginHost를 메모리 파이프로 돌린다)으로
// 설치하고, 같은 호출 순서가 같은 결과, 같은 상태, 같은 기록을 내는지 본다. 프로세스 종료 시험은 실패 이유와 다시 띄우기를 본다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { FIRST_DENY, ToolsPortKey, type ToolResourceDef } from "@fresnel/contracts/extensions";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import type { HandlerFailure } from "../../src/primitives/dispatch-types.ts";
import type { CommandResourceDef } from "../../src/primitives/resources.ts";
import { makeManifest, snapshotOf } from "../primitives/fixtures/support.ts";
import {
  EQUIVALENCE_HOOKS,
  EQUIVALENCE_RECORD_KIND,
  extension,
} from "./fixtures/equivalence-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  until,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

/** 두 경우가 같은 매니페스트를 쓴다. 엔트리 파일은 픽스처 루트의 `equivalence-plugin.ts`다 */
const MANIFEST = {
  ...makeManifest({
    name: "eq",
    hooks: [...EQUIVALENCE_HOOKS],
    recordKinds: [
      {
        kind: EQUIVALENCE_RECORD_KIND,
        version: 1,
        description: "a tool call seen by the equivalence fixture",
        payload: {},
      },
    ],
  }),
  entry: "./equivalence-plugin.ts",
};

function isolatedEntry(port: FakeProcessPort, clock: ManualClock) {
  return createIsolatedEntry({
    manifest: MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "eq-1",
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger([]),
    initTimeoutMs: 1000,
  });
}

function reasonsOf(failures: readonly HandlerFailure[]): readonly string[] {
  return failures.map((failure) => failure.reason);
}

function isCommandDef(value: unknown): value is CommandResourceDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "handler" in value &&
    typeof value.handler === "function"
  );
}

/** 테스트 호스트에 도구 포트를 붙인다. 등록된 도구 정의(ambient로 감싼 것)를 이름으로 찾을 수 있게 모아 둔다 */
async function hostWithTools(): Promise<{
  readonly t: TestHost;
  readonly tools: Map<string, ToolResourceDef>;
}> {
  const t = await createTestHost();
  const tools = new Map<string, ToolResourceDef>();
  await t.host.registerPlatform({
    name: "equivalence-tools-port",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  return { t, tools };
}

function commandNamed(t: TestHost, name: string): CommandResourceDef | undefined {
  const def = t.host.resources.list("command").find((record) => record.name === name)?.def;
  return isCommandDef(def) ? def : undefined;
}

function callOf(toolName: string, toolCallId: string) {
  return { toolCallId, toolName, input: { text: "hi" } };
}

/** 시나리오가 관찰한 값. 두 경우의 결과를 이 모양으로 비교한다 */
interface Observed {
  readonly steps: readonly unknown[];
  readonly state: unknown;
  readonly records: readonly { readonly kind: string; readonly payload: unknown }[];
}

/** 같은 호출 순서를 한 호스트에서 돌리고, 관찰한 값을 돌려준다. 두 경우 모두 이 함수를 쓴다 */
async function runScenario(
  t: TestHost,
  tools: ReadonlyMap<string, ToolResourceDef>,
): Promise<Observed> {
  const thread: ThreadId = t.newThread();
  await t.host.openThread(thread);
  const signal = new AbortController().signal;
  const steps: unknown[] = [];

  const passed = await t.host.dispatch("tool.call.before", callOf("eq-tool", "call-1"), {
    threadId: thread,
    dispatchKey: "k-pass",
  });
  steps.push({ fold: "first", decision: passed.decision, reasons: reasonsOf(passed.failures) });

  const blocked = await t.host.dispatch("tool.call.before", callOf("blocked", "call-2"), {
    threadId: thread,
    dispatchKey: "k-block",
  });
  steps.push({ fold: "first", decision: blocked.decision, reasons: reasonsOf(blocked.failures) });

  const thrown = await t.host.dispatch("tool.call.before", callOf("throws", "call-3"), {
    threadId: thread,
    dispatchKey: "k-throw",
  });
  steps.push({
    fold: "first",
    decision: thrown.decision,
    substituted: thrown.substituted,
    reasons: reasonsOf(thrown.failures),
  });

  const patched = await t.host.dispatch("tool.result", callOf("eq-tool", "call-1"), {
    threadId: thread,
    dispatchKey: "k-result",
    initial: { content: [], isError: false },
  });
  steps.push({ fold: "chain", value: patched.value, reasons: reasonsOf(patched.failures) });

  const tapped = await t.host.dispatch(
    "tool.execution.before",
    { toolCallId: "call-1", toolName: "eq-tool", args: { text: "hi" } },
    { threadId: thread, dispatchKey: "k-tap" },
  );
  steps.push({ fold: "tap", reasons: reasonsOf(tapped.failures) });

  const tool = tools.get("eq-tool");
  const toolReturn = await tool?.execute(
    { text: "from the tool" },
    { threadId: thread, signal, toolCallId: "call-4", caller: { kind: "model", agent: "main" } },
  );
  steps.push({ tool: toolReturn });

  const command = commandNamed(t, "eq-cmd");
  const commandReturn = await command?.handler("abc", {
    threadId: thread,
    invocationId: "inv-1",
    signal,
  });
  steps.push({ command: commandReturn });

  const snapshot = await snapshotOf(t.records, thread);
  const state = snapshot.states.find((entry) => entry.scopeId === "eq")?.doc;
  const records = t.records
    .events(thread)
    .map((event) => ({ kind: event.kind, payload: event.payload }));
  return { steps, state, records };
}

test("the same fixture gives the same results, committed state and records in-engine and isolated", async () => {
  const inEngine = await hostWithTools();
  const inEngineSetup = await inEngine.t.host.install({
    manifest: MANIFEST,
    entry: extension,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(inEngineSetup.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const expected = await runScenario(inEngine.t, inEngine.tools);

  const isolated = await hostWithTools();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const isolatedSetup = await isolated.t.host.install({
    manifest: MANIFEST,
    entry: isolatedEntry(port, clock),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(isolatedSetup.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const actual = await runScenario(isolated.t, isolated.tools);

  // 격리 경우가 실제로 자식을 거쳤는지 확인한다(한 프로세스가 떠 있고 훅 요청을 받았다)
  expect(port.children.length).toBe(1);
  expect(port.children[0]?.received()).toContain('"hook.invoke"');
  expect(port.children[0]?.received()).toContain('"tool.execute"');
  expect(port.children[0]?.received()).toContain('"command.run"');
  expect(actual).toEqual(expected);
  // 기대 값 자체도 픽스처의 의도대로인지 확인한다(두 경우가 모두 빈 결과로 같아지는 것을 막는다)
  const { steps } = expected;
  expect(steps[1]).toEqual({
    fold: "first",
    decision: { block: true, reason: "the fixture blocks it" },
    reasons: [],
  });
  expect(steps[2]).toEqual({
    fold: "first",
    decision: FIRST_DENY["tool.call.before"],
    substituted: true,
    reasons: ["threw"],
  });
  expect(steps[3]).toMatchObject({ fold: "chain", value: { details: { modifiedBy: "eq" } } });
  expect(steps[5]).toEqual({ tool: { args: { text: "from the tool" }, count: 1 } });
  expect(steps[6]).toEqual({ command: { message: "ran abc", result: { length: 3 } } });
  expect(expected.state).toEqual({ count: 1, seen: ["eq-tool"] });
  expect(
    expected.records.some((record) => JSON.stringify(record).includes('"tool":"eq-tool"')),
  ).toBe(true);
});

test("a plugin process that dies mid-call fails the hook with process_exit and works again after relaunch", async () => {
  const { t } = await hostWithTools();
  const port = createFakeProcessPort();
  const clock = createManualClock();
  await t.host.install({
    manifest: MANIFEST,
    entry: isolatedEntry(port, clock),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  const thread = t.newThread();
  await t.host.openThread(thread);

  // 1. 차단 훅(first, closed)이 응답 도중 죽는다: 차단 결정으로 대체되고 이유는 process_exit다
  const dying = t.host.dispatch("tool.call.before", callOf("hang", "call-h"), {
    threadId: thread,
    dispatchKey: "k-hang",
  });
  await until(() => port.children[0]?.received().includes('"hang"') === true, "the hang request");
  port.children[0]?.crash();
  const died = await dying;
  expect(died.decision).toEqual(FIRST_DENY["tool.call.before"]);
  expect(died.substituted).toBe(true);
  expect(reasonsOf(died.failures)).toEqual(["process_exit"]);

  // 2. 다시 띄워 정상 응답을 받는다(성공 응답이 죽음 셈을 되돌린다)
  const relaunched = await t.host.dispatch("tool.call.before", callOf("blocked", "call-b"), {
    threadId: thread,
    dispatchKey: "k-relaunch",
  });
  expect(relaunched.decision).toEqual({ block: true, reason: "the fixture blocks it" });
  expect(port.children.length).toBe(2);

  // 3. 변경 훅(chain, skip)이 응답 도중 죽는다: 값은 바뀌지 않고 이유는 process_exit다
  const initial = { content: [], isError: false };
  const chaining = t.host.dispatch("tool.result", callOf("hang-result", "call-r"), {
    threadId: thread,
    dispatchKey: "k-result-hang",
    initial,
  });
  await until(
    () => port.children.at(-1)?.received().includes('"hang-result"') === true,
    "the hang-result request",
  );
  port.children.at(-1)?.crash();
  const skipped = await chaining;
  expect(skipped.value).toEqual(initial);
  expect(reasonsOf(skipped.failures)).toEqual(["process_exit"]);

  // 4. 다시 띄운 뒤 같은 변경 훅이 정상으로 돈다. 상태는 엔진에 있어 죽음과 무관하게 남는다
  const patched = await t.host.dispatch("tool.result", callOf("eq-tool", "call-r2"), {
    threadId: thread,
    dispatchKey: "k-result-again",
    initial,
  });
  expect(reasonsOf(patched.failures)).toEqual([]);
  expect(patched.value).toMatchObject({ details: { modifiedBy: "eq", toolName: "eq-tool" } });
  expect(port.children.length).toBe(3);
  expect(port.children[0]?.received()).toContain('"hook.invoke"');

  const snapshot = await snapshotOf(t.records, thread);
  // 커밋이 없었으므로 저장된 상태 문서가 없다. 죽음은 엔진 쪽 상태를 건드리지 않는다
  expect(snapshot.states.find((entry) => entry.scopeId === "eq")).toBeUndefined();
});
