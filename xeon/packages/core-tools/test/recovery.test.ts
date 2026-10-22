import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { NOT_STARTED_TEXT, EffectIntentSchema, EffectResultSchema } from "@xeon/contracts/records";
import type { EffectIntent } from "@xeon/contracts/records";
import type { AgentToolCall } from "@xeon/contracts/conversation";
import type { ToolRunContext } from "@xeon/contracts/services";
import {
  ASSISTANT,
  callTool,
  createHarness,
  installHandlers,
  registerWorkspace,
  textOf,
  type Harness,
  expectOk,
} from "./support/harness.ts";

/** prepare만 돌려 effect.intent를 커밋한다(실행 전 상태) */
async function commitIntentOnly(h: Harness, run: ToolRunContext, id: string, name = "read") {
  const prepared = await h.runtime.tools.prepare(
    { type: "toolCall", id, name, arguments: { path: "a.txt" } },
    ASSISTANT,
    run,
  );
  expect(prepared.kind).toBe("ready");
}

function callOf(id: string, name = "read"): AgentToolCall {
  return { type: "toolCall", id, name, arguments: { path: "a.txt" } };
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

  const record = expectOk(await h.runtime.tools.rerun(intentOf(h, "call_1"), run));
  expect(handlerCalls).toBe(1);
  expect(probe.calls).toEqual([{ method: "read", input: { path: "a.txt" } }]);
  expect(record.isError).toBe(false);
  expect(record.itemId).not.toBeNull();
  expect(record.result.content[0]).toMatchObject({ type: "text", text: "hello" });
  // 결과의 requestId는 처음 실행과 같은 키다
  expect(h.session.commits.map((commit) => commit.requestId)).toEqual([
    "tool:call_1:intent",
    "tool:call_1:exec",
    "tool:call_1:result",
  ]);
});

test("a rerun whose effect state cannot be read is a read failure and runs nothing", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const run = h.run();
  await commitIntentOnly(h, run, "call_rf");
  h.session.failNextRead({ kind: "busy" });
  const result = await h.runtime.tools.rerun(intentOf(h, "call_rf"), run);
  expect(result).toEqual({ ok: false, error: { kind: "busy" } });
  expect(probe.calls).toEqual([]);
  expect(h.session.events.map((event) => event.kind)).toEqual(["effect.intent"]);
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
  const record = expectOk(await h.runtime.tools.rerun(intentOf(h, "call_2"), run));
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

test("settle_rejected_marks_not_executed: calls with an intent get an abandoned result in the same commit as the item", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  await commitIntentOnly(h, run, "call_3");
  await commitIntentOnly(h, run, "call_4");
  const closed = await h.runtime.tools.settleRejected(
    [callOf("call_3"), callOf("call_4"), callOf("call_5")],
    "not_executed",
    run,
  );
  expect(closed.map((outcome) => outcome.state)).toEqual([
    "not_executed",
    "not_executed",
    "not_executed",
  ]);
  expect(closed.every((outcome) => outcome.itemId !== null)).toBe(true);

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
    // 의도가 없던 호출은 효과 이벤트 없이 toolResult item만 기록한다
    ["item.recorded"],
  ]);
  expect(commits.map((commit) => commit.requestId)).toEqual([
    "tool:call_3:result",
    "tool:call_4:result",
    "tool:call_5:result",
  ]);
  expect(JSON.stringify(h.session.events)).toContain(NOT_STARTED_TEXT);
});

test("settleRejected does not close a call twice and returns the first outcome", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  await commitIntentOnly(h, run, "call_6");
  const first = await h.runtime.tools.settleRejected([callOf("call_6")], "not_executed", run);
  const before = h.session.events.length;
  const second = await h.runtime.tools.settleRejected([callOf("call_6")], "not_executed", run);
  expect(h.session.events).toHaveLength(before);
  expect(second[0]?.itemId).toBe(first[0]?.itemId);
});
