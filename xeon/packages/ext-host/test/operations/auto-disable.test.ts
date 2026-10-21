import { expect, test } from "bun:test";
import {
  createAutoDisabler,
  createFailureLedger,
  createLogNotifier,
  createScopeControl,
  DEFAULT_AUTO_DISABLE,
  judgeAutoDisable,
  type AutoDisablePolicy,
  type HandlerOutcomeRecord,
  type OperationsNotifier,
  type ScopeChangeReason,
  type ScopeControl,
  type Tier,
} from "../../src/operations/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

function failed(
  name: string,
  tier: Tier,
  result: HandlerOutcomeRecord["result"] = "threw",
): HandlerOutcomeRecord {
  return {
    owner: { type: "extension", name, scopeId: name },
    tier,
    point: "tool_result",
    fold: "chain",
    result,
    activeMs: 1,
    at: 1,
  };
}

interface Recorder {
  readonly requests: string[];
  readonly notices: string[];
  readonly scopes: ScopeControl;
  readonly notifier: OperationsNotifier;
}

function recorder(): Recorder {
  const requests: string[] = [];
  const notices: string[] = [];
  return {
    requests,
    notices,
    scopes: {
      requestDisable: (scopeId: string, reason: ScopeChangeReason) => {
        requests.push(`disable:${scopeId}:${reason}`);
      },
      requestEnable: (scopeId: string, reason: ScopeChangeReason) => {
        requests.push(`enable:${scopeId}:${reason}`);
      },
      scopesOf: (extension: string) => [extension, `${extension}/sub`],
    },
    notifier: {
      handlerFailed: (_outcome, stats) => {
        notices.push(`failed:${stats.consecutive}`);
      },
      autoDisabled: (key, verdict) => {
        notices.push(`disabled:${key}:${verdict.rule}`);
      },
    },
  };
}

function disablerOf(rec: Recorder, policy: AutoDisablePolicy = DEFAULT_AUTO_DISABLE) {
  const ledger = createFailureLedger({ windowSize: policy.windowSize });
  const hooks: string[] = [];
  const disabler = createAutoDisabler({
    ledger,
    policy: () => policy,
    scopes: rec.scopes,
    hooks: {
      disable: (id) => hooks.push(`disable:${id}`),
      enable: (id) => hooks.push(`enable:${id}`),
    },
    notifier: rec.notifier,
  });
  return { disabler, ledger, hooks };
}

test("autoDisable: five consecutive failures request disable once", () => {
  const rec = recorder();
  const { disabler } = disablerOf(rec);
  for (let i = 0; i < 4; i += 1) disabler.onOutcome(failed("flaky-ext", "user"));
  expect(rec.requests).toEqual([]);
  disabler.onOutcome(failed("flaky-ext", "user"));
  expect(rec.requests).toEqual([
    "disable:flaky-ext:auto_disable",
    "disable:flaky-ext/sub:auto_disable",
  ]);
  disabler.onOutcome(failed("flaky-ext", "user"));
  expect(rec.requests).toHaveLength(2);
  expect(disabler.disabled()).toEqual(["ext:flaky-ext"]);
  expect(rec.notices).toContain("disabled:ext:flaky-ext:consecutive");
});

function stats(windowFailures: number, windowCalls: number) {
  return {
    consecutive: 1,
    windowCalls,
    windowFailures,
    totalCalls: windowCalls,
    totalFailures: windowFailures,
  };
}

test("autoDisable: failure rate rule", () => {
  const policy = DEFAULT_AUTO_DISABLE;
  expect(judgeAutoDisable(stats(10, 20), policy, false)).toMatchObject({
    disable: true,
    rule: "rate",
  });
  expect(judgeAutoDisable(stats(9, 10), policy, false)).toEqual({ disable: false });
  expect(judgeAutoDisable(stats(10, 50), policy, false)).toEqual({ disable: false });
  expect(judgeAutoDisable(stats(10, 20), { ...policy, enabled: false }, false)).toEqual({
    disable: false,
  });
  expect(judgeAutoDisable({ ...stats(0, 0), consecutive: 5 }, policy, false)).toMatchObject({
    rule: "consecutive",
  });
});

test("autoDisable: guard and core are exempt", () => {
  const rec = recorder();
  const { disabler } = disablerOf(rec);
  for (let i = 0; i < 20; i += 1) disabler.onOutcome(failed("guarded", "guard"));
  for (let i = 0; i < 20; i += 1) disabler.onOutcome(failed("coreish", "core"));
  expect(rec.requests).toEqual([]);
  expect(rec.notices.filter((notice) => notice.startsWith("failed:")).length).toBe(40);
});

