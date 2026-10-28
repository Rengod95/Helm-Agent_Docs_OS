import { expect, test } from "bun:test";
import type { PolicyRule } from "@xeon/contracts/services";
import {
  callTool,
  createHarness,
  directTool,
  expectOk,
  registerWorkspace,
  type Harness,
} from "./support/harness.ts";

// L1A.2: registerRules(default 티어 규칙 등록)와 권한 모드 4종의 파이프라인 적용(TL-3, TL-4)

function deny(id: string, tool: string): PolicyRule {
  return { id, action: "tool.call", resource: { tool }, effect: "deny" };
}

function addWriteTool(
  h: Harness,
  name: string,
  risk: "read" | "write" | "exec",
): { calls: number } {
  const probe = { calls: 0 };
  expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "core.test",
      tool: directTool(name, () => {
        probe.calls += 1;
        return Promise.resolve({
          content: [{ type: "text", text: `${name} done` }],
          details: null,
        });
      }),
      policy: { risk },
    }),
  );
  return probe;
}

test("register_rules_replaces_same_source: the second registration replaces the first, issues are returned, dispose removes", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const first = h.runtime.tools.registerRules("core:agents", [deny("agents.no-ls", "ls")]);
  expect(first.issues).toEqual([]);
  const denied = await callTool(h.runtime.tools, h.run(), { id: "r1", name: "ls", args: {} });
  expect(denied.blocked).toContain("denied_by_policy");
  expect(denied.blocked).toContain("agents.no-ls");

  // 같은 source의 두 번째 등록이 첫 집합을 통째로 바꾼다
  const second = h.runtime.tools.registerRules("core:agents", [
    deny("agents.no-read", "read"),
    // 잘못된 정규식 규칙은 적재하지 않고 issues로 돌려준다
    {
      id: "agents.bad",
      action: "tool.call",
      resource: { tool: "ls", args: [{ pointer: "/path", pattern: "(" }] },
      effect: "deny",
    },
  ]);
  expect(second.issues.map((issue) => [issue.ruleId, issue.code])).toEqual([
    ["agents.bad", "pattern_invalid"],
  ]);
  const listed = await callTool(h.runtime.tools, h.run(), { id: "r2", name: "ls", args: {} });
  expect(listed.blocked).toBeUndefined();
  const read = await callTool(h.runtime.tools, h.run(), {
    id: "r3",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(read.blocked).toContain("agents.no-read");

  // 오래된 등록의 dispose는 새 등록을 지우지 않는다. 현재 등록의 dispose는 그 source의 규칙을 뺀다
  first.dispose();
  const stillDenied = await callTool(h.runtime.tools, h.run(), {
    id: "r4",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(stillDenied.blocked).toContain("agents.no-read");
  second.dispose();
  const allowed = await callTool(h.runtime.tools, h.run(), {
    id: "r5",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(allowed.blocked).toBeUndefined();
});

test("registered rules are default-tier: a user rule overrides a registered ask, and other sources are untouched", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.runtime.tools.registerRules("core:a", [
    { id: "a.ask-ls", action: "tool.call", resource: { tool: "ls" }, effect: "ask" },
  ]);
  const other = h.runtime.tools.registerRules("core:b", [deny("b.no-read", "read")]);
  // 비대화형이면 ask는 deny다. 규칙 id는 등록한 규칙이다
  const asked = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "t1",
    name: "ls",
    args: {},
  });
  expect(asked.blocked).toContain("noninteractive_ask_denied");
  other.dispose();
  const read = await callTool(h.runtime.tools, h.run(), {
    id: "t2",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(read.blocked).toBeUndefined();
});

test("a registered global deny removes the tool from advertise with the default tier", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.runtime.tools.registerRules("core:agents", [deny("agents.no-bash", "bash")]);
  const toolset = expectOk(await h.runtime.tools.advertise({ run: h.run(), activated: new Set() }));
  expect(toolset.tools.map((tool) => tool.wire.name)).not.toContain("bash");
  expect(toolset.removed.map((entry) => [entry.ruleId, entry.tier])).toEqual([
    ["agents.no-bash", "default"],
  ]);
});

test("plan_mode_blocks_write_tools: write and exec tools are denied, reads pass, the advertised list is the same as in default mode", async () => {
  const h = await createHarness();
  const writer = addWriteTool(h, "write_file", "write");
  const reader = addWriteTool(h, "peek", "read");
  const before = expectOk(await h.runtime.tools.advertise({ run: h.run(), activated: new Set() }));
  expect(await h.runtime.tools.setMode(h.thread, "plan", "user")).toMatchObject({ ok: true });
  const after = expectOk(await h.runtime.tools.advertise({ run: h.run(), activated: new Set() }));
  expect(after.fingerprint).toBe(before.fingerprint);

  const blocked = await callTool(h.runtime.tools, h.run(), {
    id: "p1",
    name: "write_file",
    args: {},
  });
  expect(blocked.blocked).toContain("denied_by_mode");
  expect(writer.calls).toBe(0);
  const read = await callTool(h.runtime.tools, h.run(), { id: "p2", name: "peek", args: {} });
  expect(read.blocked).toBeUndefined();
  expect(reader.calls).toBe(1);
  // plan에서 빠져나오면 쓰기 도구는 다시 ask다(비대화형이라 deny 문장은 noninteractive)
  await h.runtime.tools.setMode(h.thread, "default", "plan_approval");
  const back = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "p3",
    name: "write_file",
    args: {},
  });
  expect(back.blocked).toContain("noninteractive_ask_denied");
});

test("acceptEdits allows write tools without asking but still asks for exec; bypass allows exec", async () => {
  const h = await createHarness();
  const writer = addWriteTool(h, "write_file", "write");
  const runner = addWriteTool(h, "run_cmd", "exec");
  await h.runtime.tools.setMode(h.thread, "acceptEdits", "user");
  const wrote = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "e1",
    name: "write_file",
    args: {},
  });
  expect(wrote.blocked).toBeUndefined();
  expect(writer.calls).toBe(1);
  const asked = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "e2",
    name: "run_cmd",
    args: {},
  });
  expect(asked.blocked).toContain("noninteractive_ask_denied");
  expect(runner.calls).toBe(0);
  await h.runtime.tools.setMode(h.thread, "bypass", "user");
  const ran = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "e3",
    name: "run_cmd",
    args: {},
  });
  expect(ran.blocked).toBeUndefined();
  expect(runner.calls).toBe(1);
});
