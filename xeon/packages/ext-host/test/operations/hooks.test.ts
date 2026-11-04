import { expect, test } from "bun:test";
import type { HookRawRun, HookRunSpec, TraceReadPort } from "@fresnel/contracts/extensions";
import {
  createHookRunner,
  hookEnv,
  interpretHookRun,
  mergeHookDefs,
  type HookDef,
  type LoadedHook,
} from "../../src/operations/index.ts";
import { HOOK_SOURCES } from "../../src/operations/hooks/config.ts";
import { hookUnitName, isHookUnitName } from "../../src/operations/hooks/names.ts";
import { traceReadOf } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createOperationsHarness } from "./support/harness.ts";

const rawOk: HookRawRun = {
  exitCode: 0,
  signal: null,
  stdout: "",
  stdoutTruncated: false,
  stderr: "",
  timedOut: false,
};

const def = (patch: Partial<HookDef> & Pick<HookDef, "id" | "point">): HookDef => ({
  command: ["/bin/true"],
  ...patch,
});

test("interpretHookRun: exit code table for first, chain and tap", () => {
  const decision = JSON.stringify({ decision: { block: true, reason: "no", terminate: false } });
  expect(interpretHookRun("first", { ...rawOk, stdout: "" })).toEqual({ kind: "pass" });
  expect(interpretHookRun("first", { ...rawOk, stdout: decision })).toEqual({
    kind: "decision",
    decision: { block: true, reason: "no", terminate: false },
  });
  expect(interpretHookRun("chain", { ...rawOk, stdout: '{"patch":{"a":1}}' })).toEqual({
    kind: "patch",
    patch: { a: 1 },
  });
  expect(interpretHookRun("first", { ...rawOk, stdout: "not json" })).toEqual({
    kind: "failure",
    failure: "hook_output",
    detail: "stdout is not a valid hook output",
  });
  expect(interpretHookRun("first", { ...rawOk, stdout: '{"extra":1}' }).kind).toBe("failure");
  expect(interpretHookRun("tap", { ...rawOk, stdout: "garbage" })).toEqual({ kind: "pass" });
  expect(interpretHookRun("first", { ...rawOk, exitCode: 2, stderr: "x".repeat(900) })).toEqual({
    kind: "deny",
    reason: "x".repeat(500),
  });
  expect(interpretHookRun("chain", { ...rawOk, exitCode: 2 })).toEqual({ kind: "pass" });
  expect(interpretHookRun("tap", { ...rawOk, exitCode: 2 })).toEqual({ kind: "pass" });
  expect(interpretHookRun("first", { ...rawOk, exitCode: 1 })).toEqual({
    kind: "failure",
    failure: "hook_exit",
    detail: "exit 1",
  });
  expect(interpretHookRun("tap", { ...rawOk, exitCode: null, signal: "SIGKILL" })).toEqual({
    kind: "failure",
    failure: "hook_exit",
    detail: "signal SIGKILL",
  });
  expect(interpretHookRun("first", { ...rawOk, spawnError: "ENOENT" })).toEqual({
    kind: "failure",
    failure: "hook_spawn",
    detail: "ENOENT",
  });
  expect(interpretHookRun("first", { ...rawOk, timedOut: true, exitCode: null }).kind).toBe(
    "failure",
  );
  expect(interpretHookRun("tap", { ...rawOk, stdoutTruncated: true })).toEqual({
    kind: "failure",
    failure: "hook_output",
    detail: "stdout exceeds the limit",
  });
});

test("hookEnv: only the allow list, never a secret-looking name, plus the injected values", () => {
  const env = hookEnv(
    {
      PATH: "/bin",
      HOME: "/home/u",
      ANTHROPIC_API_KEY: "sk-secret",
      GITHUB_TOKEN: "t",
      MY_VAR: "v",
      OTHER: "o",
      DB_PASSWORD: "p",
    },
    def({
      id: "h-one",
      point: "thread.start",
      env: ["MY_VAR", "GITHUB_TOKEN", "DB_PASSWORD", "OTHER"],
    }),
    ["MY_VAR", "GITHUB_TOKEN", "DB_PASSWORD"],
    { hookId: "h-one", point: "thread.start", threadId: "thr_1", projectDir: "/work" },
  );
  expect(env).toEqual({
    PATH: "/bin",
    HOME: "/home/u",
    MY_VAR: "v",
    FRESNEL_HOOK_ID: "h-one",
    FRESNEL_HOOK_HOOK: "thread.start",
    FRESNEL_THREAD_ID: "thr_1",
    FRESNEL_PROJECT_DIR: "/work",
  });
});

