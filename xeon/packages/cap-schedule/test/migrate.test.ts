import { expect, test } from "bun:test";
import { upgradeScheduleState } from "../src/migrate.ts";

const loopEntry = {
  id: "s1",
  trigger: { kind: "loop", intervalSeconds: 60, maxIterations: 3, expiresAtMs: 1_000 },
  prompt: "p",
};

test("version 1 loop entries and runs become repeat in version 2", () => {
  const upgraded = upgradeScheduleState({
    version: 1,
    entries: [
      loopEntry,
      { id: "s2", trigger: { kind: "interval", everySeconds: 600 }, prompt: "q" },
    ],
    runs: [
      { runId: "r1", firedBy: "loop" },
      { runId: "r2", firedBy: "interval" },
    ],
  });
  expect(upgraded).toEqual({
    version: 2,
    entries: [
      { ...loopEntry, trigger: { ...loopEntry.trigger, kind: "repeat" } },
      { id: "s2", trigger: { kind: "interval", everySeconds: 600 }, prompt: "q" },
    ],
    runs: [
      { runId: "r1", firedBy: "repeat" },
      { runId: "r2", firedBy: "interval" },
    ],
  });
});

test("other versions and shapes pass through unchanged", () => {
  const v2 = { version: 2, entries: [], runs: [] };
  expect(upgradeScheduleState(v2)).toBe(v2);
  expect(upgradeScheduleState(null)).toBeNull();
  expect(upgradeScheduleState("x")).toBe("x");
  expect(upgradeScheduleState({ version: 1, entries: "bad", runs: 3 })).toEqual({
    version: 2,
    entries: "bad",
    runs: 3,
  });
});
