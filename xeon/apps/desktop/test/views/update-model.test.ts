import type { MessageId } from "@fresnel/client/i18n";
import { describe, expect, test } from "bun:test";
import {
  canCheck,
  canDownload,
  canInstall,
  canRetry,
  INITIAL_UPDATE_STATE,
  needsRunningConfirm,
  notesLinesOf,
  primaryActionOf,
  progressPercentOf,
  reasonTextOf,
  reduceUpdate,
  retryStepOf,
  shouldAutoInstall,
  updateCellOf,
  updateDescriptionOf,
  updateLineOf,
  updateTargetOf,
  type CheckOutcome,
  type UpdateEvent,
  type UpdateReason,
  type UpdateStage,
  type UpdateState,
} from "../../src/views/update-model.ts";

// 업데이트 상태 모델(B-10). 전이, 잘못된 순서, 퍼센트, 칸과 줄의 모양, 확인과 설치의 허용 규칙, 자동 설치, 이유 문구 표를 값으로 본다.

const AVAILABLE: UpdateState = { kind: "available", version: "0.4.2", notes: "고친 점" };
const DOWNLOADING: UpdateState = {
  kind: "downloading",
  version: "0.4.2",
  notes: null,
  downloaded: 21,
  total: 100,
};
const READY: UpdateState = { kind: "ready", version: "0.4.2", notes: null };

function fold(state: UpdateState, events: readonly UpdateEvent[]): UpdateState {
  return events.reduce(reduceUpdate, state);
}

/** 단계에서 실패한 상태. 확인 단계는 버전이 없고 나머지는 찾은 버전 0.4.2를 든다 */
function failedAt(stage: UpdateStage): UpdateState {
  return {
    kind: "failed",
    stage,
    reason: "other",
    version: stage === "check" ? null : "0.4.2",
    notes: null,
  };
}

describe("checking transitions", () => {
  test("a check starts from every state that can check and ends at the outcome", () => {
    expect(reduceUpdate({ kind: "current" }, { kind: "checkStarted" })).toEqual({
      kind: "checking",
    });
    expect(reduceUpdate(AVAILABLE, { kind: "checkStarted" })).toEqual({ kind: "checking" });
    expect(reduceUpdate(READY, { kind: "checkStarted" })).toEqual({ kind: "checking" });
    expect(
      reduceUpdate(
        { kind: "failed", stage: "download", reason: "network", version: "0.4.2", notes: null },
        { kind: "checkStarted" },
      ),
    ).toEqual({ kind: "checking" });
  });

  test("the initial state is a silent check at startup", () => {
    expect(INITIAL_UPDATE_STATE).toEqual({ kind: "checking" });
    expect(reduceUpdate(INITIAL_UPDATE_STATE, { kind: "checkStarted" })).toBe(INITIAL_UPDATE_STATE);
  });

  test("a check does not start while unconfigured, downloading or installing", () => {
    const unconfigured: UpdateState = { kind: "unconfigured" };
    const installing: UpdateState = { kind: "installing", version: "0.4.2", notes: null };
    for (const state of [unconfigured, DOWNLOADING, installing]) {
      expect(reduceUpdate(state, { kind: "checkStarted" })).toBe(state);
    }
  });

  test("each check outcome maps to its state", () => {
    const outcomes: readonly [CheckOutcome, UpdateState][] = [
      [{ kind: "notConfigured" }, { kind: "unconfigured" }],
      [{ kind: "upToDate" }, { kind: "current" }],
      [
        { kind: "available", version: "0.4.2", notes: "a" },
        { kind: "available", version: "0.4.2", notes: "a" },
      ],
      [{ kind: "offline" }, { kind: "offline", stage: "check", version: null, notes: null }],
      [
        { kind: "failed", reason: "no_release" },
        { kind: "failed", stage: "check", reason: "no_release", version: null, notes: null },
      ],
    ];
    for (const [outcome, expected] of outcomes) {
      expect(reduceUpdate({ kind: "checking" }, { kind: "checkFinished", outcome })).toEqual(
        expected,
      );
    }
  });

  test("a check outcome that arrives outside checking is ignored", () => {
    const outcome: CheckOutcome = { kind: "upToDate" };
    expect(reduceUpdate(AVAILABLE, { kind: "checkFinished", outcome })).toBe(AVAILABLE);
    expect(reduceUpdate(DOWNLOADING, { kind: "checkFinished", outcome })).toBe(DOWNLOADING);
  });
});