test("mergeHookDefs: scope order, outer scope wins a duplicate id, untrusted scopes and bad rows are dropped", () => {
  const a = def({ id: "aa", point: "thread.start" });
  const b = def({ id: "bb", point: "thread.start" });
  const merged = mergeHookDefs(
    {
      managed: [a],
      user: [{ ...b }, { id: "aa", point: "thread.start", command: ["x"] }, { id: "Bad!" }],
      project: [def({ id: "pp", point: "thread.start" })],
      local: [def({ id: "ll", point: "thread.start" })],
    },
    { managed: true, user: true, project: false, local: true },
  );
  expect(merged.hooks.map((hook) => [hook.def.id, hook.source, hook.tier, hook.index])).toEqual([
    ["aa", "managed", "guard", 0],
    ["bb", "user", "user", 1],
    ["ll", "local", "project", 2],
  ]);
  expect(merged.issues.map((issue) => issue.source)).toEqual(["user", "user"]);
});

interface Rig {
  readonly specs: HookRunSpec[];
  readonly harness: Awaited<ReturnType<typeof createOperationsHarness>>;
  readonly runner: ReturnType<typeof createHookRunner>;
}

async function rig(
  hooks: readonly LoadedHook[],
  respond: (spec: HookRunSpec) => HookRawRun,
  saved: string[] = [],
): Promise<Rig> {
  const specs: HookRunSpec[] = [];
  const late: {
    policy?: Awaited<ReturnType<typeof createOperationsHarness>>["policy"];
    harness?: Awaited<ReturnType<typeof createOperationsHarness>>;
  } = {};
  const runner = createHookRunner({
    process: () => ({
      run: (spec) => {
        specs.push(spec);
        // 실행 한 번이 7ms 걸린다. 시계는 하네스의 가짜 시계를 쓴다(계측의 atMs와 같은 시계)
        const advanced = late.harness?.t.timers.advance(7) ?? Promise.resolve();
        return advanced.then(() => respond(spec));
      },
    }),
    hooks: () => hooks,
    savedDisabled: () => saved,
    projectDir: () => "/work",
    home: () => "/home/u",
    parentEnv: () => ({ PATH: "/bin", API_TOKEN: "s" }),
    envAllow: () => [],
    budgetMs: () => 30_000,
    setTimer: () => () => {},
    now: () => late.harness?.t.timers.now() ?? 1,
    report: (record) => late.policy?.autoDisabler.onOutcome(record),
    log: () => {},
  });
  const harness = await createOperationsHarness({ hooks: runner });
  late.policy = harness.policy;
  late.harness = harness;
  await eachInOrder(runner.units(), async (unit) => {
    await harness.t.host.install(unit);
    return "continue";
  });
  return { specs, harness, runner };
}

function loaded(d: HookDef, source: LoadedHook["source"] = "user"): LoadedHook {
  return { def: d, source, tier: source === "managed" ? "guard" : "user", index: 0 };
}

const toolPayload = (name: string) => ({
  toolCallId: "call_1",
  toolName: name,
  input: { command: "rm -rf /" },
});

test("runner: exit 2 denies tool.call.before with the stderr reason, matched by tool name, with a cleaned env and JSON on stdin", async () => {
  const hook = loaded(
    def({ id: "no-rm", point: "tool.call.before", tools: ["bash"], command: ["check", "--x"] }),
  );
  const { harness, specs } = await rig([hook], () => ({
    ...rawOk,
    exitCode: 2,
    stderr: "rm is blocked",
  }));
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const bash = await harness.t.host.dispatch("tool.call.before", toolPayload("bash"), {
    threadId: thread,
    dispatchKey: "k1",
  });
  expect(bash).toMatchObject({
    fold: "first",
    decision: { block: true, reason: "rm is blocked", terminate: false },
  });
  const read = await harness.t.host.dispatch("tool.call.before", toolPayload("read"), {
    threadId: thread,
    dispatchKey: "k2",
  });
  expect(read).toMatchObject({ fold: "first", decision: undefined });
  expect(specs).toHaveLength(1);
  const spec = specs[0];
  expect(spec?.argv).toEqual(["check", "--x"]);
  expect(spec?.cwd).toBe("/work");
  expect(spec?.env["API_TOKEN"]).toBeUndefined();
  expect(spec?.env["FRESNEL_HOOK_ID"]).toBe("no-rm");
  const stdin = JSON.parse(spec?.stdin ?? "");
  expect(stdin).toMatchObject({
    schemaVersion: "fresnel.hook.v1",
    hookId: "no-rm",
    point: "tool.call.before",
    fold: "first",
    threadId: thread,
    payload: toolPayload("bash"),
  });
});

