import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { EngineState } from "../../src/state/engine/index.ts";
import type { EngineTargetView } from "../../src/state/ui/index.ts";
import {
  engineDescriptionOf,
  engineDotOf,
  engineLineOf,
  engineRestoreShownOf,
  engineTextOf,
  shownEngineOf,
} from "../../src/views/status-bar.tsx";

const exitAt = (code: number | null): { code: number | null; signal: null; at: string } => ({
  code,
  signal: null,
  at: "2026-11-03T00:00:00.000Z",
});

test("a store failure exit code selects its own message and other exits keep the generic one", () => {
  expect(engineTextOf({ kind: "failed", attempts: 3, lastExit: exitAt(70) })).toBe(
    "desktop.status.engine.storeFutureVersion",
  );
  expect(engineTextOf({ kind: "failed", attempts: 3, lastExit: exitAt(71) })).toBe(
    "desktop.status.engine.storeCorrupt",
  );
  expect(
    engineTextOf({
      kind: "restarting",
      attempt: 1,
      retryAt: "2026-11-03T00:00:05.000Z",
      lastExit: exitAt(72),
    }),
  ).toBe("desktop.status.engine.storeMigrationFailed");
  expect(engineTextOf({ kind: "failed", attempts: 3, lastExit: exitAt(1) })).toBe(
    "desktop.status.engine.failed",
  );
  expect(engineTextOf({ kind: "failed", attempts: 3, lastExit: exitAt(null) })).toBe(
    "desktop.status.engine.failed",
  );
  expect(engineTextOf(undefined)).toBe("desktop.status.engine.checking");
});

test("the data folder permission exit code tells the reason and the next step (rtE R-9)", () => {
  expect(engineTextOf({ kind: "failed", attempts: 3, lastExit: exitAt(73) })).toBe(
    "desktop.status.engine.dataDirPermission",
  );
});

/** 종료 코드 하나가 재시작 중인 엔진에 보이는 문장 */
function restartingTextOf(code: number): string {
  return engineTextOf({
    kind: "restarting",
    attempt: 1,
    retryAt: "2026-11-03T00:00:05.000Z",
    lastExit: exitAt(code),
  });
}

test("the startup failures the user can fix each say their own reason (exit 73 to 76)", () => {
  expect(restartingTextOf(73)).toBe("desktop.status.engine.dataDirPermission");
  expect(restartingTextOf(74)).toBe("desktop.status.engine.storeBusy");
  expect(restartingTextOf(75)).toBe("desktop.status.engine.dataDirUnwritable");
  expect(restartingTextOf(76)).toBe("desktop.status.engine.storeUnavailable");
  expect(restartingTextOf(1)).toBe("desktop.status.engine.restarting");
});

describe("engine line names where the engine runs", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  const SIDECAR: EngineState = { kind: "running", source: "sidecar", pid: 1 };
  const LOCAL: EngineTargetView = { kind: "local" };
  const REMOTE: EngineTargetView = {
    kind: "remote",
    address: "unix:/run/box.sock",
    label: "build-box",
  };

  test("a running engine on this computer says it runs in the app", () => {
    expect(engineLineOf(SIDECAR, LOCAL)).toBe("엔진 실행 중 (앱 안)");
    expect(engineLineOf(SIDECAR)).toBe("엔진 실행 중 (앱 안)");
  });

  test("a running engine on a remote target names the target, even when the relay reports the sidecar", () => {
    expect(engineLineOf(SIDECAR, REMOTE)).toBe("엔진 실행 중 (원격 · build-box)");
    expect(engineLineOf({ kind: "running", source: "service", pid: null }, REMOTE)).toBe(
      "엔진 실행 중 (원격 · build-box)",
    );
  });

  test("a service-sourced engine on this computer keeps its source text", () => {
    expect(engineLineOf({ kind: "running", source: "service", pid: null }, LOCAL)).toBe(
      "엔진 실행 중 (서비스)",
    );
  });

  test("an engine that is not running adds no source, even with a remote target", () => {
    expect(engineLineOf({ kind: "stopped" }, REMOTE)).toBe("엔진 꺼짐");
    expect(engineLineOf(undefined, REMOTE)).toBe("엔진 상태 확인 중");
  });

  test("the remote name reads in English with the same parenthesis form", () => {
    setActiveLocale("en");
    expect(engineLineOf(SIDECAR, REMOTE)).toBe("Engine running (remote · build-box)");
  });
});

