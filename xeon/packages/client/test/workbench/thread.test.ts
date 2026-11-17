import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_ERRORS, type ExtListEntry, type ThreadSummary } from "@fresnel/contracts/wire";
import {
  profileFailureOf,
  threadOnOf,
  threadPendingOf,
  threadProfileRefOf,
  threadSetProfileRequestOf,
} from "../../src/workbench/index.ts";

// 대화 쪽 순수 모델(thread.ts)을 값으로 본다. 대화별 스위치는 없고(켜짐은 프로필에서 계산한다), 요청 모양은 wire의 정확한 params다.

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

function summaryOf(over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    threadId: THREAD,
    title: null,
    status: "idle",
    workspace: null,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    headSeq: 0,
    forkedFrom: null,
    resumable: null,
    queuedInputs: 0,
    pendingApprovals: 0,
    ...over,
  };
}

const THREAD = threadOf("AA");

const HELM = entry("helm", { layer: "L3", isGroup: true });
const OFF = entry("review", { status: "disabled" });

describe("이 대화에서 켜짐 값: 대화가 덮어 쓴 상태가 있으면 그것, 없으면 전역", () => {
  test("대화 상태가 없으면 전역 상태를 쓴다", () => {
    expect(threadOnOf(HELM)).toBe(true);
    expect(threadOnOf(OFF)).toBe(false);
  });

  test("대화 상태가 꺼짐이면 전역이 켜져 있어도 이 대화에서 꺼진다", () => {
    expect(threadOnOf({ ...HELM, registration: "disabled" })).toBe(false);
  });

  test("대화 상태가 켜짐이면 전역이 꺼져 있어도 이 대화에서 켜진다", () => {
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

describe("대화가 참조하는 프로필 표지: ThreadSummary의 profileId, project, overlay", () => {
  test("요약이 프로필을 싣면 그 id, 프로젝트, 덧씌우기를 그대로 쓴다", () => {
    const project = { projectId: "prj_demo-1", name: "데모" };
    const overlay = [{ plugin: "notes", draft: false, until: "turn" as const }];
    expect(threadProfileRefOf(summaryOf({ profileId: "quiet", project, overlay }))).toEqual({
      profileId: "quiet",
      project,
      overlay,
    });
  });

  test("요약이 프로필을 싣지 않은 옛 대화는 default를 참조하고, 프로젝트와 덧씌우기는 없다", () => {
    expect(threadProfileRefOf(summaryOf())).toEqual({
      profileId: "default",
      project: null,
      overlay: [],
    });
  });

  test("프로젝트가 null이면 기본 폴더 대화다", () => {
    expect(threadProfileRefOf(summaryOf({ profileId: "work", project: null }))).toEqual({
      profileId: "work",
      project: null,
      overlay: [],
    });
  });
});

describe("프로필을 이 대화에 쓰는 요청: thread.setProfile", () => {
  test("요청은 threadId와 profileId만 싣는다(층 값은 없다)", () => {
    expect(threadSetProfileRequestOf("quiet", THREAD)).toEqual({
      threadId: THREAD,
      profileId: "quiet",
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
