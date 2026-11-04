import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import {
  createExtTestRecordStore,
  EXT_TEST_RECORD_CAP,
  type ExtTestRecordStore,
} from "../../src/assembly/m4/test-record-store.ts";
import { openFileLock, type OpenedFileLock } from "../fixtures/file-lock.ts";

// 시험 기록 저장소(`assembly/m4/test-record-store.ts`, W-29). 파일 하나를 실제 OS 파일 잠금 아래에서 읽고 쓴다.
// 없는 파일은 빈 목록, 중단된 기록은 다음 프로세스의 첫 읽기에서 `failed`로 바뀌어 저장되고, 손상된 파일은 덮어쓰지 않으며,
// 상한 500개를 넘으면 오래된 것부터 버린다.

const root = mkdtempSync(join(tmpdir(), "ext-test-store-"));
const locks: OpenedFileLock[] = [];
afterAll(async () => {
  await Promise.all(locks.map((lock) => lock.dispose()));
  rmSync(root, { recursive: true, force: true });
});

let counter = 0;
/** 서로 다른 설정 폴더를 쓰는 시험마다 새 폴더를 준다 */
function fileFor(): { readonly dir: string; readonly path: string } {
  counter += 1;
  const dir = join(root, `case-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  return { dir, path: join(dir, "ext-tests.json") };
}

async function storeAt(path: string): Promise<ExtTestRecordStore> {
  const opened = await openFileLock(root);
  locks.push(opened);
  return createExtTestRecordStore({
    path,
    fileLock: opened.fileLock,
    signal: new AbortController().signal,
  });
}

function record(testId: string, state: ExtTestRecord["state"] = "running"): ExtTestRecord {
  return {
    testId,
    kind: "testRun",
    target: "demo",
    state,
    startedAt: "2026-11-04T00:00:00.000Z",
    durationMs: null,
    threadId: null,
    replay: null,
  };
}

test("a missing file lists nothing and a read does not create the file", async () => {
  const { path } = fileFor();
  const store = await storeAt(path);
  const listed = await store.list();
  expect(listed).toEqual({ ok: true, value: [] });
  expect(existsSync(path)).toBe(false);
});

test("a begun record is kept as written, and finishing it replaces its state, duration and report", async () => {
  const { path } = fileFor();
  const store = await storeAt(path);
  expect(await store.begin(record("t-1"))).toEqual({ ok: true, value: undefined });
  const finished = await store.finish("t-1", { state: "failed", durationMs: 42, replay: null });
  expect(finished).toEqual({
    ok: true,
    value: { ...record("t-1"), state: "failed", durationMs: 42, replay: null },
  });
  const listed = await store.list();
  expect(listed).toEqual({
    ok: true,
    value: [{ ...record("t-1"), state: "failed", durationMs: 42, replay: null }],
  });
  const onDisk = parseJson(readFileSync(path, "utf8"));
  expect(onDisk).toEqual({
    ok: true,
    value: { schemaVersion: 1, tests: [{ ...record("t-1"), state: "failed", durationMs: 42 }] },
  });
});

test("the first read in a new process marks the records still running from the last process as failed and saves that", async () => {
  const { path } = fileFor();
  const earlier = await storeAt(path);
  await earlier.begin(record("t-old"));
  await earlier.begin(record("t-done"));
  await earlier.finish("t-done", { state: "passed", durationMs: 7, replay: null });
  // 새 프로세스: 다른 저장소 인스턴스가 처음 읽는다
  const later = await storeAt(path);
  const listed = await later.list();
  expect(listed).toEqual({
    ok: true,
    value: [
      { ...record("t-old"), state: "failed", durationMs: null },
      { ...record("t-done"), state: "passed", durationMs: 7 },
    ],
  });
  // 고친 것이 파일에 남았다(다음 읽기는 바꿀 것이 없다)
  const onDisk = parseJson(readFileSync(path, "utf8"));
  expect(onDisk).toEqual({
    ok: true,
    value: {
      schemaVersion: 1,
      tests: [
        { ...record("t-old"), state: "failed", durationMs: null },
        { ...record("t-done"), state: "passed", durationMs: 7 },
      ],
    },
  });
});

test("a record begun in this process is not treated as interrupted by its own later reads", async () => {
  const { path } = fileFor();
  const store = await storeAt(path);
  await store.begin(record("t-live"));
  expect(await store.list()).toEqual({ ok: true, value: [record("t-live")] });
});

test("a corrupt file is an error value and is never overwritten", async () => {
  const { path } = fileFor();
  writeFileSync(path, "{ not json");
  const store = await storeAt(path);
  const listed = await store.list();
  expect(listed).toEqual({
    ok: false,
    error: { kind: "corrupt", path, reason: "not JSON" },
  });
  expect(await store.begin(record("t-1"))).toMatchObject({ ok: false, error: { kind: "corrupt" } });
  expect(await store.finish("t-1", { state: "passed", durationMs: 1, replay: null })).toMatchObject(
    { ok: false, error: { kind: "corrupt" } },
  );
  expect(readFileSync(path, "utf8")).toBe("{ not json");
});

test("a file of another schema version or with an unknown key is corrupt and is kept as it is", async () => {
  const { path } = fileFor();
  const text = `${JSON.stringify({ schemaVersion: 2, tests: [] })}\n`;
  writeFileSync(path, text);
  const store = await storeAt(path);
  const listed = await store.list();
  expect(listed).toMatchObject({ ok: false, error: { kind: "corrupt" } });
  expect(readFileSync(path, "utf8")).toBe(text);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, tests: [], extra: true })}\n`);
  expect(await store.list()).toMatchObject({ ok: false, error: { kind: "corrupt" } });
});

