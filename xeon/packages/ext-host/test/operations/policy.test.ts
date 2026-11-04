import { expect, test } from "bun:test";
import { buildCatalog } from "@fresnel/contracts/settings";
import {
  createOperationsPolicy,
  createStaticOperationsSettings,
  DEFAULT_AUTO_DISABLE,
  DEFAULT_BUDGETS_MS,
  hookOrderOf,
  operationsSettings,
} from "../../src/operations/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { fakeTimers, flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

test("settings: x.operations keys pass catalog", () => {
  const defs = Object.values(operationsSettings.defs);
  const catalog = buildCatalog([{ owner: "ext-host", namespace: "x.operations", defs }]);
  expect(catalog.ok).toBe(true);
  expect(defs).toHaveLength(22);
  // 훅 순서는 저장소 설정이 바꾸지 못한다(managed·user만)
  expect(operationsSettings.defs.hookOrder).toMatchObject({
    key: "x.operations.hookOrder",
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    default: {},
  });
  // 꺼진 외부 훅 id는 재시작 뒤에도 남는다(user 파일). 저장소 설정이 바꾸지 못한다
  expect(operationsSettings.defs.hookDisabled).toMatchObject({
    key: "x.operations.hookDisabled",
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    default: [],
  });
  for (const def of defs) {
    expect(def.layer).toBe("X");
    // 저장소에 든 설정이 예산·자동 끄기를 바꾸지 못한다
    // 예외: 외부 훅 정의는 작업 폴더 설정에도 적는다(신뢰된 폴더에서만 실행, X.operations.spec §4.7.6)
    if (def.key !== "x.operations.hookDefs") expect(def.allowedScopes).not.toContain("project");
    expect(def.secret).toBeUndefined();
  }
  expect(operationsSettings.defs["budget.setupMs"].runtimeChange).toBe("restart");
  expect(operationsSettings.defs["budget.setupMs"].allowedScopes).not.toContain("session");
  // 확장 메서드 예산 키는 훅 예산 키와 같은 범위·갱신 규칙이다(X.operations.spec §6)
  expect(operationsSettings.defs["budget.uiMs"]).toMatchObject({
    runtimeChange: "live",
    range: { min: 100, max: 600_000 },
    default: 10_000,
    allowedScopes: ["managed", "user", "local", "launch"],
  });
});

test("settings: the static source follows the documented defaults and accepts overrides", () => {
  const defaults = createStaticOperationsSettings();
  expect(defaults.budgets()).toEqual(DEFAULT_BUDGETS_MS);
  expect(defaults.autoDisable()).toEqual(DEFAULT_AUTO_DISABLE);
  const custom = createStaticOperationsSettings({
    budgets: { first: 5 },
    autoDisable: { consecutive: 2 },
  });
  expect(custom.budgets().first).toBe(5);
  expect(custom.budgets().chain).toBe(DEFAULT_BUDGETS_MS.chain);
  expect(custom.autoDisable().consecutive).toBe(2);
});

test("policy: admit records the tier and forget clears tables and ledger", async () => {
  const { policy } = await createOperationsHarness();
  expect(
    policy.admit({ name: "pol-user", source: "user", trust: "user", essential: false }, "plugin"),
  ).toEqual({
    ok: true,
    value: "user",
  });
  expect(policy.tiers.get("pol-user")).toBe("user");
  const rejected = policy.admit(
    { name: "pol-bad", source: "project", trust: "untrusted", essential: false },
    "plugin",
  );
  expect(rejected).toEqual({ ok: false, error: { kind: "untrusted", name: "pol-bad" } });
  expect(policy.tiers.get("pol-bad")).toBeUndefined();
  policy.ledger.record({
    owner: { type: "extension", name: "pol-user", scopeId: "pol-user" },
    tier: "user",
    point: "tool.call.before",
    fold: "first",
    failure: "closed",
    result: "threw",
    activeMs: 1,
    at: 1,
  });
  expect(policy.ledger.stats("ext:pol-user").consecutive).toBe(1);
  policy.forget("pol-user");
  expect(policy.tiers.get("pol-user")).toBeUndefined();
  expect(policy.ledger.stats("ext:pol-user").consecutive).toBe(0);
});

