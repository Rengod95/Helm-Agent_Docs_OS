import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@xeon/contracts";
import type { SessionService } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine, type SettingsEngine } from "../../src/assembly/settings-engine.ts";
import { createSettingsStore } from "../../src/assembly/settings-store.ts";
import type { ProjectTrust } from "../../src/assembly/trust.ts";
import type { SettingsChange, SettingsStorePort } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { openFileLock, type OpenedFileLock } from "../fixtures/file-lock.ts";
import { partial } from "../fixtures/unsafe.ts";

// M3-REQ-82, M3-REQ-49. 설정 파일 쓰기는 프로세스 사이 파일 잠금 안에서 일어나고, 파일 단위 읽기·쓰기는 해시로 덮어쓰기를 막고,
// 다른 프로세스가 바꾼 파일은 다시 읽어 바뀐 키만 알린다. 임시 디렉터리 위의 실제 파일과 실제 OS 잠금을 쓴다. 호스트 둘은 서비스 둘로 만든다:
// 같은 서비스 안의 잠금은 프로세스 안 표로 먼저 판정하지만 서비스가 다르면 OS 잠금(flock)이 막는다.

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};
const SIGNAL = new AbortController().signal;

const home = useEngineHome();
const cleanup: string[] = [];
const locks: OpenedFileLock[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await Promise.all(locks.splice(0).map((lock) => lock.dispose()));
  home.dispose();
});

interface Host {
  readonly store: SettingsStorePort;
  readonly engine: SettingsEngine;
  readonly changes: SettingsChange[];
}

interface Rig {
  readonly file: string;
  readonly root: string;
  host(): Promise<Host>;
}

async function rig(initial?: Readonly<Record<string, unknown>>): Promise<Rig> {
  const root = mkdtempSync(join(tmpdir(), "xh-sstore-"));
  cleanup.push(root);
  const configDir = join(root, "config");
  const file = join(configDir, "settings.json");
  if (initial !== undefined) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(file, JSON.stringify(initial));
  }
  return {
    file,
    root,
    async host() {
      const built = buildEngineCatalog();
      if (!built.ok) throw new Error("the core catalog must build");
      const engine = createSettingsEngine(built.catalog);
      await engine.loadUserFile(file);
      const opened = await openFileLock(root);
      locks.push(opened);
      const store = createSettingsStore({
        engine,
        session: partial<SessionService>({}),
        configDir,
        fileLock: opened.fileLock,
        trust: partial<ProjectTrust>({}),
        ids: fixedIdFactory(),
        logger: SILENT,
        signal: SIGNAL,
        holds: () => false,
      });
      const changes: SettingsChange[] = [];
      store.onChange((change) => changes.push(change));
      return { store, engine, changes };
    },
  };
}

function fileValues(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("expected an object");
  return Object.fromEntries(Object.entries(parsed));
}

test("two hosts writing different keys at the same time keep every key (the file lock serializes read-modify-write)", async () => {
  const fx = await rig({ "ext.keep.me": { stay: true } });
  const a = await fx.host();
  const b = await fx.host();
  const count = 24;
  const writes = Array.from({ length: count }, (_, index) =>
    (index % 2 === 0 ? a : b).store.write("user", `ext.race.k${String(index)}`, index, undefined),
  );
  const results = await Promise.all(writes);
  expect(results.every((result) => result.ok)).toBe(true);
  const expected: Record<string, unknown> = { "ext.keep.me": { stay: true } };
  for (let index = 0; index < count; index += 1) expected[`ext.race.k${String(index)}`] = index;
  expect(fileValues(fx.file)).toEqual(expected);
  expect(statSync(fx.file).mode & 0o777).toBe(0o600);
});

