import { expect, test } from "bun:test";
import { buildCatalog } from "@xeon/contracts/settings";
import {
  createStaticOperationsSettings,
  DEFAULT_AUTO_DISABLE,
  DEFAULT_BUDGETS_MS,
  operationsSettings,
} from "../../src/operations/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

test("settings: x.operations keys pass catalog", () => {
  const defs = Object.values(operationsSettings.defs);
  const catalog = buildCatalog([{ owner: "ext-host", namespace: "x.operations", defs }]);
  expect(catalog.ok).toBe(true);
  expect(defs).toHaveLength(11);
  for (const def of defs) {
    expect(def.layer).toBe("X");
    // 저장소에 든 설정이 예산·자동 끄기를 바꾸지 못한다
    expect(def.allowedScopes).not.toContain("project");
    expect(def.secret).toBeUndefined();
  }
  expect(operationsSettings.defs["budget.setupMs"].runtimeChange).toBe("restart");
  expect(operationsSettings.defs["budget.setupMs"].allowedScopes).not.toContain("session");
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
    makeUnit({ name: "pol-essential", points: ["boundary.settle.after"], layer: "L2" }, (g) => {
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
    makeUnit({ name: "pol-slow", points: ["tool.call.before"] }, () => new Promise<void>(() => {})),
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
    makeUnit({ name: "pol-tap", points: ["boundary.settle.after"] }, (g) => {
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
    makeUnit({ name: "pol-fine", points: ["boundary.settle.after"], loadIndex: 1 }, (g) => {
      g.on("boundary.settle.after", () => {});
    }),
  );
  expect(second.setups[0]?.status).toBe("applied");
  t.host.scope("pol-tap")?.disable();
  await t.settled();
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k2" },
  );
  expect(policy.ledger.stats("ext:pol-fine")).toMatchObject({ consecutive: 0, totalCalls: 1 });
});