test("a record that does not match the wire shape makes the file corrupt", async () => {
  const { path } = fileFor();
  writeFileSync(
    path,
    `${JSON.stringify({ schemaVersion: 1, tests: [{ ...record("t-x"), state: "queued" }] })}\n`,
  );
  const store = await storeAt(path);
  expect(await store.list()).toMatchObject({ ok: false, error: { kind: "corrupt" } });
});

test("the list keeps at most 500 records, dropping the oldest first", async () => {
  const { path } = fileFor();
  // 상한에 닿은 파일(500개)을 먼저 둔다. 그 뒤 한 개를 더하면 가장 오래된 것이 빠진다
  const full = Array.from({ length: EXT_TEST_RECORD_CAP }, (_, index) =>
    record(`t-${String(index).padStart(4, "0")}`, "passed"),
  );
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, tests: full })}\n`);
  const store = await storeAt(path);
  expect(await store.begin(record("t-new"))).toEqual({ ok: true, value: undefined });
  const listed = await store.list();
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  expect(listed.value).toHaveLength(EXT_TEST_RECORD_CAP);
  expect(listed.value[0]?.testId).toBe("t-0001");
  expect(listed.value.at(-1)?.testId).toBe("t-new");
});

test("finishing a record that was dropped or never existed is not_found", async () => {
  const { path } = fileFor();
  const store = await storeAt(path);
  await store.begin(record("t-1"));
  expect(await store.finish("t-missing", { state: "passed", durationMs: 1, replay: null })).toEqual(
    { ok: false, error: { kind: "not_found", testId: "t-missing" } },
  );
});

test("concurrent updates from two processes' locks all land in the file", async () => {
  const { path } = fileFor();
  const first = await storeAt(path);
  const second = await storeAt(path);
  const ids = Array.from({ length: 12 }, (_, index) => `c-${String(index).padStart(2, "0")}`);
  const results = await Promise.all(
    ids.map((id, index) => (index % 2 === 0 ? first : second).begin(record(id))),
  );
  expect(results.every((result) => result.ok)).toBe(true);
  // 쓰는 순서는 잠금을 얻는 순서라 정해지지 않는다. 모두 들어갔는지만 본다
  const listed = await first.list();
  expect(listed.ok ? listed.value.map((item) => item.testId).toSorted() : null).toEqual(ids);
});
