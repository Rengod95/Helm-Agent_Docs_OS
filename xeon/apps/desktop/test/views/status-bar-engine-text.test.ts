import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { EngineState } from "../../src/state/engine/index.ts";
import type { EngineTargetView } from "../../src/state/ui/index.ts";
import { engineLineOf, engineTextOf } from "../../src/views/status-bar.tsx";

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
