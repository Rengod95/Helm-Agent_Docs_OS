import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { NOT_STARTED_TEXT, EffectIntentSchema, EffectResultSchema } from "@xeon/contracts/records";
import type { EffectIntent } from "@xeon/contracts/records";
import type { ToolRunContext } from "@xeon/contracts/services";
import {
  ASSISTANT,
  callTool,
  createHarness,
  installHandlers,
  registerWorkspace,
  textOf,
  type Harness,
} from "./support/harness.ts";

/** before 훅만 돌려 effect.intent를 커밋한다(실행 전 상태) */
async function commitIntentOnly(h: Harness, run: ToolRunContext, id: string, name = "read") {
  const tools = h.runtime.tools.toAgentTools(
    await h.runtime.tools.advertise({ run, activated: new Set() }),
    run,
  );
  const before = await h.runtime.tools.hooks(run).beforeToolCall(
    {
      assistantMessage: ASSISTANT,
      toolCall: { type: "toolCall", id, name, arguments: {} },
      args: { path: "a.txt" },
      context: { messages: [], tools: [...tools] },
    },
    run.signal,
  );
  expect(before).toBeUndefined();
}

function intentOf(h: Harness, toolCallId: string): EffectIntent {
  for (const event of h.session.events) {
    if (event.kind !== "effect.intent") continue;
    const parsed = parse(EffectIntentSchema, event.payload);
    if (parsed.ok && parsed.value.toolCallId === toolCallId) return parsed.value;
  }
  throw new Error(`no intent for ${toolCallId}`);
}

test("rerun_skips_tool_call_hook: stored args run again without the tool_call handler or policy", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  let handlerCalls = 0;
  await installHandlers(h, "counter", ["tool_call"], (g) => {
    g.on("tool_call", () => {
      handlerCalls += 1;
      return undefined;
    });
  });
  const run = h.run();
  await commitIntentOnly(h, run, "call_1");
  expect(handlerCalls).toBe(1);

  const record = await h.runtime.tools.rerun(intentOf(h, "call_1"), run);
  expect(handlerCalls).toBe(1);
  expect(probe.calls).toEqual([{ method: "read", input: { path: "a.txt" } }]);
  expect(record.isError).toBe(false);
  expect(record.content[0]).toMatchObject({ type: "text", text: "hello" });
  // 결과의 requestId는 처음 실행과 같은 키다
  expect(h.session.commits.map((commit) => commit.requestId)).toEqual([
    "tool:call_1:intent",
    "tool:call_1:exec",
    "tool:call_1:result",
  ]);
});

test("a rerun after an unrecorded result commits exec with the attempt number", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const run = h.run();
  h.session.setFault((request) =>
    request.requestId.endsWith(":result") ? { kind: "disk_full" } : undefined,
  );
  const first = await callTool(h.runtime.tools, run, {
    id: "call_2",
    name: "read",
    args: { path: "a.txt" },
  });
  // 결과를 커밋하지 못하면 run을 멈추고 오류로 알린다(L1.tools.spec §5 사례 7)
  expect(first.isError).toBe(true);
  expect(first.result?.terminate).toBe(true);
  expect(textOf(first.result)).toContain("tools.commit_failed");
  expect(h.session.events.map((event) => event.kind)).toEqual(["effect.intent", "effect.exec"]);

  h.session.setFault(undefined);
  const record = await h.runtime.tools.rerun(intentOf(h, "call_2"), run);
  expect(record.isError).toBe(false);
  expect(probe.calls).toHaveLength(2);
  expect(h.session.commits.map((commit) => commit.requestId)).toEqual([
    "tool:call_2:intent",
    "tool:call_2:exec",
    "tool:call_2:exec:1",
    "tool:call_2:result",
  ]);
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok && result.value.status).toBe("ok");
});

test("close_unexecuted_marks_not_executed: calls with an intent get an abandoned result in the same commit as the item", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  await commitIntentOnly(h, run, "call_3");
  await commitIntentOnly(h, run, "call_4");
  await h.runtime.tools.closeUnexecuted(run, ["call_3", "call_4", "call_5"]);

  const results = h.session.events.filter((event) => event.kind === "effect.result");
  expect(results).toHaveLength(2);
  for (const event of results) {
    const parsed = parse(EffectResultSchema, event.payload);
    expect(parsed.ok && parsed.value.status).toBe("abandoned");
    expect(parsed.ok && parsed.value.resultItemId).not.toBeNull();
  }
  const commits = h.session.commits.filter((commit) => commit.requestId.endsWith(":result"));
  expect(commits.map((commit) => commit.kinds)).toEqual([
    ["effect.result", "item.recorded"],
    ["effect.result", "item.recorded"],
  ]);
  expect(JSON.stringify(h.session.events)).toContain(NOT_STARTED_TEXT);
  expect(h.runtime.tools.settledItem("call_3")).toBeDefined();
  expect(h.runtime.tools.settledItem("call_4")).toBeDefined();
  // 의도가 없던 호출은 효과 이벤트가 없다(toolResult item은 루프가 기록한다)
  expect(h.runtime.tools.settledItem("call_5")).toBeUndefined();
  expect(h.session.commits.some((commit) => commit.requestId.includes("call_5"))).toBe(false);
});

test("closeUnexecuted does not close a call twice", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  await commitIntentOnly(h, run, "call_6");
  await h.runtime.tools.closeUnexecuted(run, ["call_6"]);
  const before = h.session.events.length;
  await h.runtime.tools.closeUnexecuted(run, ["call_6"]);
  expect(h.session.events).toHaveLength(before);
});
