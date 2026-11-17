import { describe, expect, test } from "bun:test";
import {
  anchorOfEvent,
  HOOKS,
  HOOK_NAMES,
  HOOK_POSITIONS,
  isHighFrequency,
  isSubscribableEvent,
  SUBSCRIBABLE_EVENTS,
  checkHookPositions,
  type HookPositionRow,
} from "../../src/extensions/index.ts";

// 스펙 M5e §3.1 표의 46개 이름과 M5e에서 더한 4개(47~50번). 이름 문자열은 바뀌지 않는다(§4.1 규칙). 표 순서가 HOOK_NAMES 순서다.
const CURRENT_46 = [
  "input.user.before",
  "input.bash.before",
  "input.agent.before",
  "request.context.before",
  "request.system.before",
  "request.cache.before",
  "request.provider.before",
  "request.headers.before",
  "request.provider.after",
  "request.stream",
  "request.model.after",
  "request.thinking.after",
  "tool.call.before",
  "tool.result",
  "tool.execution.before",
  "tool.execution.update",
  "tool.execution.after",
  "boundary.turn.before",
  "boundary.step.before",
  "boundary.message.before",
  "boundary.message.update",
  "boundary.message.after",
  "boundary.step.after",
  "boundary.settle.before",
  "boundary.turn.after",
  "boundary.settle.after",
  "thread.trust.before",
  "thread.resources",
  "thread.mcp.after",
  "thread.start",
  "thread.info.after",
  "thread.switch.before",
  "thread.fork.before",
  "thread.compact.before",
  "thread.compact.after",
  "thread.compact.failed",
  "thread.tree.before",
  "thread.tree.after",
  "thread.shutdown",
  "thread.prompt.before",
  "thread.prompt.after",
  "guard.model.before",
  "guard.tool.before",
  "guard.output.before",
  "lifecycle.agent.settled",
  "lifecycle.lease.rejected",
] satisfies readonly string[];

const NEW_4 = [
  "ask.human.before",
  "ask.human.after",
  "agent.spawn.before",
  "agent.spawn.after",
] satisfies readonly string[];

const rows = HOOK_NAMES.map((name) => HOOK_POSITIONS[name]);

function hooksWhere(predicate: (row: HookPositionRow) => boolean): string[] {
  return rows.filter(predicate).map((row) => row.hook);
}

