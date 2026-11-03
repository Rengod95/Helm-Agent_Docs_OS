import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createRepeatDisableLedger } from "@fresnel/ext-host";
import { keepOffQuestionOf } from "../../src/assembly/m4/ext-read-sources.ts";
import { createLateFileBackend } from "../../src/assembly/repeat-disable-store.ts";

// 결정 2026-11-04 B5. 반복 자동 끄기 질문 판정과, 시작을 넘어 횟수를 남기는 파일 백엔드.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("the question needs the threshold, a current auto-disable, and an extension the user has not already switched off", () => {
  const asked = { disabledStarts: 3, autoDisabledNow: true, enabledSetting: undefined };
  expect(keepOffQuestionOf(asked)).toEqual({ disabledStarts: 3 });
  expect(keepOffQuestionOf({ ...asked, enabledSetting: true })).toEqual({ disabledStarts: 3 });
  expect(keepOffQuestionOf({ ...asked, disabledStarts: null })).toBeNull();
  expect(keepOffQuestionOf({ ...asked, autoDisabledNow: false })).toBeNull();
  expect(keepOffQuestionOf({ ...asked, enabledSetting: false })).toBeNull();
});

test("auto-disables counted in three separate starts survive restarts in the state file, and nothing writes enabled=false", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repeat-disable-"));
  dirs.push(dir);
  const path = join(dir, "ext-auto-disable.json");
  const startOnce = async () => {
    const backend = createLateFileBackend();
    backend.bind(path);
    const ledger = createRepeatDisableLedger({ backend });
    await ledger.load();
    ledger.recordAutoDisable("flaky");
    await ledger.flush();
    return ledger;
  };
  await startOnce();
  await startOnce();
  const third = await startOnce();
  expect(third.question("flaky")).toEqual({ name: "flaky", disabledStarts: 3 });
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    schemaVersion: 1,
    starts: { flaky: 3 },
  });
  // 손상된 파일은 빈 상태로 시작한다
  writeFileSync(path, "{broken");
  const fresh = await startOnce();
  expect(fresh.question("flaky")).toBeNull();
});
