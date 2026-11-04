import { expect, test } from "bun:test";
import type { HookRawRun, HookRunSpec } from "@fresnel/contracts/extensions";
import {
  createHookRunner,
  hookEnv,
  interpretHookRun,
  mergeHookDefs,
  type HookDef,
  type LoadedHook,
} from "../../src/operations/index.ts";
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
  const late: { policy?: Awaited<ReturnType<typeof createOperationsHarness>>["policy"] } = {};
  const runner = createHookRunner({
    process: () => ({
      run: (spec) => {
        specs.push(spec);
        return Promise.resolve(respond(spec));
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
    now: () => 1,
    report: (record) => late.policy?.autoDisabler.onOutcome(record),
    log: () => {},
  });
  const harness = await createOperationsHarness({ hooks: runner });
  late.policy = harness.policy;
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
