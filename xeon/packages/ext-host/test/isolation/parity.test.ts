// enH1이 더한 것(새 훅 넷, ask·replace 결정과 합치기, thread.resources의 workspace, ctx.changes.report, hookDecides,
// 내부 훅 거부)을 같은 픽스처로 엔진 안과 격리 자식에서 돌려, 같은 결과를 내는지 본다.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { err, ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  pluginDeclsOf,
  ToolsPortKey,
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type ReportedFileChange,
  type ToolResourceDef,
} from "@fresnel/contracts/extensions";
import { createIsolatedEntry } from "../../src/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import type { HandlerFailure } from "../../src/primitives/dispatch-types.ts";
import { makeManifest, snapshotOf } from "../primitives/fixtures/support.ts";
import { extension, PARITY_HOOKS } from "./fixtures/parity-plugin.ts";
import {
  createFakeProcessPort,
  createManualClock,
  recordingLogger,
  type FakeProcessPort,
  type ManualClock,
} from "./support/fake-process.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures", import.meta.url));

const BASE = makeManifest({ name: "pa", hooks: [...PARITY_HOOKS] });
/** 매니페스트 `hookDecides`로 결정 종류를 미리 적는다. 격리 쪽도 같은 매니페스트를 자식에게 준다 */
const MANIFEST: ExtensionManifest = {
  ...BASE,
  plugins: pluginDeclsOf(BASE).map((plugin) =>
    Object.assign({}, plugin, {
      hookDecides: [
        { hook: "tool.call.before" as const, decides: ["ask" as const, "replace" as const] },
        { hook: "agent.spawn.before" as const, decides: ["block" as const, "replace" as const] },
      ],
    }),
  ),
  entry: "./parity-plugin.ts",
};

function isolatedEntry(port: FakeProcessPort, clock: ManualClock): ExtensionEntry {
  return createIsolatedEntry({
    manifest: MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "pa-1",
    port,
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger([]),
    initTimeoutMs: 1000,
  });
}

/** 같은 확장 이름 `pb`의 엔진 안 플러그인. `both`에는 ask로 답해 `pa`의 replace와 합쳐지게 한다 */
const ASKER: ExtensionEntry = ({ register }) => {
  register("pb", { defaultEnabled: true }, (g) => {
    g.on("tool.call.before", (payload) =>
      payload.toolName === "both" ? { ask: true, reason: "pb asks" } : undefined,
    );
  });
};

