import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PolicyCeiling, ToolRunContext } from "@xeon/contracts/services";
import {
  callTool,
  createHarness,
  directTool,
  expectOk,
  layer,
  until,
  type Harness,
} from "./support/harness.ts";

// L1A.6: 서브에이전트 ceiling(TL-13). 자식 호출은 부모 관점과 정의 제한을 합친 결정과 일반 평가 중 엄격한 쪽이다.

function addTool(
  h: Harness,
  name: string,
  risk: "read" | "write" | "exec" = "read",
): { calls: number } {
  const probe = { calls: 0 };
  expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "ext.child",
      tool: directTool(name, () => {
        probe.calls += 1;
        return Promise.resolve({ content: [{ type: "text", text: `${name} ok` }], details: null });
      }),
      policy: { risk },
    }),
  );
  return probe;
}

function childRun(
  h: Harness,
  ceiling: PolicyCeiling,
  overrides: { interactive?: boolean; threadId?: ThreadId } = {},
): ToolRunContext {
  const base = h.run({ interactive: overrides.interactive ?? true });
  return {
    ...base,
    threadId: overrides.threadId ?? base.threadId,
    surfaceThreadId: h.thread,
    caller: "subagent:worker",
    depth: 1,
    ceiling,
  };
}

const PARENT: PolicyCeiling = { caller: "main", depth: 0, mode: "default" };

test("child_ceiling_uses_stricter_decision: a parent-view deny wins over a child-view allow", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          // 부모(main)에게만 닿는 거부 규칙. 자식 관점에서는 일치하지 않는다
          {
            id: "m.main-no-peek",
            action: "tool.call",
            resource: { tool: "peek", caller: "main" },
            effect: "deny",
          },
        ],
      }),
      layer("user", {
        "l1.tools.rules": [
          { id: "u.allow-peek", action: "tool.call", resource: { tool: "peek" }, effect: "allow" },
        ],
      }),
    ],
  });
  const probe = addTool(h, "peek");
  const blocked = await callTool(h.runtime.tools, childRun(h, PARENT), {
    id: "ch1",
    name: "peek",
    args: {},
  });
  expect(blocked.blocked).toContain("denied_by_policy");
  expect(blocked.blocked).toContain("m.main-no-peek");
  expect(probe.calls).toBe(0);
  // ceiling이 없는 같은 호출은 사용자 규칙으로 허용된다
  const plain = await callTool(
    h.runtime.tools,
    { ...h.run(), caller: "subagent:worker", depth: 1 },
    {
      id: "ch2",
      name: "peek",
      args: {},
    },
  );
  expect(plain.blocked).toBeUndefined();
});

test("a child's ask in a non-interactive run becomes a deny and writes no approval", async () => {
  const h = await createHarness();
  const probe = addTool(h, "writer", "write");
  const out = await callTool(h.runtime.tools, childRun(h, PARENT, { interactive: false }), {
    id: "ch3",
    name: "writer",
    args: {},
  });
  expect(out.blocked).toContain("noninteractive_ask_denied");
  expect(probe.calls).toBe(0);
  expect(h.session.events.some((event) => event.kind === "approval.requested")).toBe(false);
});

test("a tool outside the definition's tool list is denied at execution", async () => {
  const h = await createHarness({
    layers: [
      layer("user", {
        "l1.tools.rules": [
          { id: "u.allow-all", action: "tool.call", resource: { tool: "*" }, effect: "allow" },
        ],
      }),
    ],
  });
  const probe = addTool(h, "outside");
  const inside = addTool(h, "inside");
  const ceiling: PolicyCeiling = { ...PARENT, allow: ["inside", "in*side"] };
  const out = await callTool(h.runtime.tools, childRun(h, ceiling), {
    id: "ch4",
    name: "outside",
    args: {},
  });
  expect(out.blocked).toContain("not in the tool list of this subagent definition");
  expect(probe.calls).toBe(0);
  const ok = await callTool(h.runtime.tools, childRun(h, ceiling), {
    id: "ch5",
    name: "inside",
    args: {},
  });
  expect(ok.blocked).toBeUndefined();
  expect(inside.calls).toBe(1);
});

