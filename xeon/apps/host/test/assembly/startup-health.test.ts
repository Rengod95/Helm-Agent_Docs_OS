import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  createFileStartupHealth,
  STARTUP_HEALTH_FILE,
  startupHealthOf,
} from "../../src/assembly/startup-health.ts";

// X.operations.spec §4.6.4, M4 X-21. 연속 시작 실패 수 파일과 안전 모드 제안 판정이다.

const dirs: string[] = [];
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-startup-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a start that never reached markStarted adds one to the failure count on the next start", () => {
  const dir = stateDir();
  expect(createFileStartupHealth(dir).beginStartup()).toBe(0);
  expect(createFileStartupHealth(dir).beginStartup()).toBe(1);
  expect(createFileStartupHealth(dir).beginStartup()).toBe(2);
});

test("a start abandoned for an environment problem adds nothing to the count", () => {
  const dir = stateDir();
  const first = createFileStartupHealth(dir);
  expect(first.beginStartup()).toBe(0);
  first.abandonStartup();
  expect(JSON.parse(readFileSync(join(dir, STARTUP_HEALTH_FILE), "utf8"))).toEqual({
    failures: 0,
    starting: false,
  });
  expect(createFileStartupHealth(dir).beginStartup()).toBe(0);
  expect(createFileStartupHealth(dir).beginStartup()).toBe(1);
});

test("an unfinished start before the environment problem still counts once", () => {
  const dir = stateDir();
  createFileStartupHealth(dir).beginStartup();
  const env = createFileStartupHealth(dir);
  expect(env.beginStartup()).toBe(1);
  env.abandonStartup();
  expect(createFileStartupHealth(dir).beginStartup()).toBe(1);
});

test("markStarted resets the count to zero", () => {
  const dir = stateDir();
  createFileStartupHealth(dir).beginStartup();
  createFileStartupHealth(dir).beginStartup();
  const store = createFileStartupHealth(dir);
  expect(store.beginStartup()).toBe(2);
  store.markStarted();
  expect(createFileStartupHealth(dir).beginStartup()).toBe(0);
});

test("a corrupt or missing file counts as no failures and the state directory is created", () => {
  const dir = join(stateDir(), "nested");
  expect(createFileStartupHealth(dir).beginStartup()).toBe(0);
  writeFileSync(join(dir, STARTUP_HEALTH_FILE), "{not json");
  expect(createFileStartupHealth(dir).beginStartup()).toBe(0);
  writeFileSync(join(dir, STARTUP_HEALTH_FILE), JSON.stringify({ failures: -4, starting: true }));
  expect(createFileStartupHealth(dir).beginStartup()).toBe(1);
});

test("an unwritable state directory does not stop the start", () => {
  const dir = stateDir();
  const blocker = join(dir, "file");
  writeFileSync(blocker, "x");
  expect(createFileStartupHealth(join(blocker, "state")).beginStartup()).toBe(0);
});

test("the file holds only the count and the in-progress mark", () => {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  createFileStartupHealth(dir).beginStartup();
  expect(JSON.parse(readFileSync(join(dir, STARTUP_HEALTH_FILE), "utf8"))).toEqual({
    failures: 0,
    starting: true,
  });
});

test("startupHealthOf suggests safe mode from the threshold unless safe mode is already on", () => {
  expect(startupHealthOf(2, 3, false)).toEqual({ failures: 2, suggestSafeMode: false });
  expect(startupHealthOf(3, 3, false)).toEqual({ failures: 3, suggestSafeMode: true });
  expect(startupHealthOf(5, 3, true)).toEqual({ failures: 5, suggestSafeMode: false });
});
