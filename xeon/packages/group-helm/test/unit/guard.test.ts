import { expect, test } from "bun:test";
import { WRITE_DENY_REASON, guardWrite, isGuardedCaller, isWriteCall } from "../../src/guard.ts";
import { DEFAULT_HELM_SETTINGS } from "../../src/settings.ts";
import { INITIAL_HELM_STATE, type HelmPhase, type HelmState } from "../../src/state.ts";

const settings = () => DEFAULT_HELM_SETTINGS;
const at = (phase: HelmPhase, pending = false): HelmState => ({
  ...INITIAL_HELM_STATE,
  phase,
  pending: pending ? { inquiryId: "habcdefghijklm", topic: "t", source: "command" } : null,
});

test("guard.denies-write-in-diverge-only", () => {
  const guard = guardWrite(settings, new Set());
  const write = { toolName: "write", risk: "write" } as const;
  const bash = { toolName: "bash", risk: "exec" } as const;
  const read = { toolName: "read", risk: "read" } as const;
  const deny = { block: true, reason: WRITE_DENY_REASON } as const;
  for (const phase of ["diverge", "explore"] as const) {
    expect(guard(write, { state: at(phase) })).toEqual(deny);
    expect(guard(bash, { state: at(phase) })).toEqual(deny);
    expect(guard(read, { state: at(phase) })).toBeUndefined();
  }
  for (const state of [at("idle"), at("idle", true), at("converge"), at("apply")]) {
    expect(guard(write, { state })).toBeUndefined();
    expect(guard(bash, { state })).toBeUndefined();
  }
});

test("guard.respects-write-guard-setting", () => {
  const off = guardWrite(() => ({ ...DEFAULT_HELM_SETTINGS, writeGuard: false }), new Set());
  expect(off({ toolName: "bash", risk: "exec" }, { state: at("diverge") })).toBeUndefined();
});

test("guard.unknown-meta-is-write", () => {
  const missing = new Set<string>();
  const guard = guardWrite(settings, missing);
  const deny = { block: true, reason: WRITE_DENY_REASON } as const;
  expect(guard({ toolName: "mystery" }, { state: at("explore") })).toEqual(deny);
  expect([...missing]).toEqual(["mystery"]);
  expect(
    guard({ toolName: "bash", risk: "exec", hints: { readOnly: true } }, { state: at("diverge") }),
  ).toEqual(deny);
  expect(
    guard(
      { toolName: "write", risk: "write", caller: "subagent:reviewer" },
      { state: at("diverge") },
    ),
  ).toBeUndefined();
  expect(
    guard(
      { toolName: "write", risk: "write", caller: "subagent:explorer" },
      { state: at("diverge") },
    ),
  ).toEqual(deny);
  expect(
    guard({ toolName: "write", risk: "write", caller: "main" }, { state: at("diverge") }),
  ).toEqual(deny);
});

test("isWriteCall and isGuardedCaller follow the judgement table", () => {
  expect(isWriteCall({ risk: "read" })).toBe(false);
  expect(isWriteCall({ risk: "write" })).toBe(true);
  expect(isWriteCall({ risk: "exec" })).toBe(true);
  expect(isWriteCall({})).toBe(true);
  expect(isGuardedCaller(undefined)).toBe(true);
  expect(isGuardedCaller("subagent:other")).toBe(false);
});
