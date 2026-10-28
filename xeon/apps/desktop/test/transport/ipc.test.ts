import { describe, expect, test } from "bun:test";
import { parseAttachResult, parseEngineState } from "../../src/transport/ipc.ts";

const exit = { code: 1, signal: null, at: "2026-10-24T00:00:00.000Z" };

describe("engine-state-schema", () => {
  test("accepts the six shell states", () => {
    const states: unknown[] = [
      { kind: "starting", source: "sidecar", attempt: 0 },
      { kind: "running", source: "service", pid: null },
      { kind: "restarting", attempt: 1, retryAt: "2026-10-24T00:00:01.000Z", lastExit: exit },
      { kind: "stopping" },
      { kind: "failed", attempts: 3, lastExit: exit },
      { kind: "stopped" },
    ];
    for (const state of states) expect(parseEngineState(state).ok).toBe(true);
  });

  test("rejects an unknown kind and extra fields", () => {
    expect(parseEngineState({ kind: "paused" }).ok).toBe(false);
    expect(parseEngineState({ kind: "stopped", extra: 1 }).ok).toBe(false);
    expect(parseEngineState({ kind: "running", source: "sidecar", pid: 0 }).ok).toBe(false);
    expect(parseEngineState(null).ok).toBe(false);
  });

  test("attach result needs a positive epoch and a valid state", () => {
    expect(parseAttachResult({ epoch: 1, state: { kind: "stopped" } }).ok).toBe(true);
    expect(parseAttachResult({ epoch: 0, state: { kind: "stopped" } }).ok).toBe(false);
    expect(parseAttachResult({ epoch: 1, state: { kind: "nope" } }).ok).toBe(false);
  });
});
