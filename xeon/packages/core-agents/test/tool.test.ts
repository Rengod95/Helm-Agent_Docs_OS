import { describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { AGENT_TOOL_NAME } from "../src/index.ts";
import { spawnRecorder } from "../src/testing/index.ts";
import { agentToolRegistration } from "../src/tool.ts";
import { openHarness } from "./support/harness.ts";

describe("the agent tool", () => {
  test("it waits for the child inside suspendWhile so the tools slot is not held meanwhile", async () => {
    let suspendedDuringChild = -1;
    const holder: { tools?: ReturnType<typeof openHarness>["tools"] } = {};
    const h = openHarness({
      run: (request, session) => {
        suspendedDuringChild = holder.tools?.suspended() ?? -1;
        const finalItemId = session.seedAssistantItem(request.threadId, "found it");
        return Promise.resolve({ status: "completed", finalItemId });
      },
    });
    holder.tools = h.tools;
    const registration = agentToolRegistration(h.service, h.tasks, h.tools);
    h.openToolCall("tc-slot");
    const result = await registration.tool.execute(
      "tc-slot",
      { agent: "explorer", task: "look" },
      new AbortController().signal,
      () => {},
    );
    expect(result.isError).toBe(false);
    expect(suspendedDuringChild).toBe(1);
    expect(h.tools.suspensions).toEqual([{ threadId: h.parentThreadId, toolCallId: "tc-slot" }]);
    expect(h.tools.suspended()).toBe(0);
  });

  test("it is registered as a direct tool of the spawn class with replay safe", () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks, h.tools);
    expect(registration).toMatchObject({
      kind: "direct",
      orderKey: "core.agents",
      policy: { risk: "exec", classes: ["spawn"] },
    });
    expect(registration.tool.name).toBe(AGENT_TOOL_NAME);
    expect(registration.tool.replay).toBe("safe");
  });

  test("execute finds the parent thread through the task tree and returns the guarded report", async () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks, h.tools);
    h.openToolCall("tc-9");
    const result = await registration.tool.execute(
      "tc-9",
      { agent: "explorer", task: "look" },
      new AbortController().signal,
      () => {},
    );
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("<subagent_report");
    expect(result.details).toMatchObject({
      status: "completed",
      truncated: false,
      flags: [],
      reused: false,
    });
    // 같은 도구 호출을 다시 실행하면(replay safe) 기존 자식을 돌려받는다
    const again = await registration.tool.execute(
      "tc-9",
      { agent: "explorer", task: "look" },
      new AbortController().signal,
      () => {},
    );
    expect(again.details).toMatchObject({ reused: true });
    expect(h.loop.calls).toHaveLength(1);
  });

  test("errors come back as isError results; no task scope is refused", async () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks, h.tools);
    h.openToolCall("tc-1");
    const unknown = await registration.tool.execute(
      "tc-1",
      { agent: "ghost", task: "t" },
      new AbortController().signal,
      () => {},
    );
    expect(unknown.isError).toBe(true);
    const text = unknown.content[0]?.type === "text" ? unknown.content[0].text : "";
    expect(text).toContain("agents.unknown_definition");
    const orphan = await registration.tool.execute(
      "no-such-call",
      { agent: "explorer", task: "t" },
      new AbortController().signal,
      () => {},
    );
    expect(orphan.isError).toBe(true);
  });

  test("a background call delegates, returns an acceptance and queues the report as agent.report", async () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks, h.tools);
    h.openToolCall("tc-bg");
    const recorder = spawnRecorder(h.session);
    const result = await registration.tool.execute(
      "tc-bg",
      { agent: "explorer", task: "dig", background: true },
      new AbortController().signal,
      () => {},
    );
    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({ status: "accepted" });
    await recorder.settleAll(h.parentThreadId, ["tool:tc-bg:spawn:0"]);
    recorder.dispose();
    const queued = h.session.events.find((event) => event.kind === "input.queued");
    expect(queued?.payload).toMatchObject({
      mode: "followUp",
      item: { kind: "context", display: true },
    });
  });

  test("the parameter schema requires agent and task", () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks, h.tools);
    expect(parse(registration.tool.parameters, { agent: "x", task: "y" }).ok).toBe(true);
    expect(parse(registration.tool.parameters, { agent: "x" }).ok).toBe(false);
    expect(parse(registration.tool.parameters, { agent: "x", task: "y", extra: 1 }).ok).toBe(false);
  });
});