describe("download transitions", () => {
  test("a download starts from an available update with no bytes yet", () => {
    expect(reduceUpdate(AVAILABLE, { kind: "downloadStarted" })).toEqual({
      kind: "downloading",
      version: "0.4.2",
      notes: "고친 점",
      downloaded: 0,
      total: null,
    });
  });

  test("a download can be tried again from a download failure or an offline download", () => {
    const failed: UpdateState = {
      kind: "failed",
      stage: "download",
      reason: "network",
      version: "0.4.2",
      notes: null,
    };
    const offline: UpdateState = {
      kind: "offline",
      stage: "download",
      version: "0.4.2",
      notes: null,
    };
    expect(reduceUpdate(failed, { kind: "downloadStarted" })).toEqual({
      kind: "downloading",
      version: "0.4.2",
      notes: null,
      downloaded: 0,
      total: null,
    });
    expect(reduceUpdate(offline, { kind: "downloadStarted" })).toEqual({
      kind: "downloading",
      version: "0.4.2",
      notes: null,
      downloaded: 0,
      total: null,
    });
  });

  test("a download does not start without a version to fetch", () => {
    const current: UpdateState = { kind: "current" };
    const checkFailure: UpdateState = {
      kind: "failed",
      stage: "check",
      reason: "network",
      version: null,
      notes: null,
    };
    const installFailure: UpdateState = {
      kind: "failed",
      stage: "install",
      reason: "other",
      version: "0.4.2",
      notes: null,
    };
    for (const state of [current, checkFailure, READY, installFailure]) {
      expect(reduceUpdate(state, { kind: "downloadStarted" })).toBe(state);
    }
  });

  test("progress updates the bytes and the total while downloading", () => {
    const started = reduceUpdate(AVAILABLE, { kind: "downloadStarted" });
    const once = reduceUpdate(started, { kind: "progress", downloaded: 512, total: 2048 });
    expect(once).toEqual({
      kind: "downloading",
      version: "0.4.2",
      notes: "고친 점",
      downloaded: 512,
      total: 2048,
    });
    expect(reduceUpdate(once, { kind: "progress", downloaded: 2048, total: null })).toEqual({
      kind: "downloading",
      version: "0.4.2",
      notes: "고친 점",
      downloaded: 2048,
      total: null,
    });
  });

  test("progress outside a download is ignored", () => {
    expect(reduceUpdate(AVAILABLE, { kind: "progress", downloaded: 1, total: 2 })).toBe(AVAILABLE);
    expect(reduceUpdate(READY, { kind: "progress", downloaded: 1, total: 2 })).toBe(READY);
  });

  test("each download outcome maps to ready, an offline download or a download failure", () => {
    expect(
      reduceUpdate(DOWNLOADING, { kind: "downloadFinished", outcome: { kind: "ready" } }),
    ).toEqual({ kind: "ready", version: "0.4.2", notes: null });
    expect(
      reduceUpdate(DOWNLOADING, { kind: "downloadFinished", outcome: { kind: "offline" } }),
    ).toEqual({ kind: "offline", stage: "download", version: "0.4.2", notes: null });
    expect(
      reduceUpdate(DOWNLOADING, {
        kind: "downloadFinished",
        outcome: { kind: "failed", reason: "signature" },
      }),
    ).toEqual({
      kind: "failed",
      stage: "download",
      reason: "signature",
      version: "0.4.2",
      notes: null,
    });
  });

  test("a download outcome outside downloading is ignored", () => {
    expect(reduceUpdate(AVAILABLE, { kind: "downloadFinished", outcome: { kind: "ready" } })).toBe(
      AVAILABLE,
    );
  });
});

describe("install transitions", () => {
  test("an install starts from ready or from an install failure", () => {
    expect(reduceUpdate(READY, { kind: "installStarted" })).toEqual({
      kind: "installing",
      version: "0.4.2",
      notes: null,
    });
    const failedInstall: UpdateState = {
      kind: "failed",
      stage: "install",
      reason: "other",
      version: "0.4.2",
      notes: null,
    };
    expect(reduceUpdate(failedInstall, { kind: "installStarted" })).toEqual({
      kind: "installing",
      version: "0.4.2",
      notes: null,
    });
  });

  test("an install does not start before the download is ready", () => {
    expect(reduceUpdate(AVAILABLE, { kind: "installStarted" })).toBe(AVAILABLE);
    expect(reduceUpdate(DOWNLOADING, { kind: "installStarted" })).toBe(DOWNLOADING);
  });

  test("an install outcome is always a failure (a success restarts the app)", () => {
    const installing: UpdateState = { kind: "installing", version: "0.4.2", notes: null };
    expect(
      reduceUpdate(installing, { kind: "installFinished", outcome: { kind: "offline" } }),
    ).toEqual({ kind: "offline", stage: "install", version: "0.4.2", notes: null });
    expect(
      reduceUpdate(installing, {
        kind: "installFinished",
        outcome: { kind: "failed", reason: "nothing_to_install" },
      }),
    ).toEqual({
      kind: "failed",
      stage: "install",
      reason: "nothing_to_install",
      version: "0.4.2",
      notes: null,
    });
  });

  test("an install outcome outside installing is ignored", () => {
    expect(
      reduceUpdate(READY, {
        kind: "installFinished",
        outcome: { kind: "failed", reason: "other" },
      }),
    ).toBe(READY);
  });
});