async function hostWithTools(): Promise<{
  readonly t: TestHost;
  readonly tools: Map<string, ToolResourceDef>;
}> {
  const t = await createTestHost();
  const tools = new Map<string, ToolResourceDef>();
  await t.host.registerPlatform({
    name: "parity-tools-port",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        toolMappedFor: () => false,
        executeForPlugin: () =>
          Promise.resolve(
            err({ kind: "unavailable", message: "test double: plugin calls are not used here" }),
          ),
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  await t.host.install({
    manifest: makeManifest({ name: "pb", hooks: ["tool.call.before"] }),
    entry: ASKER,
    loadIndex: 1,
    builtin: false,
    trust: "user",
  });
  return { t, tools };
}

function reasonsOf(failures: readonly HandlerFailure[]): readonly string[] {
  return failures.map((failure) => failure.reason);
}

const USAGE = null;

const call = (toolName: string) => ({ toolCallId: `c-${toolName}`, toolName, input: {} });

async function runScenario(t: TestHost, tools: ReadonlyMap<string, ToolResourceDef>) {
  const thread: ThreadId = t.newThread();
  await t.host.openThread(thread);
  const steps: unknown[] = [];
  let seq = 0;
  const key = (name: string): string => `k-${name}-${String((seq += 1))}`;

  const toolNames = ["plain", "ask-it", "replace-it", "both"];
  const toolOuts = await Promise.all(
    toolNames.map((name) =>
      t.host.dispatch("tool.call.before", call(name), { threadId: thread, dispatchKey: key(name) }),
    ),
  );
  toolOuts.forEach((out, index) => {
    steps.push({
      tool: toolNames[index],
      decision: out.decision,
      reasons: reasonsOf(out.failures),
    });
  });

  const origin = { caller: "model" };
  const askPayload = (askKind: "tool" | "question") => ({
    threadId: thread,
    surfaceThreadId: thread,
    requestKey: "rk-1",
    askKind,
    title: "ask",
    origin,
    summary: {},
    interactive: true,
    unattended: null,
  });
  const kinds = ["tool", "question"] as const;
  const askOuts = await Promise.all(
    kinds.map((kind) =>
      t.host.dispatch("ask.human.before", askPayload(kind), {
        threadId: thread,
        dispatchKey: key(`ask-${kind}`),
      }),
    ),
  );
  askOuts.forEach((out, index) => {
    steps.push({ ask: kinds[index], decision: out.decision, reasons: reasonsOf(out.failures) });
  });
  const after = await t.host.dispatch(
    "ask.human.after",
    {
      threadId: thread,
      approvalId: t.ids.next("evt"),
      askKind: "tool",
      resolution: { decision: "deny", resolvedBy: "user", answer: null },
      durationMs: 5,
      origin,
    },
    { threadId: thread, dispatchKey: key("ask-after") },
  );
  steps.push({ askAfter: reasonsOf(after.failures) });

  const spawn = (agent: string) => ({
    threadId: thread,
    requestId: `r-${agent}`,
    agent,
    task: "do it",
    caller: "main" as const,
    depth: 0,
    entry: "tool" as const,
    background: false,
  });
  const agents = ["plain", "blocked", "reported"];
  const spawnOuts = await Promise.all(
    agents.map((agent) =>
      t.host.dispatch("agent.spawn.before", spawn(agent), {
        threadId: thread,
        dispatchKey: key(`spawn-${agent}`),
      }),
    ),
  );
  spawnOuts.forEach((out, index) => {
    steps.push({ spawn: agents[index], decision: out.decision, reasons: reasonsOf(out.failures) });
  });
  const spawned = await t.host.dispatch(
    "agent.spawn.after",
    {
      threadId: thread,
      requestId: "r-plain",
      agent: "plain",
      status: "completed",
      usage: USAGE,
      childThreadId: thread,
    },
    {
      threadId: thread,
      dispatchKey: key("spawn-after"),
      initial: { report: { text: "original", truncated: false } },
    },
  );
  steps.push({ spawnAfter: spawned.value, reasons: reasonsOf(spawned.failures) });

  const resources = await t.host.dispatch(
    "thread.resources",
    { cwd: "/repo", reason: "startup" },
    {
      threadId: thread,
      dispatchKey: key("resources"),
      initial: {
        skillPaths: [],
        promptPaths: [],
        themePaths: [],
        workspaceCandidates: [],
      },
    },
  );
  steps.push({ resources: resources.value, reasons: reasonsOf(resources.failures) });

  const reported: (readonly ReportedFileChange[])[] = [];
  const tool = tools.get("pa-tool");
  const toolReturn = await tool?.execute(
    { path: "/pa/a.txt" },
    {
      threadId: thread,
      signal: new AbortController().signal,
      toolCallId: "call-pa",
      caller: { kind: "model", agent: "main" },
      changes: {
        report(entries) {
          reported.push(entries);
        },
      },
    },
  );
  steps.push({ tool: toolReturn, reported });

  const snapshot = await snapshotOf(t.records, thread);
  return { steps, state: snapshot.states.find((entry) => entry.scopeId === "pa")?.doc };
}

test("new hooks, ask and replace decisions, merging, workspace and ctx.changes give the same results in-engine and isolated", async () => {
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
  const isolatedSetup = await isolated.t.host.install({
    manifest: MANIFEST,
    entry: isolatedEntry(port, createManualClock()),
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  expect(isolatedSetup.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const actual = await runScenario(isolated.t, isolated.tools);

  expect(port.children.length).toBe(1);
  expect(port.children[0]?.received()).toContain('"tool.execute"');
  expect(actual).toEqual(expected);

  // 기대 값 자체도 의도대로인지 본다(둘 다 빈 결과로 같아지는 것을 막는다)
  const { steps } = expected;
  expect(steps[0]).toMatchObject({ tool: "plain", decision: undefined });
  expect(steps[1]).toMatchObject({ tool: "ask-it", decision: { ask: true, reason: "pa asks" } });
  expect(steps[2]).toMatchObject({ tool: "replace-it", decision: { reason: "pa replaces" } });
  // 합치기: replace가 ask를 이긴다(H-2)
  expect(steps[3]).toMatchObject({ tool: "both", decision: { reason: "pa replaces" } });
  expect(steps[4]).toMatchObject({ ask: "tool", decision: { cancel: true, reason: "pa cancels" } });
  expect(steps[5]).toMatchObject({ ask: "question", decision: undefined });
  expect(steps[7]).toMatchObject({ spawn: "plain", decision: undefined });
  expect(steps[8]).toMatchObject({ spawn: "blocked", decision: { block: true } });
  expect(steps[9]).toMatchObject({
    spawn: "reported",
    decision: { replace: { report: "pa reports" } },
  });
  expect(steps[11]).toMatchObject({
    resources: { skillPaths: ["/pa/skills"], workspace: "/pa/work" },
  });
  expect(steps[12]).toMatchObject({
    reported: [[{ path: "/pa/a.txt", op: "create", existed: false, added: 1, removed: 0 }]],
  });
  expect(expected.state).toEqual({ asked: ["tool"] });
});

/** 내부 훅(`thread.fork.before`)을 선언한 비내장 매니페스트 */
const INTERNAL_MANIFEST = {
  ...makeManifest({ name: "pi", hooks: ["thread.fork.before"] }),
  entry: "./parity-plugin.ts",
};

test("a non-builtin plugin that declares an internal hook is refused by the manifest check and by the isolated host", async () => {
  // 엔진 쪽 로더가 쓰는 검사와 같은 함수를 자식이 `host.init`에서 다시 돌린다
  const verdict = validateManifest(INTERNAL_MANIFEST);
  expect(verdict.issues.map((issue) => [issue.code, issue.severity])).toContainEqual([
    "hook_internal",
    "error",
  ]);

  const isolated = await createTestHost();
  const entry = createIsolatedEntry({
    manifest: INTERNAL_MANIFEST,
    root: FIXTURE_ROOT,
    versionId: "pi-1",
    port: createFakeProcessPort(),
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: createManualClock().setTimer,
    now: createManualClock().now,
    logger: recordingLogger([]),
    initTimeoutMs: 1000,
  });
  const installed = await isolated.host.install({
    manifest: INTERNAL_MANIFEST,
    entry,
    loadIndex: 0,
    builtin: false,
    trust: "user",
  });
  // 자식은 엔트리를 싣지 않고 거부한다: 등록이 남지 않고 이유가 엔트리 오류로 온다
  expect(installed.setups).toEqual([]);
  expect(installed.registrations).toEqual([]);
  expect(String(installed.entryError)).toContain(
    "is internal; only a builtin extension may declare it",
  );
});
