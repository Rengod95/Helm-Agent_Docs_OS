import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ModeChangeResult, PermissionMode, ToolService } from "@xeon/contracts/services";
import { toolsPermissionMode } from "../src/ports/permission-mode.ts";
import { fixedIdFactory } from "./support/clock.ts";

const thread: ThreadId = fixedIdFactory(5).next("thr");

interface FakeTools extends Pick<ToolService, "mode" | "setMode"> {
  readonly sets: string[];
}

function fakeTools(
  initial: PermissionMode,
  outcome: (mode: PermissionMode) => ModeChangeResult = (mode) => ({ ok: true, mode }),
): FakeTools {
  let current = initial;
  const sets: string[] = [];
  return {
    sets,
    mode: () => current,
    setMode(_threadId, mode, source) {
      sets.push(`${mode}:${source}`);
      const result = outcome(mode);
      if (result.ok) current = result.mode;
      return Promise.resolve(result);
    },
  };
}

describe("toolsPermissionMode", () => {
  test("enterPlan sets plan as a user change and reports the previous mode", async () => {
    const tools = fakeTools("acceptEdits");
    const port = toolsPermissionMode(tools);
    expect(await port.enterPlan(thread)).toEqual(ok({ previousMode: "acceptEdits" }));
    expect(tools.sets).toEqual(["plan:user"]);
    expect(port.current(thread)).toBe("plan");
  });

  test("enterPlan in plan mode changes nothing", async () => {
    const tools = fakeTools("plan");
    expect(await toolsPermissionMode(tools).enterPlan(thread)).toEqual(ok({ previousMode: null }));
    expect(tools.sets).toEqual([]);
  });

  test("restore returns to the target only from plan mode and passes the source", async () => {
    const tools = fakeTools("plan");
    const port = toolsPermissionMode(tools);
    expect(await port.restore(thread, "default", "plan_approval")).toEqual(ok({ mode: "default" }));
    expect(tools.sets).toEqual(["default:plan_approval"]);
    expect(await port.restore(thread, "acceptEdits", "user")).toEqual(ok({ mode: "default" }));
    expect(tools.sets).toHaveLength(1);
  });

  test("a policy refusal and a failed commit come back as values", async () => {
    const forbidden = fakeTools("default", (mode) => ({
      ok: false,
      error: { kind: "tools.mode_forbidden", mode },
    }));
    expect(await toolsPermissionMode(forbidden).enterPlan(thread)).toEqual(
      err({ kind: "mode_forbidden", mode: "plan" }),
    );
    const broken = fakeTools("plan", () => ({
      ok: false,
      error: { kind: "tools.commit_failed", store: { kind: "busy" } },
    }));
    expect(await toolsPermissionMode(broken).restore(thread, "default", "user")).toEqual(
      err({ kind: "commit_failed", store: { kind: "busy" } }),
    );
  });
});
