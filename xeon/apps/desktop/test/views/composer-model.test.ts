import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { EngineState, QueuedInput } from "../../src/state/engine/index.ts";
import {
  COMPOSITION_ARM_MS,
  COMPOSITION_END_GRACE_MS,
  busyModeOfEnter,
  steerableQueuedMode,
  chipInputs,
  composerDisabledReason,
  createEnterGuard,
  createSendLatch,
  engineGoneOf,
  looksLikeSecret,
  queuedModeText,
  queuedPreviewText,
  stopBlockedReasonOf,
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
  test("plain Enter sends; Shift+Enter and other keys go to the browser (line break, typing)", () => {
    const guard = createEnterGuard();
    expect(guard.keyDown(enter(), 1000)).toBe("send");
    expect(guard.keyDown(enter({ shiftKey: true }), 1000)).toBe("pass");
    expect(guard.keyDown(enter({ key: "a", keyCode: 65 }), 1000)).toBe("pass");
  });

  test("Chromium order: one Enter while composing commits the syllable and sends once, the trailing Enter is swallowed", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    // keydown(229, isComposing) → IME에 맡긴다
    expect(guard.keyDown(enter({ isComposing: true, keyCode: 229 }), 1000)).toBe("pass");
    // compositionend → 확정된 글을 보낸다
    expect(guard.compositionEnd(1002)).toBe(true);
    // 같은 키의 두 번째 keydown(13) → 줄바꿈도 두 번째 전송도 없다
    expect(guard.keyDown(enter(), 1003)).toBe("swallow");
  });

  test("WebKit order: compositionend first, then the Enter keydown with keyCode 229 sends", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    expect(guard.compositionEnd(1000)).toBe(false);
    expect(guard.keyDown(enter({ keyCode: 229 }), 1001)).toBe("send");
  });

  test("a composition that ends without Enter (space, click away) does not send", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    expect(guard.keyDown(enter({ key: " ", keyCode: 229, isComposing: true }), 1000)).toBe("pass");
    expect(guard.compositionEnd(1001)).toBe(false);
  });

  test("Shift+Enter while composing commits and breaks the line, never sends", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    expect(guard.keyDown(enter({ shiftKey: true, isComposing: true, keyCode: 229 }), 1000)).toBe(
      "pass",
    );
    expect(guard.compositionEnd(1001)).toBe(false);
    expect(guard.keyDown(enter({ shiftKey: true }), 1002)).toBe("pass");
  });

  test("a deliberate Enter after the grace window sends again", () => {
    const guard = createEnterGuard();
    guard.compositionStart();
    guard.keyDown(enter({ isComposing: true, keyCode: 229 }), 1000);
    guard.compositionEnd(1001);
    expect(guard.keyDown(enter(), 1001 + COMPOSITION_END_GRACE_MS + 1)).toBe("send");
  });

  test("keyCode 229 alone arms a send for the composition end; an old arm is dropped", () => {
    const guard = createEnterGuard();
    expect(guard.keyDown(enter({ keyCode: 229 }), 1000)).toBe("pass");
    expect(guard.compositionEnd(1010)).toBe(true);
    const late = createEnterGuard();
    late.keyDown(enter({ keyCode: 229 }), 1000);
    expect(late.compositionEnd(1000 + COMPOSITION_ARM_MS + 1)).toBe(false);
  });
});

describe("busyModeOfEnter", () => {
  test("plain Enter queues for after the turn; Cmd or Ctrl Enter steers the running turn", () => {
    expect(busyModeOfEnter({ metaKey: false, ctrlKey: false })).toBe("followUp");
    expect(busyModeOfEnter({ metaKey: true, ctrlKey: false })).toBe("steer");
    expect(busyModeOfEnter({ metaKey: false, ctrlKey: true })).toBe("steer");
  });
});

