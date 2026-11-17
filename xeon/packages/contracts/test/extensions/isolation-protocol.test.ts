import { expect, test } from "bun:test";
import {
  PLUGIN_HOST_NOTIFY_HOOKS,
  PLUGIN_PROCESS_FAILURE_REASONS,
  TRACE_FAILURE_REASONS,
  classifyFrame,
  isPluginHostToEngineNotification,
} from "../../src/extensions/index.ts";

test("the notified stream hooks are the three high-frequency events", () => {
  expect([...PLUGIN_HOST_NOTIFY_HOOKS].toSorted()).toEqual([
    "boundary.message.update",
    "request.stream",
    "tool.execution.update",
  ]);
});

test("event.done is the only notification from the host to the engine", () => {
  expect(isPluginHostToEngineNotification("event.done")).toBe(true);
  expect(isPluginHostToEngineNotification("event.notify")).toBe(false);
  expect(isPluginHostToEngineNotification("request.cancel")).toBe(false);
});

test("classifyFrame sorts the four frame shapes", () => {
  expect(classifyFrame({ id: 1, method: "hook.invoke", params: { a: 1 } })).toEqual({
    ok: true,
    value: { kind: "request", id: 1, method: "hook.invoke", params: { a: 1 } },
  });
  expect(classifyFrame({ method: "request.cancel", params: { id: 3 } })).toEqual({
    ok: true,
    value: { kind: "notification", method: "request.cancel", params: { id: 3 } },
  });
  expect(classifyFrame({ id: 2, result: null })).toEqual({
    ok: true,
    value: { kind: "response", id: 2, result: null },
  });
  expect(classifyFrame({ id: 2, error: { kind: "cancelled", message: "x" } })).toEqual({
    ok: true,
    value: { kind: "failure", id: 2, error: { kind: "cancelled", message: "x" } },
  });
  expect(classifyFrame({ id: 5 })).toEqual({ ok: false, error: { kind: "invalid_frame" } });
});

test("process failure reasons are trace reasons and stream hooks are notifications", () => {
  for (const reason of PLUGIN_PROCESS_FAILURE_REASONS) {
    expect(TRACE_FAILURE_REASONS).toContain(reason);
  }
  expect(PLUGIN_HOST_NOTIFY_HOOKS).toEqual([
    "request.stream",
    "boundary.message.update",
    "tool.execution.update",
  ]);
});
