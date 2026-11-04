// 확장 메서드 호출과 운영 정책의 연결(X.operations.spec §3.8, §4.2.3, §4.3, §9 31~35). ui 예산, 대기 제외, 장부, 자동 끄기를 확인한다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import { hostOf, type ExtMethodCallInput } from "../../src/primitives/index.ts";
import { flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

function declOf(
  verb: string,
  params: Readonly<Record<string, unknown>> = {},
  result: Readonly<Record<string, unknown>> = {},
): ExtMethodDecl {
  return { verb, params, result, readOnly: true };
}

const modeParams = {
  type: "object",
  properties: { mode: { type: "string" } },
  required: ["mode"],
};
const totalResult = {
  type: "object",
  properties: { total: { type: "number" } },
  required: ["total"],
};
const answerResult = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

/** 취소되지 않는 새 신호를 쓰는 호출 입력 */
function callOf(
  extension: string,
  verb: string,
  params: unknown,
  threadId: ThreadId | null = null,
): ExtMethodCallInput {
  return {
    extension,
    verb,
    params,
    threadId,
    signal: new AbortController().signal,
    caller: "wire",
  };
}

/** 가짜 시계로 ms 뒤에 끝나는 약속 */
function after(timers: { setTimer: (ms: number, fn: () => void) => () => void }, ms: number) {
  return new Promise<void>((resolve) => {
    timers.setTimer(ms, resolve);
  });
}

/** 처리기가 params.mode를 읽는다. 검사를 통과한 뒤에만 쓰므로 빈 문자열은 나오지 않는다 */
function modeOf(params: unknown): string {
  return typeof params === "object" &&
    params !== null &&
    "mode" in params &&
    typeof params.mode === "string"
    ? params.mode
    : "";
}

test("a registered method called through ExtHost.methods.call with a schema-violating result is counted as result_invalid in the ledger", async () => {
  const { t, policy } = await createOperationsHarness();
  policy.admit({ name: "shape-ext", source: "user", trust: "user", essential: false }, "plugin");
  await t.host.install(
    makeUnit({ name: "shape-ext", methods: [declOf("shape", {}, totalResult)] }, (g) => {
      hostOf(g).registerMethod("shape", { handler: () => Promise.resolve({ total: "five" }) });
    }),
  );
  expect(await t.host.methods.call(callOf("shape-ext", "shape", {}))).toEqual({
    kind: "result_invalid",
    issues: [{ path: "/total", message: "must be number" }],
  });
  expect(policy.ledger.stats("ext:shape-ext")).toMatchObject({
    consecutive: 1,
    totalCalls: 1,
    totalFailures: 1,
    windowCalls: 1,
    windowFailures: 1,
    lastFailure: { point: "ext.method", verb: "shape", result: "result_invalid", tier: "user" },
  });
});

test("method ledger: threw, timeout, result_invalid and ok are counted, params_invalid and aborted are not", async () => {
  const { t, policy } = await createOperationsHarness({ settings: { budgets: { ui: 100 } } });
  policy.admit({ name: "seq-ext", source: "user", trust: "user", essential: false }, "plugin");
  await t.host.install(
    makeUnit({ name: "seq-ext", methods: [declOf("run", modeParams, totalResult)] }, (g) => {
      hostOf(g).registerMethod("run", {
        handler: (params) => {
          const mode = modeOf(params);
          if (mode === "boom") return Promise.reject(new Error("boom"));
          if (mode === "slow") return new Promise<unknown>(() => {});
          if (mode === "bad") return Promise.resolve({ total: "x" });
          return Promise.resolve({ total: 1 });
        },
      });
    }),
  );
  const stats = () => policy.ledger.stats("ext:seq-ext");

  expect(await t.host.methods.call(callOf("seq-ext", "run", { mode: "ok" }))).toEqual({
    kind: "ok",
    value: { total: 1 },
  });
  expect(stats()).toMatchObject({ consecutive: 0, totalCalls: 1, totalFailures: 0 });

  expect(await t.host.methods.call(callOf("seq-ext", "run", { mode: "boom" }))).toEqual({
    kind: "threw",
    message: "boom",
  });
  expect(stats()).toMatchObject({
    consecutive: 1,
    totalCalls: 2,
    totalFailures: 1,
    lastFailure: { result: "threw", message: "boom" },
  });

  const slow = t.host.methods.call(callOf("seq-ext", "run", { mode: "slow" }));
  await flushMicrotasks();
  await t.timers.advance(100);
  expect(await slow).toEqual({ kind: "timeout", budgetMs: 100 });
  expect(stats()).toMatchObject({
    consecutive: 2,
    totalCalls: 3,
    totalFailures: 2,
    lastFailure: { result: "timeout", activeMs: 100 },
  });

  expect(await t.host.methods.call(callOf("seq-ext", "run", { mode: "bad" }))).toMatchObject({
    kind: "result_invalid",
  });
  expect(stats()).toMatchObject({ consecutive: 3, totalCalls: 4, totalFailures: 3 });

  // 호출한 쪽의 잘못은 세지 않는다
  expect(await t.host.methods.call(callOf("seq-ext", "run", {}))).toMatchObject({
    kind: "params_invalid",
  });
  expect(stats()).toMatchObject({ consecutive: 3, totalCalls: 4, totalFailures: 3 });

  // 호출한 쪽의 취소도 세지 않는다
  const controller = new AbortController();
  const cut = t.host.methods.call({
    ...callOf("seq-ext", "run", { mode: "slow" }),
    signal: controller.signal,
  });
  await flushMicrotasks();
  controller.abort();
  expect(await cut).toEqual({ kind: "aborted" });
  expect(stats()).toMatchObject({
    consecutive: 3,
    totalCalls: 4,
    totalFailures: 3,
    windowCalls: 4,
  });

  expect(await t.host.methods.call(callOf("seq-ext", "run", { mode: "ok" }))).toEqual({
    kind: "ok",
    value: { total: 1 },
  });
  expect(stats()).toMatchObject({
    consecutive: 0,
    totalCalls: 5,
    totalFailures: 3,
    windowCalls: 5,
    windowFailures: 3,
  });
});

test("method: the default ui budget is 10,000ms, and an overrun is a timeout with that budget", async () => {
  const { t } = await createOperationsHarness();
  await t.host.install(
    makeUnit({ name: "wait-ext", methods: [declOf("wait")] }, (g) => {
      hostOf(g).registerMethod("wait", { handler: () => new Promise<unknown>(() => {}) });
    }),
  );
  const pending = t.host.methods.call(callOf("wait-ext", "wait", {}));
  await flushMicrotasks();
  await t.timers.advance(9_999);
  // 9,999ms에는 아직 예산 안이라 끝나지 않았다
  expect(await Promise.race([pending.then(() => "settled"), Promise.resolve("running")])).toBe(
    "running",
  );
  await t.timers.advance(1);
  expect(await pending).toEqual({ kind: "timeout", budgetMs: 10_000 });
});

test("method: a user wait inside the handler does not consume the ui budget, and the same wait without the wrapper does", async () => {
  const { t } = await createOperationsHarness({ settings: { budgets: { ui: 100 } } });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  await t.host.install(
    makeUnit(
      {
        name: "ask-ext",
        methods: [declOf("ask", {}, answerResult), declOf("plain", {}, answerResult)],
      },
      (g) => {
        hostOf(g).registerMethod("ask", {
          handler: async () => {
            await hostOf(g).awaitUser(() => after(t.timers, 500));
            return { answer: "yes" };
          },
        });
        hostOf(g).registerMethod("plain", {
          handler: async () => {
            await after(t.timers, 500);
            return { answer: "late" };
          },
        });
      },
    ),
  );
  // 대기 500ms는 예산 100ms에서 빠지므로 처리기 활성 시간은 0이다
  const asking = t.host.methods.call(callOf("ask-ext", "ask", {}, thread));
  await flushMicrotasks();
  await t.timers.advance(500);
  expect(await asking).toEqual({ kind: "ok", value: { answer: "yes" } });

  // 같은 500ms를 감싸지 않으면 예산 100ms를 넘는다
  const plain = t.host.methods.call(callOf("ask-ext", "plain", {}, thread));
  await flushMicrotasks();
  await t.timers.advance(100);
  expect(await plain).toEqual({ kind: "timeout", budgetMs: 100 });
});

test("method: consecutive method failures auto-disable the extension, and params_invalid calls in between do not count", async () => {
  const harness = await createOperationsHarness({ settings: { autoDisable: { consecutive: 2 } } });
  const { t, policy } = harness;
  policy.admit({ name: "crash-ext", source: "user", trust: "user", essential: false }, "plugin");
  await t.host.install(
    makeUnit({ name: "crash-ext", methods: [declOf("crash", modeParams)] }, (g) => {
      hostOf(g).registerMethod("crash", { handler: () => Promise.reject(new Error("crash")) });
    }),
  );
  expect(await t.host.methods.call(callOf("crash-ext", "crash", { mode: "a" }))).toEqual({
    kind: "threw",
    message: "crash",
  });
  expect(harness.requests).toEqual([]);
  expect(await t.host.methods.call(callOf("crash-ext", "crash", {}))).toMatchObject({
    kind: "params_invalid",
  });
  expect(harness.requests).toEqual([]);
  expect(await t.host.methods.call(callOf("crash-ext", "crash", { mode: "b" }))).toEqual({
    kind: "threw",
    message: "crash",
  });
  expect(harness.requests).toEqual([]);
  expect(policy.autoDisabler.questions().map((q) => q.key)).toEqual(["ext:crash-ext"]);
  policy.autoDisabler.answer("ext:crash-ext", true);
  expect(harness.requests).toEqual(["disable:crash-ext:auto_disable"]);
  expect(harness.notices).toContain("auto-disabled:ext:crash-ext:consecutive");
  expect(policy.autoDisabler.disabled()).toEqual(["ext:crash-ext"]);
});

test("method: an essential extension is reported on each method failure and keeps running", async () => {
  const harness = await createOperationsHarness({ settings: { autoDisable: { consecutive: 2 } } });
  const { t, policy } = harness;
  policy.admit({ name: "core-calc", source: "builtin", trust: "builtin", essential: true }, "L2");
  await t.host.install(
    makeUnit({ name: "core-calc", layer: "L2", methods: [declOf("crash")] }, (g) => {
      hostOf(g).registerMethod("crash", { handler: () => Promise.reject(new Error("crash")) });
    }),
  );
  const calls = [0, 1, 2].map(() => t.host.methods.call(callOf("core-calc", "crash", {})));
  expect(await Promise.all(calls)).toEqual([
    { kind: "threw", message: "crash" },
    { kind: "threw", message: "crash" },
    { kind: "threw", message: "crash" },
  ]);
  expect(harness.requests).toEqual([]);
  expect(policy.autoDisabler.disabled()).toEqual([]);
  expect(harness.notices.filter((notice) => notice.startsWith("failed:"))).toHaveLength(3);
});
