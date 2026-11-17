import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  AGENT_REPORT_TEXT_MAX,
  AgentSpawnAfterPatchSchema,
  AgentSpawnBeforeDecisionSchema,
  AskHumanBeforeDecisionSchema,
  CHAIN_RULES,
  FIRST_RANK,
  ToolCallDecisionSchema,
  decisionKindOf,
} from "../../src/extensions/index.ts";

// M5e 스펙 §4.2(묻기, 결과 대신 주기), §4.3(사람에게 묻기, 서브에이전트)의 결정 모양과 합치기 순위.

describe("tool.call.before decision union (§4.2)", () => {
  test("block, ask and replace are each accepted", () => {
    expect(parse(ToolCallDecisionSchema, { block: true, reason: "no" }).ok).toBe(true);
    expect(parse(ToolCallDecisionSchema, { block: true, reason: "no", terminate: true }).ok).toBe(
      true,
    );
    expect(parse(ToolCallDecisionSchema, { ask: true, reason: "confirm the write" }).ok).toBe(true);
    expect(
      parse(ToolCallDecisionSchema, {
        replace: { content: [{ type: "text", text: "cached" }], isError: false },
        reason: "answered from cache",
      }).ok,
    ).toBe(true);
  });

  test("a value that mixes two forms, or lacks its reason, is refused", () => {
    expect(parse(ToolCallDecisionSchema, { block: true, ask: true, reason: "x" }).ok).toBe(false);
    expect(parse(ToolCallDecisionSchema, { ask: false, reason: "x" }).ok).toBe(false);
    expect(parse(ToolCallDecisionSchema, { ask: true }).ok).toBe(false);
    expect(parse(ToolCallDecisionSchema, { replace: { content: [] } }).ok).toBe(false);
  });

  test("decisionKindOf reads the form of each decision and gives null for the rest", () => {
    expect(decisionKindOf({ block: true, reason: "no" })).toEqual("block");
    expect(decisionKindOf({ ask: true, reason: "confirm" })).toEqual("ask");
    expect(decisionKindOf({ replace: { content: [] }, reason: "r" })).toEqual("replace");
    expect(decisionKindOf(undefined)).toEqual(null);
    expect(decisionKindOf("block")).toEqual(null);
    expect(decisionKindOf({ ask: false, reason: "x" })).toEqual(null);
  });

  test("the rank of the two merged hooks is block, replace, ask, and no other hook is ranked", () => {
    expect(FIRST_RANK).toEqual({
      "tool.call.before": ["block", "replace", "ask"],
      "agent.spawn.before": ["block", "replace", "ask"],
    });
  });
});

describe("ask.human.before decision (§4.3.1)", () => {
  test("cancel and answer are each accepted, with the reason", () => {
    expect(parse(AskHumanBeforeDecisionSchema, { cancel: true, reason: "not now" }).ok).toBe(true);
    expect(
      parse(AskHumanBeforeDecisionSchema, {
        answer: { q1: { selected: ["yes"] } },
        reason: "already known",
      }).ok,
    ).toBe(true);
  });

  test("a decision with no reason, or with both forms, is refused", () => {
    expect(parse(AskHumanBeforeDecisionSchema, { cancel: true }).ok).toBe(false);
    expect(
      parse(AskHumanBeforeDecisionSchema, {
        cancel: true,
        answer: { q1: { selected: [] } },
        reason: "x",
      }).ok,
    ).toBe(false);
  });
});

describe("agent.spawn.before decision (§4.3.3)", () => {
  test("block, ask and replace with a report are accepted", () => {
    expect(parse(AgentSpawnBeforeDecisionSchema, { block: true, reason: "no" }).ok).toBe(true);
    expect(parse(AgentSpawnBeforeDecisionSchema, { ask: true, reason: "confirm" }).ok).toBe(true);
    expect(
      parse(AgentSpawnBeforeDecisionSchema, { replace: { report: "done" }, reason: "cached" }).ok,
    ).toBe(true);
  });

  test("a replace with no report is refused", () => {
    expect(parse(AgentSpawnBeforeDecisionSchema, { replace: {}, reason: "x" }).ok).toBe(false);
  });
});

describe("agent.spawn.after report merge (§4.3.4)", () => {
  const merge = CHAIN_RULES["agent.spawn.after"].merge;

  test("a patch without reportText leaves the value as it was", () => {
    const current = { report: { text: "kept", truncated: false } };
    expect(merge(current, {})).toEqual({ report: { text: "kept", truncated: false } });
  });

  test("a shorter reportText replaces the text and keeps truncated false", () => {
    const current = { report: { text: "old", truncated: false } };
    expect(merge(current, { reportText: "new" })).toEqual({
      report: { text: "new", truncated: false },
    });
  });

  test("a reportText over the limit is cut at the limit and marked truncated", () => {
    const current = { report: { text: "old", truncated: false } };
    const long = "x".repeat(AGENT_REPORT_TEXT_MAX + 5);
    expect(merge(current, { reportText: long })).toEqual({
      report: { text: "x".repeat(AGENT_REPORT_TEXT_MAX), truncated: true },
    });
  });

  test("a report that was already truncated stays truncated after a shorter replacement", () => {
    const current = { report: { text: "cut", truncated: true } };
    expect(merge(current, { reportText: "short" })).toEqual({
      report: { text: "short", truncated: true },
    });
  });

  test("the patch schema takes only reportText", () => {
    expect(parse(AgentSpawnAfterPatchSchema, { reportText: "x" }).ok).toBe(true);
    expect(parse(AgentSpawnAfterPatchSchema, { status: "error" }).ok).toBe(false);
  });
});
