import { expect, test } from "bun:test";
import {
  WRITE_DENY_REASON,
  guardWrite,
  isGuardedCaller,
  isWriteCall,
  type ExplorationMarker,
} from "../../src/guard.ts";
import { DEFAULT_HELM_SETTINGS } from "../../src/settings.ts";
import { INITIAL_HELM_STATE, type HelmPhase, type HelmState } from "../../src/state.ts";

const settings = () => DEFAULT_HELM_SETTINGS;
const at = (phase: HelmPhase, pending = false): HelmState => ({
  ...INITIAL_HELM_STATE,
  phase,
  pending: pending ? { inquiryId: "habcdefghijklm", topic: "t", source: "command" } : null,
});
/** 구동 중인 탐구의 단계 표지. explorer 자식 대화의 판정이 이 값을 쓴다 */
const running = (phase: HelmPhase): ExplorationMarker => ({ phase });

test("guard.denies-write-in-diverge-only", () => {
  const guard = guardWrite(settings, new Set(), running("idle"));
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
  const off = guardWrite(
    () => ({ ...DEFAULT_HELM_SETTINGS, writeGuard: false }),
    new Set(),
    running("explore"),
  );
  expect(off({ toolName: "bash", risk: "exec" }, { state: at("diverge") })).toBeUndefined();
});

test("guard.explorer-child-judged-by-the-running-phase", () => {
  const deny = { block: true, reason: WRITE_DENY_REASON } as const;
  const explorerWrite = {
    toolName: "write",
    risk: "write",
    caller: "subagent:explorer",
  } as const;
  const mainWrite = { toolName: "write", risk: "write", caller: "main" } as const;
  // 자식 대화의 커밋 상태는 idle이므로 ctx.state로는 판정할 수 없다. 표지가 explore면 거부한다
  expect(
    guardWrite(settings, new Set(), running("explore"))(explorerWrite, { state: at("idle") }),
  ).toEqual(deny);
  expect(
    guardWrite(settings, new Set(), running("diverge"))(explorerWrite, { state: at("idle") }),
  ).toEqual(deny);
  // 표지가 explore가 아니면(확산이 끝났거나 구동 중이 아님) 자식 대화 쓰기는 거부하지 않는다
  for (const phase of ["idle", "converge", "apply"] as const) {
    expect(
      guardWrite(settings, new Set(), running(phase))(explorerWrite, { state: at("explore") }),
    ).toBeUndefined();
  }
  // main은 표지와 상관없이 호출한 대화 자신의 커밋 상태로 판정한다
  expect(
    guardWrite(settings, new Set(), running("explore"))(mainWrite, { state: at("idle") }),
  ).toBeUndefined();
  expect(
    guardWrite(settings, new Set(), running("idle"))(mainWrite, { state: at("diverge") }),
  ).toEqual(deny);
});

test("guard.unknown-meta-is-write", () => {
  const missing = new Set<string>();
  const guard = guardWrite(settings, missing, running("explore"));
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
    guard({ toolName: "write", risk: "write", caller: "subagent:explorer" }, { state: at("idle") }),
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