test("autoDisable: reenable resets ledger", () => {
  const rec = recorder();
  const { disabler, ledger } = disablerOf(rec);
  for (let i = 0; i < 5; i += 1) disabler.onOutcome(failed("flaky-ext", "user"));
  rec.requests.length = 0;
  disabler.reenable("ext:flaky-ext");
  expect(ledger.stats("ext:flaky-ext").totalCalls).toBe(0);
  expect(rec.requests).toEqual(["enable:flaky-ext:request", "enable:flaky-ext/sub:request"]);
  expect(disabler.disabled()).toEqual([]);
  // 다시 기준을 넘으면 다시 꺼진다
  for (let i = 0; i < 5; i += 1) disabler.onOutcome(failed("flaky-ext", "user"));
  expect(rec.requests.filter((request) => request.startsWith("disable:flaky-ext"))).toHaveLength(2);
});

test("autoDisable: aborted does not change the ledger", () => {
  const rec = recorder();
  const { disabler, ledger } = disablerOf(rec);
  disabler.onOutcome(failed("flaky-ext", "user", "threw"));
  disabler.onOutcome(failed("flaky-ext", "user", "aborted"));
  disabler.onOutcome(failed("flaky-ext", "user", "value_from_tap"));
  expect(ledger.stats("ext:flaky-ext")).toMatchObject({ consecutive: 1, windowCalls: 1 });
});

test("autoDisable: hooks and forced disable", () => {
  const rec = recorder();
  const { disabler, hooks } = disablerOf(rec);
  const hookOutcome: HandlerOutcomeRecord = {
    owner: { type: "hook", hookId: "audit" },
    tier: "user",
    point: "tool_call",
    fold: "first",
    result: "hook_exit",
    activeMs: 1,
    at: 1,
  };
  for (let i = 0; i < 5; i += 1) disabler.onOutcome(hookOutcome);
  expect(hooks).toEqual(["disable:audit"]);
  disabler.disableNow("ext:isolated-ext", "isolation_restart_limit");
  expect(rec.requests.filter((request) => request.includes("isolated-ext"))).toHaveLength(2);
  disabler.reenable("hook:audit");
  expect(hooks).toEqual(["disable:audit", "enable:audit"]);
});

test("autoDisable: log notifier and scope control adapter", () => {
  const lines: string[] = [];
  const notifier = createLogNotifier((line) => lines.push(line));
  notifier.handlerFailed(failed("flaky-ext", "user"), {
    consecutive: 2,
    windowCalls: 2,
    windowFailures: 2,
    totalCalls: 2,
    totalFailures: 2,
  });
  expect(lines[0]).toContain("ext:flaky-ext");
  const calls: string[] = [];
  const control = createScopeControl({
    scopes: () => [
      { id: "a-ext", extension: "a-ext" },
      { id: "a-ext/sub", extension: "a-ext" },
      { id: "b-ext", extension: "b-ext" },
    ],
    request: (scopeId, enabled, reason) => calls.push(`${scopeId}:${enabled}:${reason}`),
  });
  expect(control.scopesOf("a-ext")).toEqual(["a-ext", "a-ext/sub"]);
  control.requestDisable("a-ext", "safe_mode");
  control.requestEnable("a-ext", "request");
  expect(calls).toEqual(["a-ext:false:safe_mode", "a-ext:true:request"]);
});

test("autoDisable: applied at step boundary", async () => {
  const harness = await createOperationsHarness({ settings: { autoDisable: { consecutive: 2 } } });
  const { t, policy } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  policy.admit({ name: "auto-bad", source: "user", trust: "user", essential: false }, "plugin");
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "auto-bad", points: ["agent_settled"] }, (g) => {
      g.on("agent_settled", () => {
        calls.push("handler");
        throw new Error("always fails");
      });
    }),
  );
  await t.boundary(thread).stepEnd();
  // turn이 도는 중이다: 끄기 적용은 단계 경계를 기다린다
  t.loop.setRunning(thread, true);
  const fire = (key: string) =>
    t.host.dispatch(
      "agent_settled",
      { turnId: t.ids.next("trn"), aborted: false },
      { threadId: thread, dispatchKey: key },
    );
  await fire("1");
  await fire("2");
  // 요청은 기록되었지만 적용 전이다: 실행 중인 디스패치는 끊기지 않고 핸들러는 계속 돈다
  expect(harness.requests).toEqual(["disable:auto-bad:auto_disable"]);
  expect(t.host.scope("auto-bad")?.status).toBe("disabling");
  await fire("3");
  expect(calls).toHaveLength(3);
  expect(harness.requests).toHaveLength(1);
  const drafts = await t.boundary(thread).stepEnd();
  expect(drafts.map((draft) => draft.payload)).toEqual([
    { scopeId: "auto-bad", status: "disabled", reason: "auto_disable" },
  ]);
  await fire("4");
  expect(calls).toHaveLength(3);
});
