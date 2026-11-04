import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { SafeModeCause, SafeModeSnapshot } from "../../src/views/commands.ts";
import type { EngineState } from "../../src/transport/ipc.ts";
import {
  canSwitchSafeModeOf,
  safeModeExitNoteOf,
  safeModeReadDueOf,
  safeModeStartOfferedOf,
  safeModeSurfaceOf,
  safeModeTipOf,
} from "../../src/views/safe-mode-model.ts";

// 안전 모드 안내의 순수 모형. 자리는 값(스냅샷)과 셸 여부로 정해지고, 셸이 아니면 카드는 없다. 칩은 웹에도 있다.

const OFF: SafeModeSnapshot = { active: false, cause: null, startupFailures: 0, suggest: false };
const SUGGEST: SafeModeSnapshot = { active: false, cause: null, startupFailures: 3, suggest: true };
const SAFE: SafeModeSnapshot = { active: true, cause: "user", startupFailures: 0, suggest: false };

describe("which safe mode surface shows", () => {
  test("no snapshot shows nothing, in the shell and on the web", () => {
    expect(safeModeSurfaceOf(null, true)).toBe("none");
    expect(safeModeSurfaceOf(null, false)).toBe("none");
  });

  test("a suggestion shows the card in the shell and nothing on the web", () => {
    expect(safeModeSurfaceOf(SUGGEST, true)).toBe("card");
    expect(safeModeSurfaceOf(SUGGEST, false)).toBe("none");
  });

  test("safe mode shows the chip in the shell and on the web alike", () => {
    expect(safeModeSurfaceOf(SAFE, true)).toBe("chip");
    expect(safeModeSurfaceOf(SAFE, false)).toBe("chip");
  });

  test("safe mode never shows the card, even with a suggestion still set", () => {
    expect(safeModeSurfaceOf({ ...SAFE, suggest: true }, true)).toBe("chip");
  });

  test("no suggestion and not in safe mode shows nothing", () => {
    expect(safeModeSurfaceOf(OFF, true)).toBe("none");
    expect(safeModeSurfaceOf(OFF, false)).toBe("none");
  });
});

describe("which engine states accept a safe mode restart", () => {
  test("only a live engine and a failed engine take the restart", () => {
    const kinds: readonly EngineState["kind"][] = [
      "starting",
      "running",
      "restarting",
      "stopping",
      "failed",
      "stopped",
    ];
    expect(kinds.filter((kind) => canSwitchSafeModeOf(kind))).toEqual(["running", "failed"]);
    expect(canSwitchSafeModeOf(null)).toBe(false);
  });
});

describe("when the safe mode state is read", () => {
  test("only a running engine with an open link reads it, so the read never races the connection", () => {
    expect(safeModeReadDueOf("running", true)).toBe(true);
    expect(safeModeReadDueOf("running", false)).toBe(false);
    expect(safeModeReadDueOf("restarting", true)).toBe(false);
    expect(safeModeReadDueOf("failed", true)).toBe(false);
    expect(safeModeReadDueOf(null, true)).toBe(false);
  });
});

describe("the chip tip names what is off and the cause", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a user-started safe mode gives the off list and the user cause", () => {
    expect(safeModeTipOf(SAFE)).toBe(
      "꺼진 것: 그룹, 사용자·프로젝트 확장, X 훅. 원인: 설정에서 기본으로 켜 뒀어요",
    );
  });

  test("each cause has its own sentence", () => {
    const causes: readonly SafeModeCause[] = ["user", "startupFailures", "flag"];
    expect(causes.map((cause) => safeModeTipOf({ ...SAFE, cause }).split(". ")[1])).toEqual([
      "원인: 설정에서 기본으로 켜 뒀어요",
      "원인: 연속 시작 실패",
      "원인: 실행 옵션",
    ]);
  });

  test("without a cause only the off list remains", () => {
    expect(safeModeTipOf({ ...SAFE, cause: null })).toBe(
      "꺼진 것: 그룹, 사용자·프로젝트 확장, X 훅",
    );
  });
});

describe("the card and chip choices that depend on the target and the cause", () => {
  test("a remote target is not offered the start-in-safe-mode button, a local one is", () => {
    expect(safeModeStartOfferedOf(true)).toBe(false);
    expect(safeModeStartOfferedOf(false)).toBe(true);
  });

  test("only a safe mode turned on by the setting gets the note that the setting stays on", () => {
    const causes: readonly (SafeModeCause | null)[] = ["user", "startupFailures", "flag", null];
    expect(causes.map((cause) => safeModeExitNoteOf({ ...SAFE, cause }))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
