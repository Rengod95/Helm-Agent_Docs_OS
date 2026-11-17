import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import { createLocalIdFactory, systemRandom, type FileLock } from "@fresnel/platform-os";
import {
  migrateImplicitProjects,
  type MigrationThread,
} from "../../src/assembly/m4/implicit-project-migrate.ts";
import { deepestRoot, type ScopeRoot } from "../../src/assembly/m4/project-scope.ts";
import { createProjectStore, type ProjectStore } from "../../src/assembly/m4/project-store.ts";

// M5c §4.4.3과 §7.6. 대화 폴더가 어느 루트에도 없으면 그 폴더를 루트로 프로젝트를 만든다. 서로 포함하면 중첩으로 둔다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-implicit-"));
  roots.push(dir);
  return realpathSync(dir);
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NOW_MS = Date.parse("2026-01-05T00:00:00.000Z");
const clock = { now: () => NOW_MS };
const fileLock: FileLock = {
  scope: "process",
  withLock: async (_path, fn) => ok(await fn()),
  updateText: () => Promise.reject(new Error("updateText is not part of this test")),
};
const ids = createLocalIdFactory(clock, systemRandom());

function storeAt(configDir: string): ProjectStore {
  return createProjectStore({
    path: join(configDir, "projects.json"),
    fileLock,
    clock,
    signal: new AbortController().signal,
  });
}

/** 명시 프로젝트와 암묵 기본 폴더 루트. 포트의 `roots()`와 같은 모양이다 */
async function rootsOf(store: ProjectStore, dataDir: string): Promise<readonly ScopeRoot[]> {
  const snapshot = await store.read();
  if (!snapshot.ok) throw new Error("the project store must read");
  return [
    ...snapshot.value.projects.map((project) => ({
      projectId: project.projectId,
      root: project.root,
      name: project.name,
    })),
    { projectId: "prj_default", root: join(dataDir, "default-project"), name: null },
  ];
}

function idle(workspace: string | null): MigrationThread {
  return { workspace, status: "idle", testRun: false };
}

async function runWith(store: ProjectStore, dataDir: string, threads: readonly MigrationThread[]) {
  const done = await migrateImplicitProjects({
    threads,
    roots: await rootsOf(store, dataDir),
    projects: store,
    ids,
    clock,
  });
  if (!done.ok) throw new Error("the implicit project step must not fail here");
  return done.value;
}

test("each folder a conversation uses that no root holds becomes a project; nested folders both become projects and membership is the deepest root", async () => {
  const base = tempDir();
  const configDir = join(base, "config");
  const dataDir = join(base, "data");
  mkdirSync(configDir, { recursive: true });
  const store = storeAt(configDir);
  const outer = join(base, "work", "outer");
  const inner = join(outer, "inner");
  mkdirSync(join(inner, "deep"), { recursive: true });
  const explicitRoot = join(base, "work", "explicit");
  mkdirSync(join(explicitRoot, "sub"), { recursive: true });
  // 명시 프로젝트를 먼저 만든다. 그 안의 대화 폴더는 새 프로젝트가 되지 않는다
  const seeded = await store.transact((snapshot) =>
    ok({
      projects: [
        ...snapshot.projects,
        {
          projectId: "prj_explicit",
          name: "explicit",
          root: explicitRoot,
          createdAt: new Date(NOW_MS).toISOString(),
          rev: 1,
        },
      ],
      value: undefined,
    }),
  );
  expect(seeded.ok).toBe(true);

  // 기본 폴더 대화의 대화 폴더는 만들어져 있다(`defaultWorkspace`가 만든다)
  mkdirSync(join(dataDir, "default-project", "thr_x"), { recursive: true });
  const threads: MigrationThread[] = [
    idle(outer),
    idle(inner),
    idle(join(inner, "deep")),
    // 명시 프로젝트 안의 대화 폴더: 새로 만들지 않는다
    idle(join(explicitRoot, "sub")),
    // 기본 폴더 대화: 암묵 프로젝트에 이미 속한다
    idle(join(dataDir, "default-project", "thr_x")),
    // 닫힌 대화, 작업 폴더 없는 대화, Test run 대화는 건드리지 않는다
    { workspace: join(base, "closed"), status: "closed", testRun: false },
    { workspace: null, status: "idle", testRun: false },
    { workspace: join(base, "test-run"), status: "idle", testRun: true },
  ];
  const outcome = await runWith(store, dataDir, threads);

  expect(outcome.skipped).toEqual([]);
  expect(outcome.created.map((created) => created.root)).toEqual(
    [inner, join(inner, "deep"), outer].toSorted(),
  );
  const snapshot = await store.read();
  expect(
    snapshot.ok && snapshot.value.projects.map((project) => [project.name, project.root]),
  ).toEqual([
    ["explicit", explicitRoot],
    ["outer", outer],
    ["inner", inner],
    ["deep", join(inner, "deep")],
  ]);

  // 소속은 가장 깊은 루트다: deep 안의 대화는 deep 프로젝트에, inner 안의 대화는 inner에 속한다
  const all = await rootsOf(store, dataDir);
  expect(deepestRoot(join(inner, "deep", "x"), all)?.root).toBe(join(inner, "deep"));
  expect(deepestRoot(join(inner, "y"), all)?.root).toBe(inner);
  expect(deepestRoot(join(outer, "z"), all)?.root).toBe(outer);
  expect(deepestRoot(join(dataDir, "default-project", "thr_x"), all)?.projectId).toBe(
    "prj_default",
  );
});

