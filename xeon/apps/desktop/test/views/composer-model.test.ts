import { describe, expect, test } from "bun:test";
import {
  COMPOSITION_END_GRACE_MS,
  composerDisabledReason,
  createEnterGuard,
  createSendLatch,
  type EnterKeyInput,
} from "../../src/views/composer-model.ts";

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
      "모델 키와 기본 모델을 먼저 정해야 대화를 시작할 수 있습니다.",
    );
  });

  test("engine and link problems come first", () => {
    expect(composerDisabledReason({ ...ready, engineRunning: false, setupNeeded: true })).toBe(
      "엔진이 꺼져 있어 보낼 수 없습니다.",
    );
    expect(composerDisabledReason({ ...ready, phase: "resync" })).toBe("연결을 맞추는 중입니다.");
  });
});