describe("a whole run through the states", () => {
  test("check, download with progress, ready, install that fails, then a retry", () => {
    const finished = fold(INITIAL_UPDATE_STATE, [
      { kind: "checkFinished", outcome: { kind: "available", version: "0.4.2", notes: "a" } },
      { kind: "downloadStarted" },
      { kind: "progress", downloaded: 10, total: 40 },
      { kind: "downloadFinished", outcome: { kind: "ready" } },
      { kind: "installStarted" },
      { kind: "installFinished", outcome: { kind: "failed", reason: "other" } },
    ]);
    expect(finished).toEqual({
      kind: "failed",
      stage: "install",
      reason: "other",
      version: "0.4.2",
      notes: "a",
    });
    expect(retryStepOf(finished)).toBe("install");
    expect(reduceUpdate(finished, { kind: "installStarted" })).toEqual({
      kind: "installing",
      version: "0.4.2",
      notes: "a",
    });
  });

  test("a network failure during the download keeps the version so the download can be tried again", () => {
    const failed = fold(AVAILABLE, [
      { kind: "downloadStarted" },
      { kind: "downloadFinished", outcome: { kind: "failed", reason: "network" } },
    ]);
    expect(failed).toEqual({
      kind: "failed",
      stage: "download",
      reason: "network",
      version: "0.4.2",
      notes: "고친 점",
    });
    expect(canDownload(failed)).toBe(true);
  });
});

describe("percent of a download", () => {
  test("it is the bytes so far as a whole number of the total", () => {
    expect(progressPercentOf({ ...DOWNLOADING, downloaded: 1, total: 3 })).toBe(33);
    expect(progressPercentOf({ ...DOWNLOADING, downloaded: 2, total: 3 })).toBe(66);
    expect(progressPercentOf({ ...DOWNLOADING, downloaded: 21, total: 100 })).toBe(21);
    expect(progressPercentOf({ ...DOWNLOADING, downloaded: 100, total: 100 })).toBe(100);
  });

  test("an unknown total gives no percent", () => {
    expect(progressPercentOf({ ...DOWNLOADING, downloaded: 512, total: null })).toBeNull();
  });

  test("it stays between 0 and 100 even when the numbers say otherwise", () => {
    expect(progressPercentOf({ ...DOWNLOADING, downloaded: 150, total: 100 })).toBe(100);
    expect(progressPercentOf({ ...DOWNLOADING, downloaded: 0, total: 0 })).toBeNull();
  });

  test("no other state has a percent", () => {
    expect(progressPercentOf(AVAILABLE)).toBeNull();
    expect(progressPercentOf(READY)).toBeNull();
  });
});