test("a second run creates nothing and leaves projects.json as it was", async () => {
  const base = tempDir();
  const configDir = join(base, "config");
  const dataDir = join(base, "data");
  mkdirSync(configDir, { recursive: true });
  const store = storeAt(configDir);
  const folder = join(base, "work", "one");
  mkdirSync(folder, { recursive: true });
  const threads = [idle(folder), idle(folder)];

  await runWith(store, dataDir, threads);
  const first = readFileSync(join(configDir, "projects.json"), "utf8");
  const second = await runWith(store, dataDir, threads);

  expect(second).toEqual({ created: [], skipped: [] });
  expect(readFileSync(join(configDir, "projects.json"), "utf8")).toBe(first);
});

test("a folder that already has a project with the same root is not added again", async () => {
  const base = tempDir();
  const configDir = join(base, "config");
  const dataDir = join(base, "data");
  mkdirSync(configDir, { recursive: true });
  const store = storeAt(configDir);
  const folder = join(base, "work", "same");
  mkdirSync(folder, { recursive: true });
  // 같은 루트의 프로젝트가 옛 기록에 이미 있다고 하자
  writeFileSync(
    join(configDir, "projects.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        rev: 3,
        projects: [
          {
            projectId: "prj_same",
            name: "same",
            root: folder,
            createdAt: new Date(NOW_MS).toISOString(),
            rev: 1,
          },
        ],
      },
      null,
      2,
    ),
  );

  const outcome = await runWith(store, dataDir, [idle(folder)]);

  expect(outcome).toEqual({ created: [], skipped: [] });
  const snapshot = await store.read();
  expect(snapshot.ok && snapshot.value.projects.map((project) => project.projectId)).toEqual([
    "prj_same",
  ]);
});

test("a missing folder and a file are skipped and named in the outcome; nothing is created for them", async () => {
  const base = tempDir();
  const configDir = join(base, "config");
  const dataDir = join(base, "data");
  mkdirSync(configDir, { recursive: true });
  const store = storeAt(configDir);
  const present = join(base, "work", "present");
  mkdirSync(present, { recursive: true });
  const missing = join(base, "work", "gone");
  const file = join(base, "work", "note.txt");
  writeFileSync(file, "a file, not a folder");

  const outcome = await runWith(store, dataDir, [idle(missing), idle(file), idle(present)]);

  expect(outcome.created.map((created) => created.root)).toEqual([present]);
  expect(outcome.skipped).toEqual([
    { folder: missing, reason: "missing" },
    { folder: file, reason: "not_directory" },
  ]);
});