test("runner: a failing first hook is denied (fail closed) and five failures ask whether to turn the hook off; a saved id is skipped", async () => {
  const hook = loaded(def({ id: "flaky", point: "tool.call.before" }));
  const { harness, runner } = await rig([hook], () => ({ ...rawOk, exitCode: 1 }));
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  await eachInOrder([0, 1, 2, 3, 4], async (i) => {
    const outcome = await harness.t.host.dispatch("tool.call.before", toolPayload("bash"), {
      threadId: thread,
      dispatchKey: `k${i}`,
    });
    expect(outcome).toMatchObject({
      decision: { block: true, terminate: false },
      substituted: false,
    });
    return "continue";
  });
  expect(
    harness.policy.autoDisabler.questions().map((q) => [q.key, q.rule, q.consecutive]),
  ).toEqual([["hook:flaky", "consecutive", 5]]);
  // "끄기" 답: 이번 실행에서 건너뛴다
  expect(harness.policy.autoDisabler.answer("hook:flaky", true)).toBe(true);
  expect(runner.isDisabled("flaky")).toBe(true);
  const after = await harness.t.host.dispatch("tool.call.before", toolPayload("bash"), {
    threadId: thread,
    dispatchKey: "k-after",
  });
  expect(after).toMatchObject({ decision: undefined });
  // 저장된 id는 처음부터 건너뛴다
  const saved = await rig([hook], () => ({ ...rawOk, exitCode: 1 }), ["flaky"]);
  const t2 = saved.harness.t.newThread();
  await saved.harness.t.host.openThread(t2);
  const skipped = await saved.harness.t.host.dispatch("tool.call.before", toolPayload("bash"), {
    threadId: t2,
    dispatchKey: "s1",
  });
  expect(skipped).toMatchObject({ decision: undefined });
  expect(saved.specs).toHaveLength(0);
});

// 계측 행(X.operations §4.8.2). 훅이 맞지 않은 호출에는 단위 행도 항목도 없다. 맞은 훅은 `hook:<id>` 행으로 활성 시간과 결과를 남긴다.

test("trace: a call no external hook matches leaves no unit row and no entry", async () => {
  const hook = loaded(def({ id: "only-bash", point: "tool.call.before", tools: ["bash"] }));
  const { harness, specs } = await rig([hook], () => rawOk);
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const turn = harness.t.ids.next("trn");
  await harness.t.host.dispatch("tool.call.before", toolPayload("read"), {
    threadId: thread,
    dispatchKey: `${turn}:tool`,
  });
  expect(traceReadOf(harness.t.host).turn(thread, turn)?.entries).toEqual([]);
  expect(specs).toHaveLength(0);
});

test("trace: a matched external hook is listed as hook:<id> with its duration and result; hooks a stop skipped name the stopper", async () => {
  const hooks = [
    loaded(def({ id: "wrap", point: "input.user.before" })),
    loaded(def({ id: "later", point: "input.user.before" })),
  ];
  const patch = { action: "transform", text: "[hi]" };
  const { harness } = await rig(hooks, (spec) =>
    spec.env["FRESNEL_HOOK_ID"] === "wrap"
      ? { ...rawOk, stdout: JSON.stringify({ patch }) }
      : rawOk,
  );
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const turn = harness.t.ids.next("trn");
  await harness.t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    {
      threadId: thread,
      dispatchKey: `${turn}:input.user.before`,
      initial: { text: "hi", handled: false },
    },
  );
  // 패치는 범위 안에서 멈춘다. 뒤 훅은 실행하지 않았고 멈춘 훅 `hook:wrap`을 가리키는 건너뜀 행이다
  expect(traceReadOf(harness.t.host).turn(thread, turn)?.entries).toEqual([
    {
      seq: 0,
      hook: "input.user.before",
      step: 0,
      handlers: [
        {
          registrationId: "hook:wrap",
          ms: 7,
          result: "modified",
          atMs: 0,
          size: JSON.stringify(patch).length,
          skippedBy: null,
          reason: null,
        },
        {
          registrationId: "hook:later",
          ms: 0,
          result: "skipped",
          atMs: 7,
          size: 0,
          skippedBy: "hook:wrap",
          reason: null,
        },
      ],
    },
  ]);
});