describe("the status bar cell", () => {
  test("the cell shows only while downloading or installing, and the status-line states hide it", () => {
    const cases: readonly [UpdateState, boolean][] = [
      [{ kind: "unconfigured" }, false],
      [{ kind: "checking" }, false],
      [{ kind: "current" }, false],
      [{ kind: "offline", stage: "check", version: null, notes: null }, false],
      [AVAILABLE, true],
      [DOWNLOADING, true],
      [READY, true],
      [{ kind: "installing", version: "0.4.2", notes: null }, true],
      [{ kind: "failed", stage: "check", reason: "no_release", version: null, notes: null }, true],
      [{ kind: "offline", stage: "download", version: "0.4.2", notes: null }, true],
      [{ kind: "offline", stage: "install", version: "0.4.2", notes: null }, true],
    ];
    expect(cases.map(([state]) => updateCellOf(state).showCell)).toEqual(
      cases.map(([, shown]) => shown),
    );
  });

  test("the dot follows the mockup: success while it moves on, danger on failure, warning when offline", () => {
    expect(updateCellOf(AVAILABLE).dot).toBe("success");
    expect(updateCellOf(DOWNLOADING).dot).toBe("success");
    expect(updateCellOf(READY).dot).toBe("success");
    expect(
      updateCellOf({
        kind: "failed",
        stage: "download",
        reason: "signature",
        version: "0.4.2",
        notes: null,
      }).dot,
    ).toBe("danger");
    expect(
      updateCellOf({ kind: "offline", stage: "download", version: "0.4.2", notes: null }).dot,
    ).toBe("warning");
  });

  test("the text names the step and shows the percent only when it is known", () => {
    expect(updateCellOf(AVAILABLE).text).toBe("desktop.update.cell.available");
    expect(updateCellOf(DOWNLOADING).text).toBe("desktop.update.cell.downloading");
    expect(updateCellOf({ ...DOWNLOADING, total: null }).text).toBe(
      "desktop.update.cell.downloadingUnknown",
    );
    expect(updateCellOf(READY).text).toBe("desktop.update.cell.ready");
    expect(updateCellOf({ kind: "installing", version: "0.4.2", notes: null }).text).toBe(
      "desktop.update.cell.installing",
    );
    expect(
      updateCellOf({
        kind: "failed",
        stage: "install",
        reason: "other",
        version: "0.4.2",
        notes: null,
      }).text,
    ).toBe("desktop.update.cell.failed");
    expect(
      updateCellOf({ kind: "offline", stage: "install", version: "0.4.2", notes: null }).text,
    ).toBe("desktop.update.cell.offline");
  });
});

describe("the settings line", () => {
  test("each state has its own status sentence", () => {
    expect(updateLineOf({ kind: "unconfigured" })).toEqual({
      text: "desktop.update.line.unconfigured",
      args: {},
    });
    expect(updateLineOf({ kind: "checking" })).toEqual({
      text: "desktop.update.line.checking",
      args: {},
    });
    expect(updateLineOf({ kind: "current" })).toEqual({
      text: "desktop.update.line.current",
      args: {},
    });
    expect(updateLineOf(AVAILABLE)).toEqual({
      text: "desktop.update.line.available",
      args: { version: "0.4.2" },
    });
    expect(updateLineOf(DOWNLOADING)).toEqual({
      text: "desktop.update.line.downloading",
      args: { percent: 21 },
    });
    expect(updateLineOf({ ...DOWNLOADING, total: null })).toEqual({
      text: "desktop.update.line.downloadingUnknown",
      args: {},
    });
    expect(updateLineOf(READY)).toEqual({ text: "desktop.update.line.ready", args: {} });
    expect(updateLineOf({ kind: "installing", version: "0.4.2", notes: null })).toEqual({
      text: "desktop.update.line.installing",
      args: {},
    });
  });

  test("a failure shows its reason and offline shows the connection sentence", () => {
    expect(
      updateLineOf({
        kind: "failed",
        stage: "check",
        reason: "no_release",
        version: null,
        notes: null,
      }),
    ).toEqual({ text: "desktop.update.reason.noRelease", args: {} });
    expect(updateLineOf({ kind: "offline", stage: "check", version: null, notes: null })).toEqual({
      text: "desktop.update.offline",
      args: {},
    });
  });
});

describe("the checking and retry rules", () => {
  test("a check may start from settled states only", () => {
    expect(canCheck({ kind: "current" })).toBe(true);
    expect(canCheck(AVAILABLE)).toBe(true);
    expect(canCheck(READY)).toBe(true);
    expect(canCheck({ kind: "offline", stage: "check", version: null, notes: null })).toBe(true);
    expect(canCheck({ kind: "checking" })).toBe(false);
    expect(canCheck({ kind: "unconfigured" })).toBe(false);
    expect(canCheck(DOWNLOADING)).toBe(false);
    expect(canCheck({ kind: "installing", version: "0.4.2", notes: null })).toBe(false);
  });

  test("download, install and retry follow the stage that failed", () => {
    expect(retryStepOf(failedAt("check"))).toBe("check");
    expect(retryStepOf(failedAt("download"))).toBe("download");
    expect(retryStepOf(failedAt("install"))).toBe("install");
    expect(retryStepOf(AVAILABLE)).toBeNull();
    expect(canRetry(failedAt("check"))).toBe(true);
    expect(canRetry({ kind: "offline", stage: "download", version: "0.4.2", notes: null })).toBe(
      true,
    );
    expect(canRetry(READY)).toBe(false);
    expect(canRetry({ kind: "current" })).toBe(false);

    expect(canDownload(AVAILABLE)).toBe(true);
    expect(canDownload(failedAt("download"))).toBe(true);
    expect(canDownload(failedAt("check"))).toBe(false);
    expect(canDownload(READY)).toBe(false);

    expect(canInstall(READY)).toBe(true);
    expect(canInstall(failedAt("install"))).toBe(true);
    expect(canInstall(failedAt("download"))).toBe(false);
    expect(canInstall(AVAILABLE)).toBe(false);
  });

  test("a primary button follows the state", () => {
    expect(primaryActionOf(AVAILABLE)).toBe("download");
    expect(primaryActionOf(READY)).toBe("install");
    expect(
      primaryActionOf({
        kind: "failed",
        stage: "download",
        reason: "network",
        version: "0.4.2",
        notes: null,
      }),
    ).toBe("retry");
    expect(primaryActionOf(DOWNLOADING)).toBeNull();
    expect(primaryActionOf({ kind: "current" })).toBeNull();
  });
});

