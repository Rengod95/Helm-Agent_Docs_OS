import { expect, test } from "bun:test";
import { createHarness, layer } from "./support/harness.ts";

// 감사 l1/A-03: drive·그룹 위임의 자식 생성도 `agent` 도구와 같은 사용자 규칙을 지난다(L1.agents.spec §4.3 생성 검사).

test("checkSpawn denies when a user rule denies the agent tool, and not otherwise", async () => {
  const withRule = await createHarness({
    layers: [
      layer("user", {
        "l1.tools.rules": [
          { id: "u.no-agent", action: "tool.call", resource: { tool: "agent" }, effect: "deny" },
        ],
      }),
    ],
  });
  const input = { threadId: withRule.thread, caller: "main", depth: 0, interactive: true } as const;
  expect(withRule.runtime.tools.checkSpawn(input)).toMatchObject({
    effect: "deny",
    ruleId: "u.no-agent",
    tier: "user",
  });

  const plain = await createHarness();
  expect(
    plain.runtime.tools.checkSpawn({
      threadId: plain.thread,
      caller: "main",
      depth: 0,
      interactive: true,
    }).effect,
  ).not.toBe("deny");
});

test("checkSpawn sees the spawn class: a class rule for subagents at their depth denies", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          {
            id: "m.no-spawn-class",
            action: "tool.call",
            resource: { classes: ["spawn"], caller: "subagent" },
            effect: "deny",
          },
        ],
      }),
    ],
  });
  expect(
    h.runtime.tools.checkSpawn({
      threadId: h.thread,
      caller: "subagent:worker",
      depth: 1,
      interactive: true,
    }).effect,
  ).toBe("deny");
  expect(
    h.runtime.tools.checkSpawn({ threadId: h.thread, caller: "main", depth: 0, interactive: true })
      .effect,
  ).not.toBe("deny");
});
