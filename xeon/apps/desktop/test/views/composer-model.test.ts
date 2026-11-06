import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { QueuedInput } from "../../src/state/engine/index.ts";
import {
  COMPOSITION_END_GRACE_MS,
  busyModeOf,
  chipInputs,
  composerDisabledReason,
  createEnterGuard,
  createSendLatch,
  queuedModeText,
  queuedPreviewText,
  withdrawStateOf,
  type EnterKeyInput,
} from "../../src/views/composer-model.ts";
import { evt, thr } from "../state/helpers.ts";

const enter = (over: Partial<EnterKeyInput> = {}): EnterKeyInput => ({
  key: "Enter",
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
  ...over,
});

describe("createEnterGuard", () => {
  test("plain Enter sends", () => {
    expect(createEnterGuard().isSendEnter(enter(), 1000)).toBe(true);
  });

  test("Shift+Enter and other keys never send", () => {
    const guard = createEnterGuard();
    expect(guard.isSendEnter(enter({ shiftKey: true }), 1000)).toBe(false);
    expect(guard.isSendEnter(enter({ key: "a", keyCode: 65 }), 1000)).toBe(false);
  });

  test("Enter while composing (Chrome order: isComposing true) does not send", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    expect(guard.isSendEnter(enter({ isComposing: true, keyCode: 229 }), 1000)).toBe(false);
  });

  test("WebKit order: compositionend, then Enter keydown with keyCode 229 and isComposing false", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    guard.compositionEnd(1000);
    expect(guard.isSendEnter(enter({ keyCode: 229 }), 1001)).toBe(false);
  });

  test("WebKit order even if the keyCode is reported as 13: the same tick after compositionend is ignored", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    guard.compositionEnd(1000);
    expect(guard.isSendEnter(enter(), 1000 + COMPOSITION_END_GRACE_MS)).toBe(false);
  });

  test("a deliberate Enter after the grace window sends again", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    guard.compositionEnd(1000);
    expect(guard.isSendEnter(enter(), 1000 + COMPOSITION_END_GRACE_MS + 1)).toBe(true);
  });

  test("keyCode 229 alone (no composition events seen) does not send", () => {
    expect(createEnterGuard().isSendEnter(enter({ keyCode: 229 }), 1000)).toBe(false);
  });
});

describe("busyModeOf", () => {
  test("the two toggle values come back as the turn.start whenBusy they name", () => {
    expect(busyModeOf("steer")).toBe("steer");
    expect(busyModeOf("followUp")).toBe("followUp");
  });

  test("any other value is not a toggle value, so the toggle keeps its mode", () => {
    expect(busyModeOf("aside")).toBeNull();
    expect(busyModeOf("바로")).toBeNull();
    expect(busyModeOf("")).toBeNull();
  });
});

describe("createSendLatch", () => {
  test("a double Enter acquires once until released", () => {
    const latch = createSendLatch();
    expect([latch.tryAcquire(), latch.tryAcquire()]).toEqual([true, false]);
    latch.release();
    expect(latch.tryAcquire()).toBe(true);
  });
});

describe("composerDisabledReason", () => {
  const ready = {
    engineRunning: true,
    phase: "live",
    observing: false,
    setupNeeded: false,
  } as const;

  test("ready input has no reason", () => {
    expect(composerDisabledReason(ready)).toBeNull();
  });

  test("incomplete setup locks the composer with the banner's sentence", () => {
    expect(composerDisabledReason({ ...ready, setupNeeded: true })).toBe(
      "모델 키와 기본 모델을 먼저 정해야 대화를 시작할 수 있어요.",
    );
  });

  test("engine and link problems come first", () => {
    expect(composerDisabledReason({ ...ready, engineRunning: false, setupNeeded: true })).toBe(
      "엔진이 꺼져 있어 보낼 수 없어요.",
    );
    expect(composerDisabledReason({ ...ready, phase: "resync" })).toBe("연결을 맞추는 중이에요.");
  });
});

/** 칩 하나의 대기 입력 기록. 덮어쓸 항목만 바꾼다 */
const chip = (over: Partial<QueuedInput> = {}): QueuedInput => ({
  inputId: evt(1),
  threadId: thr(1),
  requestId: "r1",
  mode: "steer",
  sourceType: "user",
  preview: { kind: "text", text: "이 파일도 봐 줘" },
  ...over,
});

describe("queued input chips", () => {
  test("only user and extension inputs are chips; delegation and schedule stay out", () => {
    const list = [
      chip({ inputId: evt(1), sourceType: "user" }),
      chip({ inputId: evt(2), sourceType: "extension" }),
      chip({ inputId: evt(3), sourceType: "delegation" }),
      chip({ inputId: evt(4), sourceType: "schedule" }),
    ];
    expect(chipInputs(list).map((c) => c.inputId)).toEqual([evt(1), evt(2)]);
  });

  test("the mode is said in the chip's short words: steer after the next tool round, followUp and next when the turn ends", () => {
    expect(queuedModeText("steer")).toBe("다음 도구 라운드 뒤 들어가요");
    expect(queuedModeText("followUp")).toBe("이번 턴이 끝나면 들어가요");
    expect(queuedModeText("next")).toBe("이번 턴이 끝나면 들어가요");
    expect(queuedModeText("aside")).toBe("다음 모델 요청과 함께 들어가요");
  });

  test("the preview is the text, or a label for an item without text", () => {
    expect(queuedPreviewText({ kind: "text", text: "이 파일도 봐 줘" })).toBe("이 파일도 봐 줘");
    expect(queuedPreviewText({ kind: "label", labelKey: "image" })).toBe("이미지 입력");
    expect(queuedPreviewText({ kind: "label", labelKey: "context" })).toBe("추가 정보");
    expect(queuedPreviewText({ kind: "label", labelKey: "empty" })).toBe("빈 입력");
  });

  test("a withdraw result becomes the chip state: withdrawn, already placed, locked goes back to idle", () => {
    expect(withdrawStateOf(ok(true))).toEqual({ status: "withdrawn" });
    expect(withdrawStateOf(ok(false))).toEqual({ status: "placed" });
    expect(withdrawStateOf(err({ kind: "locked", ownerKind: "desktop", options: [] }))).toEqual({
      status: "idle",
    });
  });

  test("other failures carry the sentence the chip shows, with a retry", () => {
    expect(withdrawStateOf(err({ kind: "offline" }))).toEqual({
      status: "failed",
      message: "엔진에 연결되어 있지 않아요.",
    });
    expect(withdrawStateOf(err({ kind: "switching" }))).toEqual({
      status: "failed",
      message: "엔진을 바꾸는 중이에요. 연결되면 다시 보내 주세요.",
    });
    expect(withdrawStateOf(err({ kind: "unsupported" }))).toEqual({
      status: "failed",
      message: "이 엔진은 이 요청을 지원하지 않아요.",
    });
    expect(withdrawStateOf(err({ kind: "rejected", code: 3102 }))).toEqual({
      status: "failed",
      message: "엔진이 거절했어요 (3102).",
    });
    expect(withdrawStateOf(err({ kind: "rejected", code: null }))).toEqual({
      status: "failed",
      message: "철회하지 못했어요.",
    });
    expect(withdrawStateOf(err({ kind: "failed" }))).toEqual({
      status: "failed",
      message: "철회하지 못했어요.",
    });
  });
});
