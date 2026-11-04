import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import {
  canRestartNowOf,
  RESTART_HOLD_MS,
  restartConfirmOf,
  restartHoldOf,
  restartInfoTextOf,
  restartLineOf,
  restartReasonTextOf,
} from "../../src/views/restart-model.ts";

describe("restart line and button", () => {
  test("no reason hides the line, a web shell gets the text line, a desktop shell gets the full line", () => {
    expect(restartLineOf(0, true)).toBe("hidden");
    expect(restartLineOf(0, false)).toBe("hidden");
    expect(restartLineOf(2, false)).toBe("web");
    expect(restartLineOf(2, true)).toBe("needed");
  });

  test("only a desktop shell with a running engine offers the button", () => {
    expect(canRestartNowOf("running", true)).toBe(true);
    expect(canRestartNowOf("starting", true)).toBe(false);
    expect(canRestartNowOf("restarting", true)).toBe(false);
    expect(canRestartNowOf("stopping", true)).toBe(false);
    expect(canRestartNowOf("failed", true)).toBe(false);
    expect(canRestartNowOf("stopped", true)).toBe(false);
    expect(canRestartNowOf(null, true)).toBe(false);
    expect(canRestartNowOf("running", false)).toBe(false);
  });
});

describe("confirm before restarting", () => {
  test("no running turn and no pending approval means no dialog", () => {
    expect(restartConfirmOf(0, 0)).toEqual({ needed: false, lines: [] });
  });

  test("a running turn alone asks, with its count", () => {
    expect(restartConfirmOf(2, 0)).toEqual({
      needed: true,
      lines: [{ id: "desktop.restart.confirm.turns", count: 2 }],
    });
  });

  test("a pending approval alone asks, with its count", () => {
    expect(restartConfirmOf(0, 1)).toEqual({
      needed: true,
      lines: [{ id: "desktop.restart.confirm.approvals", count: 1 }],
    });
  });

  test("both counts list approvals first, so the turns line keeps the question last", () => {
    expect(restartConfirmOf(1, 3)).toEqual({
      needed: true,
      lines: [
        { id: "desktop.restart.confirm.approvals", count: 3 },
        { id: "desktop.restart.confirm.turns", count: 1 },
      ],
    });
  });
});

describe("reason text", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("in Korean the reasons and the info line read as one sentence each", () => {
    setActiveLocale("ko");
    expect(restartReasonTextOf({ kind: "install", name: "alpha" })).toBe("alpha 설치");
    expect(restartReasonTextOf({ kind: "rollback", name: "beta" })).toBe("beta 되돌리기");
    expect(
      restartInfoTextOf([
        { kind: "install", name: "alpha" },
        { kind: "rollback", name: "beta" },
      ]),
    ).toBe("alpha 설치, beta 되돌리기. 다시 시작하면 열린 대화가 잠깐 끊겼다가 이어져요.");
  });

  test("in English the reasons read as an install or a roll back", () => {
    setActiveLocale("en");
    expect(restartReasonTextOf({ kind: "install", name: "alpha" })).toBe("Install alpha");
    expect(restartReasonTextOf({ kind: "rollback", name: "beta" })).toBe("Roll back beta");
    expect(restartInfoTextOf([{ kind: "install", name: "alpha" }])).toBe(
      "Install alpha. Open conversations disconnect briefly and then reconnect.",
    );
  });

  test("with no reason the info line is the explanation alone", () => {
    setActiveLocale("en");
    expect(restartInfoTextOf([])).toBe("Open conversations disconnect briefly and then reconnect.");
  });
});

describe("the lock after a restart call returns", () => {
  test("the buttons stay locked while the engine still shows the state it had when pressed", () => {
    expect(restartHoldOf("running", "running")).toBe(true);
    expect(restartHoldOf("failed", "failed")).toBe(true);
    expect(restartHoldOf(null, null)).toBe(true);
  });

  test("they unlock as soon as the engine shows another state, such as restarting or starting", () => {
    expect(restartHoldOf("running", "restarting")).toBe(false);
    expect(restartHoldOf("failed", "starting")).toBe(false);
    expect(restartHoldOf("running", null)).toBe(false);
  });

  test("the lock has a deadline so a restart that never shows cannot leave the buttons stuck", () => {
    expect(RESTART_HOLD_MS).toBe(15_000);
  });
});
