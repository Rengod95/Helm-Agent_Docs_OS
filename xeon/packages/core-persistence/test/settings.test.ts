import { expect, test } from "bun:test";
import { DEFAULT_PERSISTENCE_SETTINGS, resolvePersistenceSettings } from "../src/index.ts";

test("defaults apply when no key is set", () => {
  expect(resolvePersistenceSettings({})).toEqual({ ok: true, value: DEFAULT_PERSISTENCE_SETTINGS });
  expect(DEFAULT_PERSISTENCE_SETTINGS).toEqual({
    maxResumeAttempts: 3,
    autoResume: false,
    retentionMaxAgeDays: 0,
    retentionMaxCount: 0,
  });
});

test("maxResumeAttempts is an integer from 1 to 20 and autoResume a boolean", () => {
  expect(resolvePersistenceSettings({ maxResumeAttempts: 5, autoResume: true })).toEqual({
    ok: true,
    value: { ...DEFAULT_PERSISTENCE_SETTINGS, maxResumeAttempts: 5, autoResume: true },
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

test("retention keys are integers within their documented ranges", () => {
  expect(
    resolvePersistenceSettings({ "retention.maxAgeDays": 30, "retention.maxCount": 500 }),
  ).toEqual({
    ok: true,
    value: { ...DEFAULT_PERSISTENCE_SETTINGS, retentionMaxAgeDays: 30, retentionMaxCount: 500 },
  });
  for (const input of [
    { "retention.maxAgeDays": -1 },
    { "retention.maxAgeDays": 3651 },
    { "retention.maxCount": 100_001 },
    { "retention.maxCount": 1.5 },
  ]) {
    expect(resolvePersistenceSettings(input).ok).toBe(false);
  }
});