test("trace: a first hook's denial is blocked, a crash is failed with threw, a timeout with timeout, and invalid stdout with result_invalid", async () => {
  const hooks = [
    loaded(def({ id: "deny-bash", point: "tool.call.before", tools: ["bash"] })),
    loaded(def({ id: "slow-read", point: "tool.call.before", tools: ["read"] })),
    loaded(def({ id: "garbled-grep", point: "tool.call.before", tools: ["grep"] })),
    loaded(def({ id: "crash-ls", point: "tool.call.before", tools: ["ls"] })),
  ];
  const replies: { readonly [hookId: string]: HookRawRun } = {
    "deny-bash": { ...rawOk, exitCode: 2, stderr: "no" },
    "slow-read": { ...rawOk, timedOut: true, exitCode: null },
    "garbled-grep": { ...rawOk, stdout: "not json" },
    "crash-ls": { ...rawOk, exitCode: 7 },
  };
  const { harness } = await rig(
    hooks,
    (spec) => replies[spec.env["FRESNEL_HOOK_ID"] ?? ""] ?? rawOk,
  );
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const cases = [
    ["bash", "deny-bash", "blocked", null],
    ["read", "slow-read", "failed", "timeout"],
    ["grep", "garbled-grep", "failed", "result_invalid"],
    ["ls", "crash-ls", "failed", "threw"],
  ] as const;
  await eachInOrder(cases, async ([toolName, hookId, result, reason]) => {
    const turn = harness.t.ids.next("trn");
    await harness.t.host.dispatch("tool.call.before", toolPayload(toolName), {
      threadId: thread,
      dispatchKey: `${turn}:tool`,
    });
    const handlers = traceReadOf(harness.t.host).turn(thread, turn)?.entries[0]?.handlers;
    expect(handlers?.map((row) => [row.registrationId, row.result, row.reason, row.ms])).toEqual([
      [`hook:${hookId}`, result, reason, 7],
    ]);
    return "continue";
  });
});

// 멈춤 규칙(X.operations §4.7.4 훅별 결과). first는 결정·거부·실패에서 멈추고, chain은 첫 패치에서 멈춘다.
// tap과 chain의 실패는 기록만 남기고 뒤 훅을 멈추지 않는다. 멈춘 뒤의 매칭 훅만 `skipped` 행을 남긴다.

type TraceTurn = NonNullable<ReturnType<TraceReadPort["turn"]>>;

/** 한 Turn의 계측 행을 [등록 id, 결과, 이유, 멈춘 훅]으로 옮긴다. 활성 시간과 크기는 뺀다 */
function rowsOf(turn: TraceTurn | undefined): unknown[][] {
  return (turn?.entries ?? []).flatMap((entry) =>
    entry.handlers.map((row) => [row.registrationId, row.result, row.reason, row.skippedBy]),
  );
}

/** 실행된 훅 id를 실행 순서대로 */
function hookIdsOf(specs: readonly HookRunSpec[]): (string | undefined)[] {
  return specs.map((spec) => spec.env["FRESNEL_HOOK_ID"]);
}

