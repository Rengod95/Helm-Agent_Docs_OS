import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS, type ExtListEntry } from "@fresnel/contracts/wire";
import {
  profileApplyRequestOf,
  profileFailureOf,
  threadOnOf,
  threadPendingOf,
  threadSwitchOf,
  threadToggleRequestOf,
} from "../../src/workbench/index.ts";

// 검사 탭 "이 대화에서" 구역의 순수 모델(thread.ts)을 값으로 본다. 요청 모양은 wire의 정확한 params다.

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: name, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 0,
    ...over,
  };
}

function threadOf(name: string): ThreadId {
  const parsed = parse(ThreadIdSchema, `thr_01HZX0000000000000000000${name}`);
  if (!parsed.ok) throw new Error("test thread id must parse");
  return parsed.value;
}

const THREAD = threadOf("AA");

const HELM = entry("helm", { layer: "L3", isGroup: true });
const CORE = entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" });
const GUARD = entry("guard", { tier: "guard", origin: "builtin" });
const OFF = entry("review", { status: "disabled" });

describe("이 대화에서 켜짐 값: 대화가 덮어 쓴 상태가 있으면 그것, 없으면 전역", () => {
  test("대화 상태가 없으면 전역 상태를 쓴다", () => {
    expect(threadOnOf(HELM)).toBe(true);
    expect(threadOnOf(OFF)).toBe(false);
  });

  test("대화가 끈 확장은 전역이 켜져 있어도 이 대화에서 꺼진다", () => {
    expect(threadOnOf({ ...HELM, registration: "disabled" })).toBe(false);
  });

  test("대화가 켠 확장은 전역이 꺼져 있어도 이 대화에서 켜진다", () => {
    expect(threadOnOf({ ...OFF, registration: "enabled" })).toBe(true);
  });
});

describe("다음 단계 경계를 기다리는 중: 대화 상태의 enabling·disabling", () => {
  test("끄는 중은 false, 켜는 중은 true, 안정된 상태는 null이다", () => {
    expect(threadPendingOf({ ...HELM, registration: "disabling" })).toBe(false);
    expect(threadPendingOf({ ...OFF, registration: "enabling" })).toBe(true);
    expect(threadPendingOf({ ...HELM, registration: "enabled" })).toBeNull();
    expect(threadPendingOf(OFF)).toBeNull();
  });

  test("대화 상태가 없으면 전역 상태를 본다", () => {
    expect(threadPendingOf({ ...HELM, status: "disabling" })).toBe(false);
  });
});

describe("이 대화에서 끄기 스위치의 그림", () => {
  test("열린 대화에서 전역으로 켜진 확장은 열린 스위치이고 켜져 있다", () => {
    expect(threadSwitchOf(HELM, true)).toEqual({ kind: "open", on: true });
  });

  test("대화가 없으면 잠기고 이유는 대화 없음이다", () => {
    expect(threadSwitchOf(HELM, false)).toEqual({ kind: "locked", lock: "no_thread", on: true });
  });

  test("전역에서 꺼진 확장은 잠기고 이유는 전역 꺼짐이다", () => {
    expect(threadSwitchOf(OFF, true)).toEqual({ kind: "locked", lock: "global_off", on: false });
  });

  test("이 대화에서 끈 값이 전체 상태를 꺼짐으로 보여도 전역이 꺼진 것이 아니라서 열려 있다", () => {
    expect(
      threadSwitchOf(
        { ...HELM, status: "disabled", registration: "disabled", enabledSource: "thread" },
        true,
      ),
    ).toEqual({ kind: "open", on: false });
  });

  test("면제 tier(core, guard)는 스위치가 아예 없다", () => {
    expect(threadSwitchOf(CORE, true)).toEqual({ kind: "hidden" });
    expect(threadSwitchOf(GUARD, false)).toEqual({ kind: "hidden" });
  });

  test("안전 모드에서 빠진 확장과 관리 정책이 정한 확장은 각자 이유로 잠긴다", () => {
    const safe = entry("acme", { safeModeExcluded: "안전 모드" });
    const managed = entry("policy", { enabledSource: "managed" });
    expect(threadSwitchOf(safe, true)).toEqual({ kind: "locked", lock: "safe_mode", on: true });
    expect(threadSwitchOf(managed, true)).toEqual({ kind: "locked", lock: "managed", on: true });
  });

  test("대화가 덮어 쓴 상태로 켜져 있으면 전역이 꺼져 있어도 잠긴 채 켜져 보인다", () => {
    expect(threadSwitchOf({ ...OFF, registration: "enabled" }, true)).toEqual({
      kind: "locked",
      lock: "global_off",
      on: true,
    });
  });
});

describe("이 대화에서 끄기 요청: settings.set, 범위 launch, 대화 id", () => {
  test("열린 대화의 확장을 끄면 정확한 params다", () => {
    expect(threadToggleRequestOf(HELM, THREAD, false)).toEqual({
      ok: true,
      request: { key: "ext.helm.enabled", value: false, scope: "launch", threadId: THREAD },
    });
  });

  test("이 대화에서 다시 켜는 요청은 값 true, 같은 범위다(전역은 켜져 있어야 한다)", () => {
    expect(threadToggleRequestOf(HELM, THREAD, true)).toEqual({
      ok: true,
      request: { key: "ext.helm.enabled", value: true, scope: "launch", threadId: THREAD },
    });
  });

  test("대화가 없으면 보내지 않는다", () => {
    expect(threadToggleRequestOf(HELM, null, false)).toEqual({
      ok: false,
      reason: "no_thread",
    });
  });

  test("잠긴 확장은 보내지 않는다: 면제 tier, 전역에서 꺼짐, 관리 정책", () => {
    expect(threadToggleRequestOf(CORE, THREAD, false)).toEqual({ ok: false, reason: "locked" });
    expect(threadToggleRequestOf(OFF, THREAD, true)).toEqual({ ok: false, reason: "locked" });
    const managed = entry("policy", { enabledSource: "managed" });
    expect(threadToggleRequestOf(managed, THREAD, true)).toEqual({
      ok: false,
      reason: "locked",
    });
  });
});

describe("프로필 적용: profile.apply, 층 thread", () => {
  test("요청은 id, threadId, layer thread를 싣는다", () => {
    expect(profileApplyRequestOf("quiet", THREAD)).toEqual({
      id: "quiet",
      threadId: THREAD,
      layer: "thread",
    });
  });

  test("wire 오류 코드는 실패 갈래 넷 중 하나고, 나머지는 failed다", () => {
    expect(profileFailureOf(WIRE_ERRORS["profile.notFound"].code)).toBe("not_found");
    expect(profileFailureOf(WIRE_ERRORS["profile.trustRequired"].code)).toBe("trust_required");
    expect(profileFailureOf(WIRE_ERRORS["profile.applyPartial"].code)).toBe("apply_partial");
    expect(profileFailureOf(WIRE_ERRORS["profile.limit"].code)).toBe("limit");
    expect(profileFailureOf(WIRE_ERRORS["profile.conflict"].code)).toBe("failed");
    expect(profileFailureOf(null)).toBe("failed");
  });
});
