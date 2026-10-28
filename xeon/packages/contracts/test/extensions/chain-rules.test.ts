import { describe, expect, test } from "bun:test";
import {
  CHAIN_RULES,
  COLLECT_RULES,
  ChainMergeError,
  DurableEventDraftSchema,
  type BoundaryValue,
  type ToolResultValue,
} from "../../src/extensions/index.ts";
import { assistantStop, userText } from "../conversation/fixtures/pi-messages.ts";
import { must, rawId } from "../helpers/ids.ts";

describe('CHAIN_RULES["input.user.before"]', () => {
  test("transform replaces text and keeps images when the patch has none", () => {
    const image = { type: "image" as const, data: "aGk=", mimeType: "image/png" };
    const current = { text: "a", images: [image], handled: false };
    expect(
      CHAIN_RULES["input.user.before"].merge(current, { action: "transform", text: "b" }),
    ).toEqual({
      text: "b",
      images: [image],
      handled: false,
    });
    expect(
      CHAIN_RULES["input.user.before"].merge(
        { text: "a", handled: false },
        { action: "transform", text: "b" },
      ),
    ).toEqual({
      text: "b",
      handled: false,
    });
  });

  test("input handled stops", () => {
    const next = CHAIN_RULES["input.user.before"].merge(
      { text: "a", handled: false },
      { action: "handled" },
    );
    expect(next.handled).toBe(true);
    expect(CHAIN_RULES["input.user.before"].stop?.(next)).toBe(true);
    expect(CHAIN_RULES["input.user.before"].stop?.({ text: "a", handled: false })).toBe(false);
  });
});

describe('CHAIN_RULES["tool.result"]', () => {
  const base: ToolResultValue = {
    content: [{ type: "text", text: "raw" }],
    structuredContent: { rows: 1 },
    details: { a: 1 },
    isError: false,
  };

  test("tool_result content drops structured", () => {
    const next = CHAIN_RULES["tool.result"].merge(base, { content: [{ type: "text", text: "x" }] });
    expect(next.content).toEqual([{ type: "text", text: "x" }]);
    expect("structuredContent" in next).toBe(false);
    expect(next.details).toEqual({ a: 1 });
  });

  test("content with structuredContent keeps both", () => {
    const next = CHAIN_RULES["tool.result"].merge(base, {
      content: [{ type: "text", text: "x" }],
      structuredContent: { rows: 2 },
    });
    expect(next.structuredContent).toEqual({ rows: 2 });
  });

  test("other fields are replaced one by one", () => {
    const next = CHAIN_RULES["tool.result"].merge(base, { isError: true, details: null });
    expect(next.isError).toBe(true);
    expect(next.details).toBeNull();
    expect(next.content).toEqual(base.content);
    expect(next.structuredContent).toEqual({ rows: 1 });
  });

  test("an empty patch changes nothing", () => {
    expect(CHAIN_RULES["tool.result"].merge(base, {})).toEqual(base);
  });
});

describe('CHAIN_RULES["request.cache.before"]', () => {
  test("cache warming last defined", () => {
    const rule = CHAIN_RULES["request.cache.before"];
    const one = rule.merge({ action: "warm" }, { action: "stop" });
    const two = rule.merge(one, { action: "warm" });
    expect(one.action).toBe("stop");
    expect(two.action).toBe("warm");
    expect(rule.merge({ action: "warm" }, {}).action).toBe("warm");
  });
});

describe("CHAIN_RULES boundary", () => {
  const entry = must(DurableEventDraftSchema, {
    id: rawId("evt", 1),
    kind: "x.acme-notes.note.synced",
    version: 1,
    threadId: rawId("thr", 1),
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload: {},
    durable: true,
  });

  test("boundary replace", () => {
    const current: BoundaryValue = { entries: [], continue: false };
    const withEntries = CHAIN_RULES["boundary.step.after"].merge(current, { entries: [entry] });
    expect(withEntries.entries).toHaveLength(1);
    expect(withEntries.continue).toBe(false);
    const replaced = CHAIN_RULES["boundary.step.after"].merge(withEntries, {
      entries: [],
      continue: true,
    });
    expect(replaced).toEqual({ entries: [], continue: true });
    // continue를 생략하면 유지된다
    expect(CHAIN_RULES["boundary.settle.before"].merge(replaced, {}).continue).toBe(true);
    expect(
      CHAIN_RULES["boundary.settle.before"].merge(replaced, { continue: false }).continue,
    ).toBe(false);
  });
});

describe("CHAIN_RULES message end", () => {
  test("replaces a message with the same role", () => {
    const replacement = { ...assistantStop, content: [{ type: "text" as const, text: "edited" }] };
    expect(
      CHAIN_RULES["boundary.message.after"].merge(
        { message: assistantStop },
        { message: replacement },
      ),
    ).toEqual({
      message: replacement,
    });
  });

  test("message end role mismatch rejected", () => {
    expect(() =>
      CHAIN_RULES["boundary.message.after"].merge(
        { message: assistantStop },
        { message: userText },
      ),
    ).toThrow(ChainMergeError);
  });
});

describe('CHAIN_RULES["request.headers.before"]', () => {
  test("headers null deletes", () => {
    const next = CHAIN_RULES["request.headers.before"].merge(
      { headers: { authorization: "[secret]", "x-keep": "1", "x-old": "a" } },
      { set: { "x-old": "b", "x-new": "c", authorization: null } },
    );
    expect(next.headers).toEqual({ "x-keep": "1", "x-old": "b", "x-new": "c" });
  });
});

describe("COLLECT_RULES", () => {
  test("input.agent.before accumulates messages and the last system prompt wins", () => {
    const rule = COLLECT_RULES["input.agent.before"];
    const merged = rule.merge({ messages: [], systemPrompt: "base" }, [
      { message: { customType: "grp.helm.hint.added", content: "a", display: true } },
      { systemPrompt: "first" },
      { message: { customType: "grp.helm.hint.added", content: "b", display: false } },
      {},
      { systemPrompt: "last" },
    ]);
    expect(merged.messages.map((m) => m.content)).toEqual(["a", "b"]);
    expect(merged.systemPrompt).toBe("last");
  });

  test("input.agent.before without contributions returns the initial value", () => {
    const initial = { messages: [], systemPrompt: "base" };
    expect(COLLECT_RULES["input.agent.before"].merge(initial, [])).toEqual(initial);
  });

  test("session.resources appends paths in registration order", () => {
    const merged = COLLECT_RULES["session.resources"].merge(
      { skillPaths: ["/a"], promptPaths: [], themePaths: [] },
      [{ skillPaths: ["/b"] }, { promptPaths: ["/p"], themePaths: ["/t"] }, { skillPaths: ["/c"] }],
    );
    expect(merged).toEqual({
      skillPaths: ["/a", "/b", "/c"],
      promptPaths: ["/p"],
      themePaths: ["/t"],
    });
  });
});

describe("CHAIN_RULES replace rules", () => {
  test("context and provider payload are replaced", () => {
    expect(
      CHAIN_RULES["request.context.before"].merge({ messages: [userText] }, { messages: [] }),
    ).toEqual({
      messages: [],
    });
    expect(
      CHAIN_RULES["request.system.before"].merge({ messages: [] }, { messages: [userText] }),
    ).toEqual({
      messages: [userText],
    });
    expect(
      CHAIN_RULES["request.provider.before"].merge({ payload: 1 }, { payload: { a: 2 } }),
    ).toEqual({
      payload: { a: 2 },
    });
  });
});