test("stop rule: a failing tap hook does not stop the next tap hook of its scope", async () => {
  const hooks = [
    loaded(def({ id: "tap-bad", point: "boundary.settle.after" })),
    loaded(def({ id: "tap-next", point: "boundary.settle.after" })),
  ];
  const { harness, specs } = await rig(hooks, (spec) =>
    spec.env["FRESNEL_HOOK_ID"] === "tap-bad" ? { ...rawOk, exitCode: 1 } : rawOk,
  );
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const turn = harness.t.ids.next("trn");
  await harness.t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:settle` },
  );
  expect(hookIdsOf(specs)).toEqual(["tap-bad", "tap-next"]);
  expect(rowsOf(traceReadOf(harness.t.host).turn(thread, turn))).toEqual([
    ["hook:tap-bad", "failed", "threw", null],
    ["hook:tap-next", "passed", null, null],
  ]);
});

test("stop rule: a failing chain hook drops its patch and does not stop the next chain hook, which sees the value before it", async () => {
  const hooks = [
    loaded(def({ id: "chain-bad", point: "input.user.before" })),
    loaded(def({ id: "chain-next", point: "input.user.before" })),
  ];
  const patch = { action: "transform", text: "[next]" };
  const { harness, specs } = await rig(hooks, (spec) =>
    spec.env["FRESNEL_HOOK_ID"] === "chain-bad"
      ? { ...rawOk, exitCode: 1 }
      : { ...rawOk, stdout: JSON.stringify({ patch }) },
  );
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const turn = harness.t.ids.next("trn");
  const outcome = await harness.t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    {
      threadId: thread,
      dispatchKey: `${turn}:input.user.before`,
      initial: { text: "hi", handled: false },
    },
  );
  expect(hookIdsOf(specs)).toEqual(["chain-bad", "chain-next"]);
  expect(JSON.parse(specs[1]?.stdin ?? "").current).toEqual({ text: "hi", handled: false });
  expect(outcome).toMatchObject({ fold: "chain", stopped: false });
  expect(rowsOf(traceReadOf(harness.t.host).turn(thread, turn))).toEqual([
    ["hook:chain-bad", "failed", "threw", null],
    ["hook:chain-next", "modified", null, null],
  ]);
});

test("stop rule: a first hook that fails stops the scope, and the next first hook is skipped by it", async () => {
  const hooks = [
    loaded(def({ id: "first-bad", point: "tool.call.before" })),
    loaded(def({ id: "first-next", point: "tool.call.before" })),
  ];
  const { harness, specs } = await rig(hooks, (spec) =>
    spec.env["FRESNEL_HOOK_ID"] === "first-bad" ? { ...rawOk, exitCode: 1 } : rawOk,
  );
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const turn = harness.t.ids.next("trn");
  const outcome = await harness.t.host.dispatch("tool.call.before", toolPayload("bash"), {
    threadId: thread,
    dispatchKey: `${turn}:tool`,
  });
  // 실패는 거부로 바뀐다(fail closed)
  expect(outcome).toMatchObject({ decision: { block: true, terminate: false } });
  expect(hookIdsOf(specs)).toEqual(["first-bad"]);
  expect(rowsOf(traceReadOf(harness.t.host).turn(thread, turn))).toEqual([
    ["hook:first-bad", "failed", "threw", null],
    ["hook:first-next", "skipped", null, "hook:first-bad"],
  ]);
});

test("stop rule: a first hook that blocks with exit 2 stops the scope, and the next first hook is skipped by it", async () => {
  const hooks = [
    loaded(def({ id: "first-deny", point: "tool.call.before" })),
    loaded(def({ id: "first-after", point: "tool.call.before" })),
  ];
  const { harness, specs } = await rig(hooks, (spec) =>
    spec.env["FRESNEL_HOOK_ID"] === "first-deny" ? { ...rawOk, exitCode: 2, stderr: "no" } : rawOk,
  );
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const turn = harness.t.ids.next("trn");
  const outcome = await harness.t.host.dispatch("tool.call.before", toolPayload("bash"), {
    threadId: thread,
    dispatchKey: `${turn}:tool`,
  });
  expect(outcome).toMatchObject({ decision: { block: true, reason: "no", terminate: false } });
  expect(hookIdsOf(specs)).toEqual(["first-deny"]);
  expect(rowsOf(traceReadOf(harness.t.host).turn(thread, turn))).toEqual([
    ["hook:first-deny", "blocked", null, null],
    ["hook:first-after", "skipped", null, "hook:first-deny"],
  ]);
});

test("stop rule: a first hook that passes with no decision does not stop the next one", async () => {
  const hooks = [
    loaded(def({ id: "first-pass", point: "tool.call.before" })),
    loaded(def({ id: "first-last", point: "tool.call.before" })),
  ];
  const { harness, specs } = await rig(hooks, () => rawOk);
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  const turn = harness.t.ids.next("trn");
  await harness.t.host.dispatch("tool.call.before", toolPayload("bash"), {
    threadId: thread,
    dispatchKey: `${turn}:tool`,
  });
  expect(hookIdsOf(specs)).toEqual(["first-pass", "first-last"]);
  expect(rowsOf(traceReadOf(harness.t.host).turn(thread, turn))).toEqual([
    ["hook:first-pass", "passed", null, null],
    ["hook:first-last", "passed", null, null],
  ]);
});

test("unit names: isHookUnitName matches exactly the four built-in unit names, no other fresnel-hooks- name", () => {
  for (const source of HOOK_SOURCES) expect(isHookUnitName(hookUnitName(source))).toBe(true);
  expect(
    [
      "fresnel-hooks-x",
      "fresnel-hooks-",
      "fresnel-hooks-user-2",
      "fresnel-hooks-User",
      "hooks-user",
    ].map((name) => isHookUnitName(name)),
  ).toEqual([false, false, false, false, false]);
});