describe("a running process is shown as running only while its link is live", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
  const FAILED: EngineState = { kind: "failed", attempts: 1, lastExit: exitAt(75) };

  test("a running engine with a link that is not live yet is shown as starting", () => {
    expect(shownEngineOf(RUNNING, false)).toEqual({
      kind: "starting",
      source: "sidecar",
      attempt: 0,
    });
    expect(engineLineOf(shownEngineOf(RUNNING, false))).toBe("엔진 시작 중");
    expect(engineDotOf(shownEngineOf(RUNNING, false))).toBe("warning");
    expect(engineDescriptionOf(shownEngineOf(RUNNING, false))).toBeUndefined();
  });

  test("a live link keeps the running view, green dot and the source", () => {
    expect(shownEngineOf(RUNNING, true)).toBe(RUNNING);
    expect(engineLineOf(shownEngineOf(RUNNING, true))).toBe("엔진 실행 중 (앱 안)");
    expect(engineDotOf(shownEngineOf(RUNNING, true))).toBe("success");
  });

  test("the other engine states are shown as they are, whatever the link", () => {
    expect(shownEngineOf(FAILED, false)).toBe(FAILED);
    expect(shownEngineOf({ kind: "stopped" }, false)).toEqual({ kind: "stopped" });
    expect(shownEngineOf(null, false)).toBeNull();
    expect(shownEngineOf(undefined, true)).toBeUndefined();
    expect(engineTextOf(shownEngineOf(FAILED, false))).toBe(
      "desktop.status.engine.dataDirUnwritable",
    );
  });
});

describe("the data restore button shows only where the store is corrupt or its migration failed", () => {
  const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };

  test("a failed or restarting engine whose store is corrupt (71) or failed to migrate (72) shows it", () => {
    expect(engineRestoreShownOf({ kind: "failed", attempts: 3, lastExit: exitAt(71) })).toBe(true);
    expect(
      engineRestoreShownOf({
        kind: "restarting",
        attempt: 1,
        retryAt: "2026-11-03T00:00:05.000Z",
        lastExit: exitAt(71),
      }),
    ).toBe(true);
    expect(engineRestoreShownOf({ kind: "failed", attempts: 3, lastExit: exitAt(72) })).toBe(true);
    expect(
      engineRestoreShownOf({
        kind: "restarting",
        attempt: 1,
        retryAt: "2026-11-03T00:00:05.000Z",
        lastExit: exitAt(72),
      }),
    ).toBe(true);
  });

  test("the other exit codes, the other engine states and no engine show no button", () => {
    expect(engineRestoreShownOf({ kind: "failed", attempts: 3, lastExit: exitAt(70) })).toBe(false);
    expect(engineRestoreShownOf({ kind: "failed", attempts: 3, lastExit: exitAt(73) })).toBe(false);
    expect(engineRestoreShownOf({ kind: "failed", attempts: 3, lastExit: exitAt(1) })).toBe(false);
    expect(engineRestoreShownOf({ kind: "failed", attempts: 3, lastExit: exitAt(null) })).toBe(
      false,
    );
    expect(engineRestoreShownOf(RUNNING)).toBe(false);
    expect(engineRestoreShownOf({ kind: "stopped" })).toBe(false);
    expect(engineRestoreShownOf(null)).toBe(false);
    expect(engineRestoreShownOf(undefined)).toBe(false);
  });
});