describe("hook positions table", () => {
  test("the 50 hook names: the 46 are unchanged, in spec order, and the four new ones come last", () => {
    const all = [...CURRENT_46, ...NEW_4];
    expect(HOOK_NAMES.map(String)).toEqual(all);
    expect(Object.keys(HOOK_POSITIONS)).toEqual(all);
    expect(HOOK_NAMES).toHaveLength(50);
  });

  test("the four new rows sit at the block ask, the event ask, and the block agents", () => {
    expect(HOOK_POSITIONS["ask.human.before"]).toEqual({
      hook: "ask.human.before",
      positions: [{ kind: "block", block: "ask", side: "before" }],
      powers: ["decide"],
      fired: true,
    });
    expect(HOOK_POSITIONS["ask.human.after"]).toEqual({
      hook: "ask.human.after",
      positions: [{ kind: "event", anchor: { block: "ask", side: "after" } }],
      powers: ["observe"],
      fired: true,
    });
    expect(HOOK_POSITIONS["agent.spawn.before"]).toEqual({
      hook: "agent.spawn.before",
      positions: [{ kind: "block", block: "agents", side: "before" }],
      powers: ["decide"],
      fired: true,
    });
    expect(HOOK_POSITIONS["agent.spawn.after"]).toEqual({
      hook: "agent.spawn.after",
      positions: [{ kind: "block", block: "agents", side: "after" }],
      powers: ["modify"],
      fired: true,
    });
  });

  test("the table passes the validator with no issues", () => {
    expect(checkHookPositions(HOOK_POSITIONS)).toEqual([]);
  });

  test("the validator reports a missing row, an unknown row, and a name mismatch", () => {
    const missing = { ...HOOK_POSITIONS, "thread.start": undefined };
    expect(checkHookPositions(missing)).toEqual([{ hook: "thread.start", rule: "missing_row" }]);

    const unknown = { ...HOOK_POSITIONS, "no.such.hook": HOOK_POSITIONS["thread.start"] };
    expect(checkHookPositions(unknown)).toEqual([{ hook: "no.such.hook", rule: "unknown_row" }]);

    const renamed = {
      ...HOOK_POSITIONS,
      "tool.result": { ...HOOK_POSITIONS["tool.result"], hook: "tool.call.before" as const },
    };
    expect(checkHookPositions(renamed)).toEqual([{ hook: "tool.result", rule: "name_mismatch" }]);
  });

  test("an event position is allowed only on a tap hook", () => {
    const onChain = {
      ...HOOK_POSITIONS,
      "tool.call.before": {
        ...HOOK_POSITIONS["tool.call.before"],
        positions: [{ kind: "event" as const }],
      },
    };
    expect(checkHookPositions(onChain)).toEqual([
      { hook: "tool.call.before", rule: "event_not_tap" },
    ]);
  });

  test("a block position is refused on a tap hook, except thread.start", () => {
    const onTap = {
      ...HOOK_POSITIONS,
      "tool.execution.before": {
        ...HOOK_POSITIONS["tool.execution.before"],
        positions: [{ kind: "block" as const, block: "tools" as const, side: "before" as const }],
      },
    };
    expect(checkHookPositions(onTap)).toEqual([
      { hook: "tool.execution.before", rule: "block_on_tap" },
    ]);
  });

  test("a tap hook has only the observe power, and a fold hook never observes", () => {
    const tapWithDecide = {
      ...HOOK_POSITIONS,
      "request.stream": { ...HOOK_POSITIONS["request.stream"], powers: ["decide" as const] },
    };
    expect(checkHookPositions(tapWithDecide)).toEqual([
      { hook: "request.stream", rule: "tap_powers" },
    ]);

    const foldObserves = {
      ...HOOK_POSITIONS,
      "tool.call.before": { ...HOOK_POSITIONS["tool.call.before"], powers: ["observe" as const] },
    };
    expect(checkHookPositions(foldObserves)).toEqual([
      { hook: "tool.call.before", rule: "fold_powers" },
    ]);
  });

  test("a hook with no position is reported", () => {
    const empty = {
      ...HOOK_POSITIONS,
      "guard.model.before": { ...HOOK_POSITIONS["guard.model.before"], positions: [] },
    };
    expect(checkHookPositions(empty)).toEqual([
      { hook: "guard.model.before", rule: "no_position" },
    ]);
  });

  test("the position kinds split the 50 hooks 21, 24 and 5", () => {
    const blockOrBoundary = hooksWhere((row) =>
      row.positions.some((p) => p.kind === "block" || p.kind === "boundary"),
    );
    const events = hooksWhere((row) => row.positions.some((p) => p.kind === "event"));
    const internal = hooksWhere((row) => row.positions.some((p) => p.kind === "internal"));
    expect(blockOrBoundary).toHaveLength(21);
    expect(events).toHaveLength(24);
    expect(internal).toEqual([
      "request.cache.before",
      "thread.trust.before",
      "thread.switch.before",
      "thread.fork.before",
      "thread.tree.before",
    ]);
    expect(blockOrBoundary.length + events.length + internal.length).toBe(50);
  });

  test("the two internal hooks that nothing fires are the only ones marked not fired", () => {
    expect(hooksWhere((row) => !row.fired)).toEqual([
      "request.cache.before",
      "thread.trust.before",
    ]);
  });

  test("the three high-frequency events are marked", () => {
    expect(hooksWhere((row) => row.highFrequency === true)).toEqual([
      "request.stream",
      "tool.execution.update",
      "boundary.message.update",
    ]);
  });

  test("the 25 tap hooks are exactly the ones with the observe power", () => {
    const tap = HOOK_NAMES.filter((name) => HOOKS[name].fold === "tap");
    expect(tap).toHaveLength(25);
    expect(hooksWhere((row) => row.powers.length === 1 && row.powers[0] === "observe")).toEqual(
      tap,
    );
  });

  test("guard.output.before has its two positions: display after the model, execution before the tools", () => {
    expect(HOOK_POSITIONS["guard.output.before"].positions).toEqual([
      { kind: "block", block: "model", side: "after" },
      { kind: "block", block: "tools", side: "before" },
    ]);
  });

  test("thread.start and thread.resources sit at the conversation start", () => {
    expect(HOOK_POSITIONS["thread.start"]).toEqual({
      hook: "thread.start",
      positions: [{ kind: "boundary", boundary: "conversation-start" }],
      powers: ["observe"],
      fired: true,
    });
    expect(HOOK_POSITIONS["thread.resources"].positions).toEqual([
      { kind: "boundary", boundary: "conversation-start" },
    ]);
    expect(HOOK_POSITIONS["thread.resources"].powers).toEqual(["contribute"]);
  });
});

describe("subscribable events", () => {
  test("the 24 subscribable names are the rows whose position is an event, in table order", () => {
    const derived = HOOK_NAMES.filter((name) =>
      HOOK_POSITIONS[name].positions.some((position) => position.kind === "event"),
    );
    expect(derived).toHaveLength(24);
    const listed: readonly string[] = SUBSCRIBABLE_EVENTS;
    expect(listed).toEqual(derived);
  });

  test("thread.start is not subscribable, and ask.human.after is", () => {
    expect(isSubscribableEvent("thread.start")).toBe(false);
    expect(isSubscribableEvent("ask.human.after")).toBe(true);
    expect(isSubscribableEvent("boundary.message.after")).toBe(false);
  });

  test("the anchor comes from the table, and an event without one has none", () => {
    expect(anchorOfEvent("ask.human.after")).toEqual({ block: "ask", side: "after" });
    expect(anchorOfEvent("tool.execution.update")).toEqual({ block: "tools", side: "after" });
    expect(anchorOfEvent("thread.shutdown")).toBeUndefined();
  });

  test("only the three high-frequency events accept sample coalesce", () => {
    expect(SUBSCRIBABLE_EVENTS.filter((name) => isHighFrequency(name))).toEqual([
      "request.stream",
      "tool.execution.update",
      "boundary.message.update",
    ]);
  });
});
