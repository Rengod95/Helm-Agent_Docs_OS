import { describe, expect, test } from "bun:test";
import type { Message, Tool } from "@xeon/contracts/conversation";
import { toPiContext, toPiMessage, toPiTool } from "../src/pi-bridge.ts";

const PARAMETERS = { type: "object", properties: {} };

function tool(constrainedSampling?: Tool["constrainedSampling"]): Tool {
  return {
    name: "read",
    description: "Read a file",
    parameters: PARAMETERS,
    ...(constrainedSampling === undefined ? {} : { constrainedSampling }),
  };
}

describe("toPiTool", () => {
  test("a tool without constrained sampling passes unchanged", () => {
    expect(toPiTool(tool())).toMatchObject({
      name: "read",
      description: "Read a file",
      parameters: PARAMETERS,
    });
  });

  test("constrainedSampling false is kept", () => {
    expect(toPiTool(tool(false))).toMatchObject({ constrainedSampling: false });
  });

  test("a grammar config is kept", () => {
    const grammar = { type: "grammar", variants: { openai_lark: "start: /x/" } };
    expect(toPiTool(tool(grammar))).toMatchObject({ constrainedSampling: grammar });
  });

  test("a value that is not a grammar config is dropped, not forwarded", () => {
    const converted = toPiTool(tool({ type: "other" }));
    expect("constrainedSampling" in converted).toBe(false);
  });
});

describe("toPiMessage and toPiContext", () => {
  test("a system message converts the tools it adds", () => {
    const system: Message = {
      role: "system",
      content: "base",
      toolsAdded: [tool({ type: "other" })],
      timestamp: 1,
    };
    const converted = toPiMessage(system);
    expect(converted.role).toBe("system");
    const added = converted.role === "system" ? converted.toolsAdded?.[0] : undefined;
    expect(added).toMatchObject({ name: "read", parameters: PARAMETERS });
    expect(added !== undefined && "constrainedSampling" in added).toBe(false);
  });

  test("other messages pass through as the same object", () => {
    const user: Message = { role: "user", content: "hi", timestamp: 1 };
    expect(toPiMessage(user)).toBe(user);
  });

  test("a context keeps systemPrompt and converts tools", () => {
    const context = toPiContext({
      systemPrompt: "be brief",
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
      tools: [tool(false)],
    });
    expect(context.systemPrompt).toBe("be brief");
    expect(context.tools?.[0]).toMatchObject({ name: "read", constrainedSampling: false });
    expect(context.messages).toHaveLength(1);
  });

  test("a context without systemPrompt or tools does not grow those keys", () => {
    const context = toPiContext({ messages: [] });
    expect(Object.keys(context)).toEqual(["messages"]);
  });
});
