import { describe, expect, test } from "bun:test";
import { HOOKS as CONTRACT_HOOKS, HOOK_NAMES } from "@fresnel/contracts/extensions";
import { FIXTURE_ORDER, buildFixture } from "../../../src/workbench/canvas/fixture.ts";
import {
  CORE_STEPS,
  HOOKS,
  OTHER_HOOKS,
  PHASES,
  hookDef,
  hookFold,
  hookOrderMatters,
  hooksInOrder,
} from "../../../src/workbench/canvas/hooks.ts";
import { MOCK, plugin } from "./support.ts";

describe("hook table", () => {
  test("13 visible moments and 33 others cover the 46 contract hooks once each", () => {
    expect(HOOKS.length).toEqual(13);
    expect(OTHER_HOOKS.length).toEqual(33);
    const ids = [...HOOKS, ...OTHER_HOOKS].map((h) => h.id);
    expect(new Set(ids).size).toEqual(46);
    expect(ids.toSorted()).toEqual([...HOOK_NAMES].toSorted());
  });

  test("every hook id and fold matches contracts HOOKS", () => {
    const contract = new Map<string, string>(
      HOOK_NAMES.map((n): [string, string] => [n, CONTRACT_HOOKS[n].fold]),
    );
    const mismatched = [...HOOKS, ...OTHER_HOOKS]
      .filter((h) => contract.get(h.id) !== h.fold)
      .map((h) => h.id);
    expect(mismatched).toEqual([]);
    expect(contract.get("thread.compact.before")).toEqual("first");
  });

  test("phases are the four bands in loop order", () => {
    expect(PHASES).toEqual(["start", "think", "act", "wrap"]);
    expect(HOOKS.map((h) => h.phase)).toEqual([
      "start",
      "start",
      "start",
      "think",
      "think",
      "think",
      "think",
      "act",
      "act",
      "act",
      "wrap",
      "wrap",
      "wrap",
    ]);
  });

  test("the compaction moment is the only builtin one", () => {
    expect(HOOKS.filter((h) => h.builtin === true).map((h) => h.id)).toEqual([
      "thread.compact.before",
    ]);
    expect(hookDef("thread.compact.before")).toEqual({
      id: "thread.compact.before",
      fold: "first",
      phase: "think",
      failure: "open",
      builtin: true,
      orderMatters: true,
    });
  });

  test("hookFold finds the 33 others too, and an unknown hook has no fold", () => {
    expect(hookDef("tool.execution.before")).toEqual(undefined);
    expect(hookFold("tool.execution.before")).toEqual("tap");
    expect(hookFold("thread.trust.before")).toEqual("first");
    expect(hookFold("no.such.hook")).toEqual(undefined);
  });

  test("orderMatters is true for exactly these 15 hooks, over all 46", () => {
    const matters = [...HOOKS, ...OTHER_HOOKS].filter((h) => h.orderMatters).map((h) => h.id);
    expect(matters).toEqual([
      "input.user.before",
      "thread.compact.before",
      "request.provider.before",
      "tool.result",
      "boundary.step.after",
      "input.bash.before",
      "request.context.before",
      "request.system.before",
      "request.cache.before",
      "request.headers.before",
      "boundary.message.after",
      "boundary.settle.before",
      "thread.trust.before",
      "thread.fork.before",
      "thread.tree.before",
    ]);
  });

  test("every chain hook matters, and no tap or collect hook does", () => {
    const all = [...HOOKS, ...OTHER_HOOKS];
    const chain = all.filter((h) => h.fold === "chain");
    expect(chain.length).toEqual(10);
    expect(chain.filter((h) => !h.orderMatters).map((h) => h.id)).toEqual([]);
    const passive = all.filter((h) => h.fold === "tap" || h.fold === "collect");
    expect(passive.filter((h) => h.orderMatters).map((h) => h.id)).toEqual([]);
  });

  test("among first hooks, only those with a value answer matter; block-only ones do not", () => {
    const first = [...HOOKS, ...OTHER_HOOKS].filter((h) => h.fold === "first");
    expect(first.length).toEqual(10);
    // 막음만 담는 지점: ToolCallDecision, GuardDecision, SessionCancelDecision
    expect(first.filter((h) => !h.orderMatters).map((h) => h.id)).toEqual([
      "guard.model.before",
      "tool.call.before",
      "thread.switch.before",
      "guard.tool.before",
      "guard.output.before",
    ]);
  });

  test("hookOrderMatters reads the table and is false for an unknown hook", () => {
    expect(hookOrderMatters("tool.call.before")).toEqual(false);
    expect(hookOrderMatters("thread.trust.before")).toEqual(true);
    expect(hookOrderMatters("tool.execution.before")).toEqual(false);
    expect(hookOrderMatters("no.such.hook")).toEqual(false);
  });

  test("core steps keep their lock and replace flags and point at known hooks", () => {
    expect(CORE_STEPS.map((s) => s.id)).toEqual([
      "core.context.assemble",
      "core.model.call",
      "core.tools.run",
    ]);
    expect(CORE_STEPS.map((s) => s.locked)).toEqual([false, false, true]);
    expect(CORE_STEPS.map((s) => s.replaceable)).toEqual([false, false, false]);
    const known = new Set([...HOOKS, ...OTHER_HOOKS].map((h) => h.id));
    const referenced = [...CORE_STEPS.map((s) => s.after), ...CORE_STEPS.flatMap((s) => s.wrap)];
    expect(referenced.filter((id) => !known.has(id))).toEqual([]);
  });
});

describe("hooksInOrder", () => {
  test("the fixture order gives the mock's lanes", () => {
    const lanes = hooksInOrder(MOCK.plugins, FIXTURE_ORDER);
    expect(lanes["thread.start"]).toEqual(["helm"]);
    expect(lanes["input.agent.before"]).toEqual(["helm", "review/lens"]);
    expect(lanes["tool.call.before"]).toEqual(["secret-scan", "helm"]);
    expect(lanes["tool.execution.after"]).toEqual(["lint-on-edit", "helm"]);
    expect(lanes["boundary.settle.after"]).toEqual(["helm", "learning", "review", "notify-done"]);
    expect(lanes["thread.shutdown"]).toEqual(["learning"]);
    expect(lanes["guard.model.before"]).toEqual([]);
  });

  test("a declared hook the overrides do not name is still in its lane", () => {
    // helm declares lifecycle.lease.rejected, and the mock's own order table leaves it out
    expect(hooksInOrder(MOCK.plugins, FIXTURE_ORDER)["lifecycle.lease.rejected"]).toEqual(["helm"]);
  });

  test("without overrides a lane follows the plugin list", () => {
    expect(hooksInOrder(MOCK.plugins, {})["tool.call.before"]).toEqual(["helm", "secret-scan"]);
  });

  test("an override only seats plugins that declare the hook, the rest follow in list order", () => {
    const lanes = hooksInOrder(MOCK.plugins, {
      "thread.start": ["notify-done", "helm", "helm"],
      "boundary.settle.after": ["notify-done"],
    });
    expect(lanes["thread.start"]).toEqual(["helm"]);
    expect(lanes["boundary.settle.after"]).toEqual(["notify-done", "helm", "learning", "review"]);
  });

  test("every lane member declares its hook, on a 77 fixture", () => {
    const big = buildFixture(77);
    const lanes = hooksInOrder(big.plugins, FIXTURE_ORDER);
    const stray = Object.entries(lanes).flatMap(([h, ids]) =>
      ids.filter((id) => !plugin(big, id).hooks.includes(h)).map((id) => `${h}:${id}`),
    );
    expect(stray).toEqual([]);
  });
});
