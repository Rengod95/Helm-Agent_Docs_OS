import { describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { AGENT_TOOL_NAME } from "../src/index.ts";
import { agentToolRegistration } from "../src/tool.ts";
import { openHarness } from "./support/harness.ts";

describe("the agent tool", () => {
  test("it is registered as a direct tool of the spawn class with replay safe", () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks);
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
    const registration = agentToolRegistration(h.service, h.tasks);
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

  test("errors come back as isError results; no task scope and background are refused", async () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks);
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
    const background = await registration.tool.execute(
      "tc-1",
      { agent: "explorer", task: "t", background: true },
      new AbortController().signal,
      () => {},
    );
    expect(background.isError).toBe(true);
  });

  test("the parameter schema requires agent and task", () => {
    const h = openHarness();
    const registration = agentToolRegistration(h.service, h.tasks);
    expect(parse(registration.tool.parameters, { agent: "x", task: "y" }).ok).toBe(true);
    expect(parse(registration.tool.parameters, { agent: "x" }).ok).toBe(false);
    expect(parse(registration.tool.parameters, { agent: "x", task: "y", extra: 1 }).ok).toBe(false);
  });
});