describe("the confirmation before a restart", () => {
  test("installing with turns running asks first, and nothing else does", () => {
    expect(needsRunningConfirm(READY, 2)).toBe(true);
    expect(
      needsRunningConfirm(
        { kind: "failed", stage: "install", reason: "other", version: "0.4.2", notes: null },
        1,
      ),
    ).toBe(true);
    expect(needsRunningConfirm(READY, 0)).toBe(false);
    expect(needsRunningConfirm(DOWNLOADING, 3)).toBe(false);
    expect(needsRunningConfirm(AVAILABLE, 3)).toBe(false);
    expect(
      needsRunningConfirm(
        { kind: "failed", stage: "download", reason: "network", version: "0.4.2", notes: null },
        3,
      ),
    ).toBe(false);
  });
});

describe("the automatic install after the turns end", () => {
  test("it installs once, when the turns are at zero and the file is ready", () => {
    expect(shouldAutoInstall(true, 0, READY)).toBe(true);
  });

  test("it waits while a turn runs, and does nothing without the request", () => {
    expect(shouldAutoInstall(true, 1, READY)).toBe(false);
    expect(shouldAutoInstall(false, 0, READY)).toBe(false);
  });

  test("a failed install is not retried by itself", () => {
    expect(
      shouldAutoInstall(true, 0, {
        kind: "failed",
        stage: "install",
        reason: "other",
        version: "0.4.2",
        notes: null,
      }),
    ).toBe(false);
    expect(shouldAutoInstall(true, 0, AVAILABLE)).toBe(false);
  });
});

describe("the reason sentences", () => {
  test("each reason code has its own sentence", () => {
    const table: readonly [UpdateReason, MessageId][] = [
      ["signature", "desktop.update.reason.signature"],
      ["no_release", "desktop.update.reason.noRelease"],
      ["network", "desktop.update.reason.network"],
      ["busy", "desktop.update.reason.busy"],
      ["nothing_to_download", "desktop.update.reason.nothingToDownload"],
      ["nothing_to_install", "desktop.update.reason.nothingToInstall"],
      ["other", "desktop.update.reason.other"],
    ];
    expect(table.map(([reason]) => reasonTextOf(reason))).toEqual(table.map(([, id]) => id));
  });
});

describe("the popover text", () => {
  test("the description is set only for an available or a ready update", () => {
    expect(updateDescriptionOf(AVAILABLE)).toBe("desktop.update.popover.availableDesc");
    expect(updateDescriptionOf(READY)).toBe("desktop.update.popover.readyDesc");
    expect(updateDescriptionOf(DOWNLOADING)).toBeUndefined();
    expect(
      updateDescriptionOf({ kind: "installing", version: "0.4.2", notes: null }),
    ).toBeUndefined();
  });

  test("the notes are split into at most three plain lines", () => {
    expect(notesLinesOf(null)).toEqual([]);
    expect(notesLinesOf("  - 첫째\n\n둘째\n* 셋째\n넷째")).toEqual(["첫째", "둘째", "셋째"]);
    expect(notesLinesOf("  \n  ")).toEqual([]);
  });

  test("the new version and its notes come from the state that carries them", () => {
    expect(updateTargetOf(AVAILABLE)).toEqual({ version: "0.4.2", notes: "고친 점" });
    expect(updateTargetOf({ kind: "checking" })).toBeNull();
    expect(updateTargetOf({ kind: "current" })).toBeNull();
    expect(
      updateTargetOf({
        kind: "failed",
        stage: "check",
        reason: "other",
        version: null,
        notes: null,
      }),
    ).toBeNull();
  });
});
