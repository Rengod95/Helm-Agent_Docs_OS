import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { JsonValueSchema } from "@fresnel/contracts/conversation";
import type { CallRecord } from "@fresnel/contracts/wire";
import {
  callerIdOf,
  hasBlobPlaceholder,
  threadItemLogOf,
  toolCallPayloadOf,
} from "../../../src/assembly/backtest/payload.ts";
import { assistantEvent, callOf, envelope, resultEvent } from "./fixtures.ts";

// 호출 입력 재구성(§4.8 규칙 45). 기록과 대화 로그에서 훅 입력을 만들고, 되살리지 못한 값과 스키마를 벗어난 값을 구분한다.

const THREAD = "thr_01HZXA0000000000000000000A";

function jsonOf(value: unknown) {
  const checked = parse(JsonValueSchema, value);
  if (!checked.ok) throw new Error("the fixture must be JSON");
  return checked.value;
}

test("the log index holds each tool call's name and arguments and each result, and the first of a repeated id wins", () => {
  const good = threadItemLogOf([
    assistantEvent(THREAD, 1, [{ id: "c1", name: "bash", args: { command: "ls" } }]),
    assistantEvent(THREAD, 2, [{ id: "c1", name: "other", args: { command: "pwd" } }]),
    resultEvent(THREAD, 3, "c1", "bash", "out"),
  ]);
  if (!good.ok) throw new Error("the log must index");
  expect(good.value.calls.get("c1")).toEqual({
    name: "bash",
    args: { command: "ls" },
    argumentsError: false,
  });
  expect(good.value.results.get("c1")?.value).toEqual({
    content: [{ type: "text", text: "out" }],
    isError: false,
  });
});

test("a log line that breaks the item schema makes the thread's log corrupt", () => {
  const corrupt = threadItemLogOf([envelope(THREAD, 1, { item: { kind: "assistant" } })]);
  expect(corrupt.ok ? "ok" : corrupt.error.kind).toBe("log_corrupt");
});

test("the log reader ignores events that are not item.recorded", () => {
  const other = { ...envelope(THREAD, 1, {}), kind: "turn.started" as const };
  const read = threadItemLogOf([other]);
  expect(read.ok && read.value.calls.size).toBe(0);
});

test("a tool call whose arguments could not be read keeps the flag, and a log line outside the schema is corrupt", () => {
  const log = threadItemLogOf([
    assistantEvent(THREAD, 1, [{ id: "c1", name: "bash", args: {}, argumentsError: "not json" }]),
  ]);
  expect(log.ok && log.value.calls.get("c1")?.argumentsError).toBe(true);
  const broken = threadItemLogOf([
    assistantEvent(THREAD, 1, [{ id: "c1", name: "bash", args: {} }]),
    envelope(THREAD, 2, { item: { kind: "unknown-kind" } }),
  ]);
  expect(broken.ok ? "ok" : broken.error.kind).toBe("log_corrupt");
});

test("a blob placeholder left in a value is found at any depth and nothing else is", () => {
  const hash = "ab".repeat(32);
  expect(hasBlobPlaceholder(jsonOf({ a: [{ b: `blob:sha256:${hash}` }] }))).toBe(true);
  expect(hasBlobPlaceholder(jsonOf(`blob:sha256:${hash}`))).toBe(true);
  expect(hasBlobPlaceholder(jsonOf({ a: `blob:sha256:${hash}x` }))).toBe(false);
  expect(hasBlobPlaceholder(jsonOf({ a: "plain", n: 1, z: null }))).toBe(false);
});

test("the caller of a recorded call reads as main, plugin:<name>, or nothing for a subagent whose name is not recorded", () => {
  expect(callerIdOf(callOf("c", { caller: "main" }))).toBe("main");
  expect(callerIdOf(callOf("c", { caller: "plugin", callerPlugin: "guard-a" }))).toBe(
    "plugin:guard-a",
  );
  expect(callerIdOf(callOf("c", { caller: "plugin", callerPlugin: null }))).toBe(null);
  expect(callerIdOf(callOf("c", { caller: "subagent" }))).toBe(null);
});

function payloadOfCall(call: CallRecord, args: Readonly<Record<string, string>>) {
  const built = toolCallPayloadOf(call, args);
  return built.ok ? built.value.json : built.error.kind;
}

test("the hook payload is built from the record and the logged arguments, with the record's risk and capability", () => {
  expect(payloadOfCall(callOf("c1", { risk: "write" }), { path: "a.txt" })).toEqual({
    toolCallId: "c1",
    toolName: "bash",
    input: { path: "a.txt" },
    risk: "write",
    caller: "main",
  });
  expect(
    payloadOfCall(
      callOf("c2", {
        parentToolCallId: "p1",
        capability: { id: "workspace.files", method: "read" },
        caller: "plugin",
        callerPlugin: "guard-a",
      }),
      {},
    ),
  ).toEqual({
    toolCallId: "c2",
    parentToolCallId: "p1",
    toolName: "bash",
    input: {},
    capability: { id: "workspace.files", method: "read" },
    risk: "exec",
    caller: "plugin:guard-a",
  });
});

test("a subagent call omits the caller and a tool name outside the schema is tool_unknown", () => {
  expect(payloadOfCall(callOf("c3", { caller: "subagent" }), {})).toEqual({
    toolCallId: "c3",
    toolName: "bash",
    input: {},
    risk: "exec",
  });
  expect(payloadOfCall(callOf("c4", { tool: "Bad Tool!" }), {})).toBe("tool_unknown");
});