test("a write that cannot get the lock in time fails with file_unwritable and leaves the file as it was", async () => {
  const fx = await rig({ "ext.keep.me": 1 });
  const holder = await openFileLock(fx.root);
  locks.push(holder);
  const abort = new AbortController();
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const engine = createSettingsEngine(built.catalog);
  await engine.loadUserFile(fx.file);
  const waiter = await openFileLock(fx.root);
  locks.push(waiter);
  const store = createSettingsStore({
    engine,
    session: partial<SessionService>({}),
    configDir: join(fx.root, "config"),
    fileLock: waiter.fileLock,
    trust: partial<ProjectTrust>({}),
    ids: fixedIdFactory(),
    logger: SILENT,
    signal: abort.signal,
    holds: () => false,
  });
  const gate = Promise.withResolvers<void>();
  const held = gate.promise;
  const entered = new Promise<void>((resolve) => {
    void holder.fileLock.withLock(fx.file, () => {
      resolve();
      return held;
    });
  });
  await entered;
  const pending = store.write("user", "ext.blocked.key", 1, undefined);
  abort.abort();
  const result = await pending;
  gate.resolve();
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "file_unwritable", code: "LOCK_CANCELLED" },
  });
  expect(fileValues(fx.file)).toEqual({ "ext.keep.me": 1 });
});

test("readFile reports a missing file, and writeFile creates it only from a null base hash", async () => {
  const fx = await rig();
  const { store, engine, changes } = await fx.host();
  const missing = await store.readFile("user", undefined);
  expect(missing).toEqual({
    ok: true,
    value: { path: fx.file, exists: false, readOnly: false, text: "", sha256: null },
  });
  const managed = await store.readFile("managed", undefined);
  expect(managed).toEqual({
    ok: true,
    value: { path: null, exists: false, readOnly: true, text: "", sha256: null },
  });
  const text = '{"l1.loop.maxSteps":7,"ext.unknown":{"a":1}}\n';
  const created = await store.writeFile("user", text, null, undefined);
  if (!created.ok) throw new Error(`write failed: ${created.error.kind}`);
  expect(readFileSync(fx.file, "utf8")).toBe(text);
  expect(created.value.path).toBe(fx.file);
  expect(engine.value("l1.loop.maxSteps")).toBe(7);
  expect(changes).toEqual([
    { keys: ["ext.unknown", "l1.loop.maxSteps"], scopes: ["user"], threadId: null },
  ]);
  const again = await store.writeFile("user", text, null, undefined);
  expect(again).toEqual({ ok: false, error: { kind: "conflict", scope: "user" } });
  const read = await store.readFile("user", undefined);
  if (!read.ok) throw new Error("read failed");
  expect(read.value.sha256).toBe(created.value.sha256);
  expect(read.value.text).toBe(text);
});

test("writeFile refuses to overwrite a file that changed after it was read", async () => {
  const fx = await rig({ "l1.loop.maxSteps": 3 });
  const { store } = await fx.host();
  const read = await store.readFile("user", undefined);
  if (!read.ok) throw new Error("read failed");
  writeFileSync(fx.file, '{"l1.loop.maxSteps":9}');
  const refused = await store.writeFile(
    "user",
    '{"l1.loop.maxSteps":4}',
    read.value.sha256,
    undefined,
  );
  expect(refused).toEqual({ ok: false, error: { kind: "conflict", scope: "user" } });
  expect(readFileSync(fx.file, "utf8")).toBe('{"l1.loop.maxSteps":9}');
});

test("refreshUserFile reads another process's change and reports only the keys that changed", async () => {
  const fx = await rig({ "l1.loop.maxSteps": 3, "ext.same": "x" });
  const { store, engine, changes } = await fx.host();
  writeFileSync(
    fx.file,
    JSON.stringify({ "l1.loop.maxSteps": 8, "ext.same": "x", "ext.added": 1 }),
  );
  await store.refreshUserFile();
  expect(engine.value("l1.loop.maxSteps")).toBe(8);
  expect(changes).toEqual([
    { keys: ["ext.added", "l1.loop.maxSteps"], scopes: ["user"], threadId: null },
  ]);
  // 같은 내용을 다시 읽으면 알리지 않는다(우리 쓰기의 되울림도 같은 경로다)
  await store.refreshUserFile();
  expect(changes).toHaveLength(1);
});

test("refreshUserFile keeps the previous values while the file is not valid JSON", async () => {
  const fx = await rig({ "l1.loop.maxSteps": 3 });
  const { store, engine, changes } = await fx.host();
  writeFileSync(fx.file, "{ half an edit");
  await store.refreshUserFile();
  expect(engine.value("l1.loop.maxSteps")).toBe(3);
  expect(changes).toEqual([]);
  writeFileSync(fx.file, "[1,2]");
  await store.refreshUserFile();
  expect(engine.value("l1.loop.maxSteps")).toBe(3);
  expect(changes).toEqual([]);
});
