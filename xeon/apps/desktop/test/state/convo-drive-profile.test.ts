import { describe, expect, test } from "bun:test";
import type { EventWire } from "@fresnel/contracts/wire";
import {
  returnedRequestIdOf,
  selectAppliedProfile,
  selectMarkers,
  selectDriveInputs,
  selectTurnSummaries,
} from "../../src/state/engine/convo-select.ts";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import { SUB, evt, openedHarness, thr, trn } from "./helpers.ts";

// lcM6a: 대화 화면이 읽는 세 사건을 거울까지 값으로 확인한다.
// - `profile.applied`: 지금 프로필(단계 경계에서 쓰인 값), 바뀜 표지(권한 바뀜 포함), 살아 있는 덧씌우기
// - `lease.user_input`: Drive가 받은 사용자 말(전달 대기 → 전달됨), 코어 루프로 돌아간 말은 빠진다
// - `turn.started.invoked`: 그 턴에 얹힌 원샷, 드래프트 덧씌우기면 드래프트 표시

const T = thr(1);
const AT = "2026-11-18T09:00:00.000Z";

function wire(
  seq: number,
  kind: EventWire["kind"],
  payload: unknown,
  turn: number | null = null,
): EventWire {
  return {
    id: evt(seq),
    kind,
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: T,
    turnId: turn === null ? null : trn(turn),
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

function applied(seq: number, profileId: string, over: Record<string, unknown> = {}): EventWire {
  return wire(seq, "profile.applied", {
    reason: "switched",
    profileId,
    profileRev: 1,
    commonRev: 1,
    added: [],
    removed: [],
    overlay: [],
    ...over,
  });
}

function userInput(
  seq: number,
  requestId: string,
  status: "held" | "settled",
  text?: string,
): EventWire {
  return wire(seq, "lease.user_input", {
    requestId,
    scopeId: "helm",
    status,
    ...(text === undefined ? {} : { input: { kind: "user", content: text } }),
  });
}

function feed(wires: readonly EventWire[]): ReturnType<typeof openedHarness> {
  const h = openedHarness(5);
  h.store.ingest({
    type: "batch",
    sub: SUB,
    from: 5,
    to: 5 + wires.length,
    caughtUp: true,
    facts: wires.map(decodeDurable),
  });
  h.store.flush();
  return h;
}

describe("profile.applied → 지금 프로필과 바뀜 표지", () => {
  test("마지막 적용이 지금 프로필이고, 바뀜 표지는 앞 프로필에서 새 프로필로 적는다", () => {
    const h = feed([applied(6, "default", { reason: "open" }), applied(7, "review")]);
    const s = h.store.read.getState();
    expect(selectAppliedProfile(s, T)).toEqual({
      profileId: "review",
      seq: 7,
      reason: "switched",
      overlay: [],
    });
    const markers = selectMarkers(s, T).filter((m) => m.change.kind === "profile");
    expect(markers.map((m) => m.change)).toEqual([
      { kind: "profile", from: "default", to: "review", missing: false, permission: null },
    ]);
  });

  test("권한이 바뀌는 전환은 표지에 권한 바뀜을 싣는다", () => {
    const h = feed([
      applied(6, "default", { reason: "open" }),
      applied(7, "yolo", { permission: { from: "default", to: "bypass" } }),
    ]);
    const marker = selectMarkers(h.store.read.getState(), T).find(
      (m) => m.change.kind === "profile",
    );
    expect(marker?.change).toEqual({
      kind: "profile",
      from: "default",
      to: "yolo",
      missing: false,
      permission: { from: "default", to: "bypass" },
    });
  });

  test("프로필을 찾지 못해 바뀌면 missing 표지다. 살아 있는 덧씌우기는 지금 프로필 값에 든다", () => {
    const overlay = [{ plugin: "helm", contentHash: "h1", until: "release" as const }];
    const h = feed([
      applied(6, "gone", { reason: "open" }),
      applied(7, "default", { reason: "profile_missing", overlay }),
    ]);
    const s = h.store.read.getState();
    expect(selectAppliedProfile(s, T)?.overlay).toEqual(overlay);
    expect(selectMarkers(s, T).find((m) => m.change.kind === "profile")?.change).toEqual({
      kind: "profile",
      from: "gone",
      to: "default",
      missing: true,
      permission: null,
    });
  });
});

describe("lease.user_input → Drive가 받은 말", () => {
  test("held는 전달 대기, settled가 오면 전달됨이다. 글은 PostItem의 글이다", () => {
    const held = feed([userInput(6, "req-1", "held", "검증도 같이 돌려 줘")]);
    expect(selectDriveInputs(held.store.read.getState(), T)).toEqual([
      {
        requestId: "req-1",
        scopeId: "helm",
        seq: 6,
        at: AT,
        text: "검증도 같이 돌려 줘",
        settled: false,
      },
    ]);
    const settled = feed([
      userInput(6, "req-1", "held", "검증도 같이 돌려 줘"),
      userInput(7, "req-1", "settled"),
    ]);
    expect(selectDriveInputs(settled.store.read.getState(), T).map((r) => r.settled)).toEqual([
      true,
    ]);
  });

  test("코어 루프로 돌아가 턴이 된 말은 Drive 입력 줄에서 빠진다", () => {
    const h = feed([
      userInput(6, "req-2", "held", "이건 기본 루프가 받는다"),
      userInput(7, "req-2", "settled"),
      wire(
        8,
        "turn.started",
        { inputItemIds: [], requestId: returnedRequestIdOf("req-2"), scopeId: null },
        1,
      ),
    ]);
    expect(selectDriveInputs(h.store.read.getState(), T)).toEqual([]);
  });
});

describe("turn.started.invoked → 그 턴의 원샷", () => {
  test("invoked를 턴 요약에 싣고, 살아 있는 드래프트 덧씌우기의 플러그인이면 드래프트로 적는다", () => {
    const h = feed([
      applied(6, "default", {
        reason: "overlay_on",
        overlay: [{ plugin: "lint-kit", contentHash: "d1", draftId: "drf_1", until: "turn" }],
      }),
      wire(
        7,
        "turn.started",
        {
          inputItemIds: [],
          requestId: "req-3",
          scopeId: null,
          invoked: [
            { plugin: "lint-kit", entry: "lint-kit", kind: "plugin" },
            { plugin: "review", entry: "review", kind: "skill" },
          ],
        },
        1,
      ),
    ]);
    const turn = selectTurnSummaries(h.store.read.getState(), T).find((t) => t.turnId === trn(1));
    expect(turn?.invoked).toEqual([
      { plugin: "lint-kit", entry: "lint-kit", kind: "plugin", draft: true },
      { plugin: "review", entry: "review", kind: "skill", draft: false },
    ]);
    expect(turn?.requestId).toBe("req-3");
  });
});
