import { expect, test } from "bun:test";
import type { ToolResourceDef } from "@xeon/contracts/extensions";
import type { PolicyCeiling, ToolRunContext } from "@xeon/contracts/services";
import { Type } from "typebox";
import { callTool, createHarness, expectOk, type Harness } from "./support/harness.ts";

// M3-REQ-78: 확장 도구가 선언한 risk가 승인 결정에 쓰이고, 자식 대화의 allow·deny 거부에 힌트가 붙는다.

function resource(name: string, extra: Partial<ToolResourceDef>, ran: string[]): ToolResourceDef {
  return {
    name,
    description: name,
    parameters: Type.Object({}),
    replay: "safe",
    execute: () => {
      ran.push(name);
      return Promise.resolve("done");
    },
    ...extra,
  };
}

/** 사람이 없는 백그라운드 위임 자식의 실행 맥락 */
function forkRun(h: Harness, ceiling: PolicyCeiling): ToolRunContext {
  return {
    ...h.run({ interactive: false }),
    surfaceThreadId: h.thread,
    caller: "subagent:review",
    depth: 1,
    ceiling,
  };
}

const PARENT: PolicyCeiling = { caller: "main", depth: 0, mode: "default" };

test("a builtin extension tool declared read runs in an unattended delegate without an approval", async () => {
  const h = await createHarness();
  const ran: string[] = [];
  expectOk(
    h.runtime.tools.register("learning/main", resource("learning_propose", { risk: "read" }, ran)),
  );
  expect(h.runtime.tools.meta("learning_propose")?.risk).toBe("read");
  const out = await callTool(h.runtime.tools, forkRun(h, PARENT), {
    id: "d1",
    name: "learning_propose",
    args: {},
  });
  expect(out.blocked).toBeUndefined();
  expect(ran).toEqual(["learning_propose"]);
  expect(h.session.events.some((event) => event.kind === "approval.requested")).toBe(false);
});

test("the same tool without the declaration is exec and still needs approval", async () => {
  const h = await createHarness();
  const ran: string[] = [];
  expectOk(h.runtime.tools.register("learning/main", resource("learning_propose", {}, ran)));
  expect(h.runtime.tools.meta("learning_propose")?.risk).toBe("exec");
  const out = await callTool(h.runtime.tools, forkRun(h, PARENT), {
    id: "d2",
    name: "learning_propose",
    args: {},
  });
  expect(out.blocked).toContain("noninteractive_ask_denied");
  expect(ran).toEqual([]);
});

test("hints.readOnly derives the read risk when no risk is declared", async () => {
  const h = await createHarness();
  expectOk(
    h.runtime.tools.register(
      "learning/main",
      resource("peek_x", { hints: { readOnly: true } }, []),
    ),
  );
  expect(h.runtime.tools.meta("peek_x")?.risk).toBe("read");
  expect(h.runtime.tools.meta("peek_x")?.hints).toEqual({ readOnly: true });
});

test("a tool outside the fork allow list is denied with the deny hint, and deny globs reject too", async () => {
  const h = await createHarness();
  const ran: string[] = [];
  expectOk(
    h.runtime.tools.register("learning/main", resource("learning_propose", { risk: "read" }, ran)),
  );
  expectOk(h.runtime.tools.register("other/main", resource("other_read", { risk: "read" }, ran)));
  const ceiling: PolicyCeiling = {
    ...PARENT,
    allow: ["learning_propose", "other_*"],
    deny: ["other_*"],
    denyHint: "Only learning_propose is available in this review.",
  };
  const outside = await callTool(h.runtime.tools, forkRun(h, { ...ceiling, allow: ["x"] }), {
    id: "d3",
    name: "learning_propose",
    args: {},
  });
  expect(outside.blocked).toContain("not in the tool list of this subagent definition");
  expect(outside.blocked?.endsWith("Only learning_propose is available in this review.")).toBe(
    true,
  );
  const denied = await callTool(h.runtime.tools, forkRun(h, ceiling), {
    id: "d4",
    name: "other_read",
    args: {},
  });
  expect(denied.blocked).toContain("is denied for this subagent");
  expect(denied.blocked?.endsWith("Only learning_propose is available in this review.")).toBe(true);
  const allowed = await callTool(h.runtime.tools, forkRun(h, ceiling), {
    id: "d5",
    name: "learning_propose",
    args: {},
  });
  expect(allowed.blocked).toBeUndefined();
  expect(ran).toEqual(["learning_propose"]);
});
