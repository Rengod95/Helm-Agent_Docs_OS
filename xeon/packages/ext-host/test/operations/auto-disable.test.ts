import { expect, test } from "bun:test";
import type { ScopeHandlerFailedPayload } from "@xeon/contracts/records";
import {
  createAutoDisabler,
  createFailureLedger,
  createLogNotifier,
  createScopeControl,
  createVolatileNotifier,
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
    point: "tool.result",
    fold: "chain",
    failure: "skip",
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
    point: "tool.call.before",
    fold: "first",
    failure: "closed",
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
    makeUnit({ name: "auto-bad", points: ["boundary.settle.after"] }, (g) => {
      g.on("boundary.settle.after", () => {
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
      "boundary.settle.after",
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

function volatileOf(emitFails = false) {
  const lines: string[] = [];
  const emitted: ScopeHandlerFailedPayload[] = [];
  const notifier = createVolatileNotifier({
    emit: (payload) => {
      if (emitFails) throw new Error("bus down");
      emitted.push(payload);
    },
    log: (line) => {
      lines.push(line);
    },
  });
  return { lines, emitted, notifier };
}

const TWO_FAILURES = {
  consecutive: 2,
  windowCalls: 2,
  windowFailures: 2,
  totalCalls: 2,
  totalFailures: 2,
};

test("volatile notifier: failed handler emits the exact payload and the log line", () => {
  const { lines, emitted, notifier } = volatileOf();
  notifier.handlerFailed({ ...failed("flaky-ext", "user"), message: "boom" }, TWO_FAILURES);
  expect(emitted).toEqual([
    {
      owner: "ext:flaky-ext",
      point: "tool.result",
      result: "threw",
      message: "boom",
      consecutive: 2,
    },
  ]);
  expect(lines).toEqual(["handler failed: ext:flaky-ext tool.result threw (consecutive 2)"]);
  const sameLines: string[] = [];
  createLogNotifier((line) => sameLines.push(line)).handlerFailed(
    failed("flaky-ext", "user"),
    TWO_FAILURES,
  );
  expect(lines).toEqual(sameLines);
});

test("volatile notifier: missing message is empty, consecutive is at least 1, message is capped", () => {
  const { emitted, notifier } = volatileOf();
  notifier.handlerFailed(failed("flaky-ext", "user"), { ...TWO_FAILURES, consecutive: 0 });
  notifier.handlerFailed(
    { ...failed("flaky-ext", "user"), message: "x".repeat(4500) },
    TWO_FAILURES,
  );
  expect(emitted).toEqual([
    { owner: "ext:flaky-ext", point: "tool.result", result: "threw", message: "", consecutive: 1 },
    {
      owner: "ext:flaky-ext",
      point: "tool.result",
      result: "threw",
      message: "x".repeat(4000),
      consecutive: 2,
    },
  ]);
});

test("volatile notifier: autoDisabled logs only and emits nothing", () => {
  const { lines, emitted, notifier } = volatileOf();
  notifier.autoDisabled("ext:flaky-ext", {
    disable: true,
    rule: "consecutive",
    stats: TWO_FAILURES,
  });
  expect(emitted).toEqual([]);
  expect(lines).toEqual(["auto-disabled: ext:flaky-ext by consecutive"]);
});

test("volatile notifier: a throwing emit is logged and does not reach the caller", () => {
  const { lines, notifier } = volatileOf(true);
  expect(() => notifier.handlerFailed(failed("flaky-ext", "user"), TWO_FAILURES)).not.toThrow();
  expect(lines).toEqual([
    "handler failed: ext:flaky-ext tool.result threw (consecutive 2)",
    "scope.handler_failed not emitted: ext:flaky-ext tool.result (bus down)",
  ]);
});

test("volatile notifier: the disabler emits one payload per failure and one auto-disable line", () => {
  const rec = recorder();
  const { lines, emitted, notifier } = volatileOf();
  const disabler = createAutoDisabler({
    ledger: createFailureLedger({ windowSize: DEFAULT_AUTO_DISABLE.windowSize }),
    policy: () => DEFAULT_AUTO_DISABLE,
    scopes: rec.scopes,
    hooks: { disable: () => {}, enable: () => {} },
    notifier,
  });
  for (let i = 0; i < 5; i += 1) disabler.onOutcome(failed("flaky-ext", "user"));
  expect(emitted.map((payload) => payload.consecutive)).toEqual([1, 2, 3, 4, 5]);
  expect(emitted[0]).toEqual({
    owner: "ext:flaky-ext",
    point: "tool.result",
    result: "threw",
    message: "",
    consecutive: 1,
  });
  expect(rec.requests).toEqual([
    "disable:flaky-ext:auto_disable",
    "disable:flaky-ext/sub:auto_disable",
  ]);
  expect(lines.filter((line) => line.startsWith("auto-disabled:"))).toEqual([
    "auto-disabled: ext:flaky-ext by consecutive",
  ]);
});
