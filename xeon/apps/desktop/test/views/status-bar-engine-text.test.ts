import { expect, test } from "bun:test";
import { engineTextOf } from "../../src/views/status-bar.tsx";

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