describe("steerableQueuedMode", () => {
  test("only after-the-turn items can be applied now", () => {
    expect(steerableQueuedMode("followUp")).toBe(true);
    expect(steerableQueuedMode("next")).toBe(true);
    expect(steerableQueuedMode("steer")).toBe(false);
    expect(steerableQueuedMode("aside")).toBe(false);
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

describe("engineGoneOf", () => {
  const EXIT = { code: 1, signal: null, at: "2026-11-03T00:00:00.000Z" } as const;
  const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
  const RESTARTING: EngineState = {
    kind: "restarting",
    attempt: 1,
    retryAt: "2026-11-03T00:00:05.000Z",
    lastExit: EXIT,
  };
  const FAILED: EngineState = { kind: "failed", attempts: 3, lastExit: EXIT };

  test("only a running engine on a link that is not down leaves the engine there", () => {
    expect(engineGoneOf(RUNNING, "live")).toBe(false);
    expect(engineGoneOf(RUNNING, "syncing")).toBe(false);
  });

  test("a running engine on a link that is down or failed is gone, since the mirror is stale", () => {
    expect(engineGoneOf(RUNNING, "offline")).toBe(true);
    expect(engineGoneOf(RUNNING, "failed")).toBe(true);
  });

  test("an engine that restarts, failed, or stopped is gone whatever the link says", () => {
    expect(engineGoneOf(RESTARTING, "live")).toBe(true);
    expect(engineGoneOf(FAILED, "live")).toBe(true);
    expect(engineGoneOf({ kind: "stopped" }, "live")).toBe(true);
  });

  test("an engine not read yet counts as gone, the same as the composer's engine-off reason", () => {
    expect(engineGoneOf(null, "live")).toBe(true);
  });
});

describe("stop button reason", () => {
  test("a gone engine gives the stop reason, a present one leaves the stop button usable", () => {
    expect(stopBlockedReasonOf(true)).toBe("엔진이 꺼져 있어 멈출 수 없어요.");
    expect(stopBlockedReasonOf(false)).toBeNull();
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

  test("an internal instruction (display false) is not a chip, and neither is a shown Helm notice (it attaches to the next turn by itself, F-42)", () => {
    const list = [
      chip({
        inputId: evt(1),
        sourceType: "extension",
        preview: { kind: "label", labelKey: "helm", internal: true },
      }),
      chip({
        inputId: evt(2),
        sourceType: "extension",
        preview: { kind: "label", labelKey: "helm" },
      }),
    ];
    expect(chipInputs(list)).toEqual([]);
    expect(queuedPreviewText({ kind: "label", labelKey: "helm" })).toBe("Helm 안내");
  });

  test("the mode is said in the chip's short words: steer after the next tool round, followUp when the turn ends, next with the next message, held when stopped", () => {
    expect(queuedModeText("steer")).toBe("다음 도구 라운드 뒤 들어가요");
    expect(queuedModeText("followUp")).toBe("이번 턴이 끝나면 들어가요");
    expect(queuedModeText("next")).toBe("다음에 보내는 메시지와 함께 들어가요");
    // 멈춘 뒤 보내기를 기다리는 시작 가능 입력은 더는 "끝나면"이 아니다(DP-156). 시작하지 않는 next·aside는 그대로다
    expect(queuedModeText("followUp", true)).toBe(
      "멈춘 뒤라 시작하지 않았어요. 보내기를 누르면 시작해요",
    );
    expect(queuedModeText("steer", true)).toBe(
      "멈춘 뒤라 시작하지 않았어요. 보내기를 누르면 시작해요",
    );
    expect(queuedModeText("next", true)).toBe("다음에 보내는 메시지와 함께 들어가요");
    expect(queuedModeText("aside", true)).toBe("다음 모델 요청과 함께 들어가요");
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

// 가짜 값은 실행 때 조립한다(저장소 비밀 검사가 리터럴을 진짜로 본다)
const fake = (head: string, tail: string, n: number): string => `${head}${tail.repeat(n)}`;

describe("looksLikeSecret", () => {
  test("flags key, token and private key shapes", () => {
    expect(looksLikeSecret(`my key is ${fake("sk-", "a1b2c3d4", 3)}`)).toBe(true);
    expect(looksLikeSecret(fake("ghp_", "A", 30))).toBe(true);
    expect(looksLikeSecret(`${fake("AK", "IA", 1)}ABCDEFGHIJKLMNOP`)).toBe(true);
    expect(looksLikeSecret(`${fake("-----BEGIN OPENSSH ", "PRIVATE KEY", 1)}-----\nabc`)).toBe(
      true,
    );
    expect(looksLikeSecret(`export ${fake("API_", "KEY", 1)}=abcdef0123456789`)).toBe(true);
    expect(looksLikeSecret(`Authorization: ${fake("Bearer ", "x", 24)}`)).toBe(true);
  });

  test("leaves ordinary writing alone", () => {
    expect(looksLikeSecret("")).toBe(false);
    expect(looksLikeSecret("이 함수의 token 처리를 고쳐 줘")).toBe(false);
    expect(looksLikeSecret("password: short")).toBe(false);
    expect(looksLikeSecret("sk-short")).toBe(false);
  });
});
