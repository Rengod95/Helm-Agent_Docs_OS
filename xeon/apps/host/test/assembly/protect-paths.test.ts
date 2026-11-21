import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, type Logger } from "@fresnel/contracts";
import type { SessionService } from "@fresnel/contracts/records";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { protectPathsStoreOf } from "../../src/assembly/protect-paths.ts";
import { createSettingsEngine, type SettingsEngine } from "../../src/assembly/settings-engine.ts";
import { createSettingsStore } from "../../src/assembly/settings-store.ts";
import type { ProjectTrust } from "../../src/assembly/trust.ts";
import type { SettingsStorePort } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { openFileLock, type OpenedFileLock } from "../fixtures/file-lock.ts";
import { partial } from "../fixtures/unsafe.ts";

// [제안, AGE-63] 모델 도구 `sandbox_protect`의 설정 쓰기. 실제 설정 저장소와 임시 설정 폴더를 쓴다. 쓰는 곳은 사용자 설정 파일 하나다.
// 프로젝트 폴더의 `.fresnel/settings.json`은 바뀌지 않는다.

const KEY = "l0.sandbox.protectedPaths.extra";
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

interface Fixture {
  readonly file: string;
  readonly project: string;
  readonly projectFile: string;
  readonly engine: SettingsEngine;
  readonly store: SettingsStorePort;
}

async function fixture(initial: Readonly<Record<string, unknown>>): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "xh-protect-"));
  cleanup.push(root);
  const configDir = join(root, "config");
  const file = join(configDir, "settings.json");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(file, JSON.stringify(initial));
  // 신뢰하지 않는 프로젝트 폴더에 든 파일. 사용자 쓰기가 이것을 건드리면 안 된다
  const project = join(root, "project");
  mkdirSync(join(project, ".fresnel"), { recursive: true });
  const projectFile = join(project, ".fresnel", "settings.json");
  writeFileSync(projectFile, JSON.stringify({ [KEY]: ["/from-project"] }));
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
  return { file, project, projectFile, engine, store };
}

function userFile(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("expected an object");
  return Object.fromEntries(Object.entries(parsed));
}

test("adds to the user list, keeps the other keys, and leaves the project file alone", async () => {
  const fx = await fixture({ [KEY]: ["~/old"], "other.key": 7 });
  const projectBefore = readFileSync(fx.projectFile, "utf8");
  const port = protectPathsStoreOf(fx.engine, () => fx.store);
  expect(port.current()).toEqual(["~/old"]);
  const added = await port.add(["~/vault"]);
  expect(added).toEqual({ ok: true, value: ["~/old", "~/vault"] });
  expect(userFile(fx.file)).toEqual({ [KEY]: ["~/old", "~/vault"], "other.key": 7 });
  expect(port.current()).toEqual(["~/old", "~/vault"]);
  expect(readFileSync(fx.projectFile, "utf8")).toBe(projectBefore);
});

test("a value already in the list is kept once", async () => {
  const fx = await fixture({ [KEY]: ["~/old"] });
  const port = protectPathsStoreOf(fx.engine, () => fx.store);
  const out = await port.add(["~/old", "~/new"]);
  expect(out).toEqual({ ok: true, value: ["~/old", "~/new"] });
  expect(userFile(fx.file)[KEY]).toEqual(["~/old", "~/new"]);
});

test("a list already at the 256 limit refuses one more entry and writes nothing", async () => {
  const full = Array.from({ length: 256 }, (_, index) => `/p/${String(index)}`);
  const fx = await fixture({ [KEY]: full });
  const before = readFileSync(fx.file, "utf8");
  const out = await protectPathsStoreOf(fx.engine, () => fx.store).add(["/one-more"]);
  expect(out).toEqual(err({ kind: "invalid_value" }));
  expect(readFileSync(fx.file, "utf8")).toBe(before);
});

test("a stored value that is not a list of paths refuses and is not overwritten", async () => {
  const fx = await fixture({ [KEY]: "not-a-list" });
  const before = readFileSync(fx.file, "utf8");
  const port = protectPathsStoreOf(fx.engine, () => fx.store);
  expect(port.current()).toEqual([]);
  expect(await port.add(["/x"])).toEqual(err({ kind: "invalid_value" }));
  expect(readFileSync(fx.file, "utf8")).toBe(before);
});

test("a managed value for the key refuses as locked, and nothing is written", async () => {
  const fx = await fixture({});
  const managed: SettingsEngine = {
    ...fx.engine,
    layers: (threadId) => [
      { scope: "managed", values: new Map([[KEY, ["/from-managed"]]]) },
      ...fx.engine.layers(threadId),
    ],
  };
  const before = readFileSync(fx.file, "utf8");
  expect(await protectPathsStoreOf(managed, () => fx.store).add(["/x"])).toEqual(
    err({ kind: "locked" }),
  );
  expect(readFileSync(fx.file, "utf8")).toBe(before);
});

test("without a settings store the add is unavailable", async () => {
  const fx = await fixture({});
  expect(await protectPathsStoreOf(fx.engine, () => undefined).add(["/x"])).toEqual(
    err({ kind: "unavailable" }),
  );
});

test("a failed file write reports the OS code and nothing is kept in memory", async () => {
  const fx = await fixture({ [KEY]: ["~/old"] });
  const failing = partial<SettingsStorePort>({
    write: () => Promise.resolve(err({ kind: "file_unwritable", path: fx.file, code: "EACCES" })),
  });
  const port = protectPathsStoreOf(fx.engine, () => failing);
  expect(await port.add(["~/vault"])).toEqual(err({ kind: "store_failed", code: "EACCES" }));
  expect(port.current()).toEqual(["~/old"]);
});