test("a child's approval is recorded on the surface thread with the child as origin and without a waiting checkpoint", async () => {
  const h = await createHarness();
  const probe = addTool(h, "writer", "write");
  const childThread = h.deps.ids.next("thr");
  const done = callTool(h.runtime.tools, childRun(h, PARENT, { threadId: childThread }), {
    id: "ch7",
    name: "writer",
    args: {},
  });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request).toMatchObject({
    surfaceThreadId: h.thread,
    origin: { threadId: childThread, caller: "subagent:worker", toolCallId: "ch7" },
  });
  const requested = h.session.events.find((event) => event.kind === "approval.requested");
  expect(requested?.threadId).toBe(h.thread);
  // 부모 대화의 이벤트에는 자식 turn의 turnId·stepId를 달지 않고, 대기 체크포인트도 쓰지 않는다
  expect(requested?.turnId).toBeNull();
  expect(h.session.events.some((event) => event.kind === "checkpoint.step")).toBe(false);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  expect((await done).blocked).toBeUndefined();
  expect(probe.calls).toBe(1);
});

test("child_advertise_respects_allow_and_keep_parent_list", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          {
            id: "m.child-no-b",
            action: "tool.call",
            resource: { tool: "tool_b", caller: "subagent" },
            effect: "deny",
          },
          {
            id: "m.main-no-c",
            action: "tool.call",
            resource: { tool: "tool_c", caller: "main" },
            effect: "deny",
          },
        ],
      }),
    ],
  });
  for (const name of ["tool_a", "tool_b", "tool_c", "tool_d"]) addTool(h, name);
  const parentSet = await h.runtime.tools.advertise({ run: h.run(), activated: new Set() });
  expect(parentSet.tools.map((tool) => tool.name)).toContain("tool_b");
  expect(parentSet.tools.map((tool) => tool.name)).not.toContain("tool_c");

  const run = { threadId: h.thread, caller: "subagent:worker" as const, depth: 1, ceiling: PARENT };
  // 자식 관점 deny(tool_b)와 부모 관점 deny(tool_c)가 빠진다
  const child = await h.runtime.tools.advertise({ run, activated: new Set() });
  expect(child.tools.map((tool) => tool.name)).toEqual(["read_tool_output", "tool_a", "tool_d"]);
  expect(child.removed.map((entry) => entry.ruleId).toSorted()).toEqual([
    "m.child-no-b",
    "m.main-no-c",
  ]);
  // allow 밖 도구도 빠진다
  const limited = await h.runtime.tools.advertise({
    run,
    activated: new Set(),
    allow: ["tool_a", "tool_?"],
  });
  expect(limited.tools.map((tool) => tool.name)).toEqual(["tool_a", "tool_d"]);
  const onlyA = await h.runtime.tools.advertise({ run, activated: new Set(), allow: ["tool_a"] });
  expect(onlyA.tools.map((tool) => tool.name)).toEqual(["tool_a"]);
  // keepParentList는 부모 목록과 같고 캐시 접두(fingerprint)도 같다
  const kept = await h.runtime.tools.advertise({
    run,
    activated: new Set(),
    keepParentList: { parent: parentSet },
  });
  expect(kept.tools).toEqual(parentSet.tools);
  expect(kept.fingerprint).toBe(parentSet.fingerprint);
  // 제한은 실행 시점에 건다: 부모 목록에 있는 tool_b를 자식이 부르면 거부된다
  const refused = await callTool(h.runtime.tools, childRun(h, PARENT), {
    id: "ch6",
    name: "tool_b",
    args: {},
  });
  expect(refused.blocked).toContain("m.child-no-b");
});