test("policy: essential extensions are exempt from auto disable", async () => {
  const harness = await createOperationsHarness({ settings: { autoDisable: { consecutive: 2 } } });
  const { t, policy } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  policy.admit(
    { name: "pol-essential", source: "builtin", trust: "builtin", essential: true },
    "L2",
  );
  await t.host.install(
    makeUnit({ name: "pol-essential", hooks: ["boundary.settle.after"], layer: "L2" }, (g) => {
      g.on("boundary.settle.after", () => {
        throw new Error("always");
      });
    }),
  );
  await eachInOrder(["1", "2", "3", "4"], async (key) => {
    await t.host.dispatch(
      "boundary.settle.after",
      { turnId: t.ids.next("trn"), aborted: false },
      { threadId: thread, dispatchKey: key },
    );
    return "continue";
  });
  expect(harness.requests).toEqual([]);
  expect(harness.notices.filter((notice) => notice.startsWith("failed:"))).toHaveLength(4);
});

test("policy: setup budget comes from x.operations.budget.setupMs", async () => {
  const harness = await createOperationsHarness({ settings: { budgets: { setup: 200 } } });
  const { t, policy } = harness;
  expect(policy.setupBudgetMs()).toBe(200);
  const pending = t.host.install(
    makeUnit({ name: "pol-slow", hooks: ["tool.call.before"] }, () => new Promise<void>(() => {})),
  );
  await flushMicrotasks(200);
  await t.timers.advance(200);
  const outcome = await pending;
  expect(outcome.setups[0]).toMatchObject({ status: "failed", failure: { kind: "timeout" } });
});

test("policy: handlers run through runWithBudget and report settled once", async () => {
  const harness = await createOperationsHarness({ settings: { budgets: { tap: 100 } } });
  const { t, policy } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  policy.admit({ name: "pol-tap", source: "user", trust: "user", essential: false }, "plugin");
  await t.host.install(
    makeUnit({ name: "pol-tap", hooks: ["boundary.settle.after"] }, (g) => {
      g.on("boundary.settle.after", () => new Promise<void>(() => {}));
    }),
  );
  const pending = t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  await flushMicrotasks();
  await t.timers.advance(100);
  const outcome = await pending;
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["timeout"]);
  expect(policy.ledger.stats("ext:pol-tap")).toMatchObject({ consecutive: 1, totalFailures: 1 });
  // 정상 호출은 연속 수를 0으로 돌린다
  const second = await t.host.install(
    makeUnit({ name: "pol-fine", hooks: ["boundary.settle.after"], loadIndex: 1 }, (g) => {
      g.on("boundary.settle.after", () => {});
    }),
  );
  expect(second.setups[0]?.status).toBe("applied");
  t.host.registration("pol-tap")?.disable();
  await t.settled();
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k2" },
  );
  expect(policy.ledger.stats("ext:pol-fine")).toMatchObject({ consecutive: 0, totalCalls: 1 });
});

test("policy: a static hookOrder setting is the handler order of its hook", async () => {
  const harness = await createOperationsHarness({
    settings: { hookOrder: hookOrderOf({ "tool.call.before": ["beta", "alpha"] }) },
  });
  expect(harness.policy.handlerOrder?.("tool.call.before")).toEqual(["beta", "alpha"]);
  expect(harness.policy.handlerOrder?.("tool.result")).toBeUndefined();
});

test("policy: a changed hookOrder setting is pending until the step boundary applies it", () => {
  let saved = hookOrderOf({});
  const timers = fakeTimers();
  const policy = createOperationsPolicy({
    now: timers.now,
    setTimer: timers.setTimer,
    settings: {
      budgets: () => DEFAULT_BUDGETS_MS,
      autoDisable: () => DEFAULT_AUTO_DISABLE,
      hookOrder: () => saved,
    },
    scopes: { requestDisable: () => {}, requestEnable: () => {}, scopesOf: () => [] },
    ports: { get: () => undefined },
  });
  // 만들 때 원천을 한 번 읽어 적용 중인 값으로 삼는다(아직 저장 값이 없다)
  expect(policy.handlerOrder?.("tool.call.before")).toBeUndefined();
  saved = hookOrderOf({ "tool.call.before": ["beta", "alpha"] });
  expect(policy.hookOrder.pending()).toBe(true);
  expect(policy.handlerOrder?.("tool.call.before")).toBeUndefined();
  policy.onStepBoundary?.();
  expect(policy.handlerOrder?.("tool.call.before")).toEqual(["beta", "alpha"]);
  expect(policy.hookOrder.pending()).toBe(false);
});
