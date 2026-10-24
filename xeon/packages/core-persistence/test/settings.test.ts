import { expect, test } from "bun:test";
import { DEFAULT_PERSISTENCE_SETTINGS, resolvePersistenceSettings } from "../src/index.ts";

test("defaults apply when no key is set", () => {
  expect(resolvePersistenceSettings({})).toEqual({ ok: true, value: DEFAULT_PERSISTENCE_SETTINGS });
  expect(DEFAULT_PERSISTENCE_SETTINGS).toEqual({ maxResumeAttempts: 3, autoResume: false });
});

test("maxResumeAttempts is an integer from 1 to 20 and autoResume a boolean", () => {
  expect(resolvePersistenceSettings({ maxResumeAttempts: 5, autoResume: true })).toEqual({
    ok: true,
    value: { maxResumeAttempts: 5, autoResume: true },
  });
  for (const bad of [0, 21, 1.5, "3"]) {
    const result = resolvePersistenceSettings({ maxResumeAttempts: bad });
    expect(result.ok).toBe(false);
  }
  const result = resolvePersistenceSettings({ autoResume: "yes", maxResumeAttempts: 0 });
  expect(result.ok ? [] : result.error.map((issue) => issue.name)).toEqual([
    "maxResumeAttempts",
    "autoResume",
  ]);
});
