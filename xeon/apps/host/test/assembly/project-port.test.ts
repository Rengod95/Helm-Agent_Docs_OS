import { afterAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import { isLocalId, type ThreadId } from "@fresnel/contracts/conversation";
import { PROJECT_ID_PATTERN } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createLocalIdFactory, systemRandom, type FileLock } from "@fresnel/platform-os";
import { createProjectPort, type ProjectThreadRow } from "../../src/assembly/m4/project-port.ts";
import { DEFAULT_PROJECT_ID } from "../../src/assembly/m4/project-scope.ts";
import { DEFAULT_PROJECT_FOLDER_NAME } from "../../src/settings.ts";

// review m5 §4.4.1~§4.4.7. 실제 임시 폴더를 루트로 쓴다. 사용자 폴더는 건드리지 않는다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-project-port-"));
  roots.push(dir);
  // 비교용 정규 경로(macOS의 임시 폴더는 심볼릭 링크 아래에 있다)
  return realpathSync(dir);
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NOW = Date.parse("2026-01-05T00:00:00.000Z");
const fileLock: FileLock = {
  scope: "process",
  withLock: async (_path, fn) => ok(await fn()),
  updateText: () => Promise.reject(new Error("updateText is not part of this test")),
};
const ids = fixedIdFactory(700);

interface RigOptions {
  /** 대화 목록 원천. 생략하면 대화가 없다 */
  readonly threads?: readonly ProjectThreadRow[];
}

/** 포트를 만든다. 같은 `configDir`로 다시 만들면 재시작과 같다. `settings`는 시험이 바꾼다 */
function rigAt(configDir: string, dataDir: string, options: RigOptions = {}) {
  const settings: Record<string, unknown> = {};
  const clock = { now: () => NOW };
  const port = createProjectPort({
    configDir,
    dataDir,
    fileLock,
    clock,
    signal: new AbortController().signal,
    ids: createLocalIdFactory(clock, systemRandom()),
    settingValue: (key) => settings[key],
    threadRows: () => options.threads ?? [],
    report: () => undefined,
  });
  return { configDir, dataDir, settings, port };
}

function freshRig() {
  const base = tempDir();
  return rigAt(join(base, "config"), join(base, "data"));
}

function threadOf(
  threadId: ThreadId,
  workspace: string | null,
  overrides: Partial<ProjectThreadRow> = {},
): ProjectThreadRow {
  return {
    threadId,
    workspace,
    status: "idle",
    profileId: null,
    updatedAt: 1,
    testRun: false,
    craftChat: false,
    ...overrides,
  };
}

/** 실패 값의 kind. 성공이면 "ok"다 */
function failureKindOf(result: { readonly ok: boolean; readonly error?: unknown }): unknown {
  if (result.ok) return "ok";
  const error = result.error;
  return typeof error === "object" && error !== null && "kind" in error ? error.kind : undefined;
}

// ── 만들기, 중복, 잘못된 루트 ───────────────────────────────────────────

test("create stores the canonical root, names it after the folder by default, and gives a prj_ id", async () => {
  const rig = freshRig();
  const folder = join(tempDir(), "my-app");
  mkdirSync(folder);
  const created = await rig.port.create({ root: folder });
  if (!created.ok) throw new Error("create must succeed");
  expect(created.value.root).toBe(realpathSync(folder));
  expect(created.value.name).toBe("my-app");
  expect(created.value.rev).toBe(1);
  expect(created.value.projectId).toMatch(new RegExp(PROJECT_ID_PATTERN));
  expect(isLocalId("prj", created.value.projectId)).toBe(true);
});

test("create with an explicit name keeps it", async () => {
  const rig = freshRig();
  const created = await rig.port.create({ root: tempDir(), name: "Billing" });
  expect(created.ok && created.value.name).toBe("Billing");
});

test("a second create for the same canonical root, even through a symlink, is project.exists", async () => {
  const rig = freshRig();
  const folder = tempDir();
  const alias = join(tempDir(), "alias");
  symlinkSync(folder, alias);
  expect((await rig.port.create({ root: folder })).ok).toBe(true);
  expect(failureKindOf(await rig.port.create({ root: alias }))).toBe("exists");
  expect(failureKindOf(await rig.port.create({ root: folder }))).toBe("exists");
});

test("a relative path, a missing folder and a plain file are all root_invalid", async () => {
  const rig = freshRig();
  const file = join(tempDir(), "file.txt");
  writeFileSync(file, "x");
  expect(failureKindOf(await rig.port.create({ root: "relative/dir" }))).toBe("root_invalid");
  expect(failureKindOf(await rig.port.create({ root: join(tempDir(), "missing") }))).toBe(
    "root_invalid",
  );
  expect(failureKindOf(await rig.port.create({ root: file }))).toBe("root_invalid");
});

test("nested roots are allowed: a root inside another root is a separate project", async () => {
  const rig = freshRig();
  const outer = tempDir();
  const inner = join(outer, "inner");
  mkdirSync(inner);
  expect((await rig.port.create({ root: outer })).ok).toBe(true);
  expect((await rig.port.create({ root: inner })).ok).toBe(true);
});

// ── 이름, 삭제, 목록 ────────────────────────────────────────────────────

test("rename changes the name and bumps the project's rev; an unknown id is not_found", async () => {
  const rig = freshRig();
  const created = await rig.port.create({ root: tempDir() });
  if (!created.ok) throw new Error("create must succeed");
  const renamed = await rig.port.rename({ projectId: created.value.projectId, name: "New" });
  expect(renamed.ok && renamed.value).toMatchObject({ name: "New", rev: 2 });
  expect(failureKindOf(await rig.port.rename({ projectId: "prj_missing", name: "x" }))).toBe(
    "not_found",
  );
});

test("delete forgets the project record but keeps the folder, and a second delete is not_found", async () => {
  const rig = freshRig();
  const folder = tempDir();
  const created = await rig.port.create({ root: folder });
  if (!created.ok) throw new Error("create must succeed");
  expect((await rig.port.remove(created.value.projectId)).ok).toBe(true);
  expect(existsSync(folder)).toBe(true);
  expect(failureKindOf(await rig.port.get(created.value.projectId))).toBe("not_found");
  expect(failureKindOf(await rig.port.remove(created.value.projectId))).toBe("not_found");
});

test("list counts open threads inside each root, running ones apart, and leaves out closed, test run, craft and default folder threads", async () => {
  const base = tempDir();
  const project = join(base, "app");
  mkdirSync(join(project, "sub"), { recursive: true });
  const rig = rigAt(join(base, "config"), join(base, "data"), {
    threads: [
      threadOf(ids.next("thr"), join(project, "sub")),
      threadOf(ids.next("thr"), project, { status: "running" }),
      threadOf(ids.next("thr"), project, { status: "closed" }),
      threadOf(ids.next("thr"), project, { testRun: true }),
      // 테스트 대화(Craft)는 프로젝트 묶음에 들지 않는다(M5c §4.8.3)
      threadOf(ids.next("thr"), project, { craftChat: true, status: "running" }),
      threadOf(ids.next("thr"), join(base, "data", DEFAULT_PROJECT_FOLDER_NAME, "t1")),
      threadOf(ids.next("thr"), join(base, "elsewhere")),
      threadOf(ids.next("thr"), null),
    ],
  });
  const created = await rig.port.create({ root: project });
  if (!created.ok) throw new Error("create must succeed");
  const listed = await rig.port.list();
  expect(listed.ok && listed.value.projects).toEqual([
    { ...created.value, threadCount: 2, runningCount: 1 },
  ]);
});

test("the list survives a restart: a new port on the same config folder reads the same projects", async () => {
  const base = tempDir();
  const first = rigAt(join(base, "config"), join(base, "data"));
  const created = await first.port.create({ root: tempDir(), name: "kept" });
  if (!created.ok) throw new Error("create must succeed");
  const second = rigAt(join(base, "config"), join(base, "data"));
  const listed = await second.port.list();
  expect(listed.ok && listed.value.projects.map((project) => project.projectId)).toEqual([
    created.value.projectId,
  ]);
});

// ── 지침 파일 ───────────────────────────────────────────────────────────

test("instructions lists AGENTS.md from the root down to the working folder, root first, with bytes and the size limit", async () => {
  const base = tempDir();
  const project = join(base, "app");
  const deep = join(project, "pkg", "deep");
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(project, "AGENTS.md"), "root rules\n");
  writeFileSync(join(project, "pkg", "AGENTS.md"), "x".repeat(40));
  writeFileSync(join(deep, "AGENTS.md"), "deep\n");
  writeFileSync(join(project, "CLAUDE.md"), "not read");
  const rig = rigAt(join(base, "config"), join(base, "data"));
  rig.settings["l1.context.instructionFiles.maxBytes"] = 20;
  await rig.port.create({ root: project });
  const result = await rig.port.instructions(deep);
  expect(result.ok && result.value.files).toEqual([
    { path: "AGENTS.md", bytes: 11, included: true },
    { path: "pkg/AGENTS.md", bytes: 40, included: false },
    { path: "pkg/deep/AGENTS.md", bytes: 5, included: true },
  ]);
});

test("a symlink to an AGENTS.md outside the root is listed as not included with no bytes", async () => {
  const base = tempDir();
  const project = join(base, "app");
  mkdirSync(project);
  const outside = join(base, "outside.md");
  writeFileSync(outside, "secret outside");
  symlinkSync(outside, join(project, "AGENTS.md"));
  const rig = rigAt(join(base, "config"), join(base, "data"));
  await rig.port.create({ root: project });
  const result = await rig.port.instructions(project);
  expect(result.ok && result.value.files).toEqual([
    { path: "AGENTS.md", bytes: 0, included: false },
  ]);
});

test("instructions for a folder in no project is root_invalid", async () => {
  const rig = freshRig();
  expect(failureKindOf(await rig.port.instructions(tempDir()))).toBe("root_invalid");
});

// ── 기본 폴더와 자동 프로젝트 ───────────────────────────────────────────

test("defaultWorkspace makes <data folder>/default-project/<threadId> and returns its canonical path", async () => {
  const rig = freshRig();
  const threadId = ids.next("thr");
  const made = await rig.port.defaultWorkspace(threadId);
  const expected = join(rig.dataDir, DEFAULT_PROJECT_FOLDER_NAME, threadId);
  expect(existsSync(expected)).toBe(true);
  expect(made.ok && made.value).toBe(realpathSync(expected));
});

test("a configured default folder is used instead, and a relative one is root_invalid", async () => {
  const base = tempDir();
  const custom = join(base, "custom-home");
  const rig = rigAt(join(base, "config"), join(base, "data"));
  rig.settings["l4.host.defaultFolder"] = custom;
  const made = await rig.port.defaultWorkspace(ids.next("thr"));
  expect(made.ok && made.value.startsWith(realpathSync(custom))).toBe(true);
  rig.settings["l4.host.defaultFolder"] = "relative/folder";
  expect(failureKindOf(await rig.port.defaultWorkspace(ids.next("thr")))).toBe("root_invalid");
});

test("attach makes a project for a folder that is in no root, and a folder inside it reuses that project", async () => {
  const rig = freshRig();
  const workspace = join(tempDir(), "fresh");
  mkdirSync(workspace);
  const canonical = realpathSync(workspace);
  const first = await rig.port.attach(canonical);
  expect(first.ok && first.value?.name).toBe("fresh");
  const again = await rig.port.attach(canonical);
  expect(again.ok && again.value?.projectId).toBe(first.ok ? first.value?.projectId : undefined);
  const listed = await rig.port.list();
  expect(listed.ok && listed.value.projects).toHaveLength(1);
  const inside = join(canonical, "sub");
  mkdirSync(inside);
  const nested = await rig.port.attach(realpathSync(inside));
  expect(nested.ok && nested.value?.projectId).toBe(first.ok ? first.value?.projectId : undefined);
});

test("attach gives null for a folder in the default folder and creates no project for it", async () => {
  const rig = freshRig();
  const made = await rig.port.defaultWorkspace(ids.next("thr"));
  if (!made.ok) throw new Error("the default folder must be made");
  expect(await rig.port.attach(made.value)).toEqual(ok(null));
  const listed = await rig.port.list();
  expect(listed.ok && listed.value.projects).toEqual([]);
});

test("roots lists the explicit projects first and the implicit default folder project last", async () => {
  const rig = freshRig();
  const created = await rig.port.create({ root: tempDir(), name: "explicit" });
  const roots = await rig.port.roots();
  if (!created.ok || !roots.ok) throw new Error("create and roots must succeed");
  expect(roots.value.map((root) => root.projectId)).toEqual([
    created.value.projectId,
    DEFAULT_PROJECT_ID,
  ]);
});

// ── 프로필 기본값의 원천(§4.4.8) ─────────────────────────────────────────

test("recentThread leaves a craft thread out, so a craft thread in the folder does not change the profile default", async () => {
  const base = tempDir();
  const folder = join(base, "app");
  mkdirSync(folder);
  const canonical = realpathSync(folder);
  const normal = ids.next("thr");
  const rig = rigAt(join(base, "config"), join(base, "data"), {
    threads: [
      threadOf(normal, canonical, { updatedAt: 5, profileId: "review" }),
      threadOf(ids.next("thr"), canonical, { updatedAt: 9, profileId: "craft", craftChat: true }),
    ],
  });
  const picked = await rig.port.recentThread(canonical);
  expect(picked.ok && picked.value?.threadId).toBe(normal);
  expect(picked.ok && picked.value?.profileId).toBe("review");
  const overall = await rig.port.recentThread(undefined);
  expect(overall.ok && overall.value?.threadId).toBe(normal);
});

test("recentThread follows the recency of activity, not the order the rows were given in", async () => {
  const base = tempDir();
  const folder = join(base, "app");
  mkdirSync(folder);
  const canonical = realpathSync(folder);
  const older = ids.next("thr");
  const newer = ids.next("thr");
  const rig = rigAt(join(base, "config"), join(base, "data"), {
    threads: [
      threadOf(older, canonical, { updatedAt: 5, profileId: "old" }),
      threadOf(newer, canonical, { updatedAt: 9, profileId: "new" }),
    ],
  });
  const picked = await rig.port.recentThread(canonical);
  expect(picked.ok && picked.value?.threadId).toBe(newer);
  expect(picked.ok && picked.value?.profileId).toBe("new");
  const overall = await rig.port.recentThread(undefined);
  expect(overall.ok && overall.value?.threadId).toBe(newer);
});

test("recentThread with a relative workspace is a workspace failure, the same as the thread.create folder error", async () => {
  const rig = freshRig();
  expect(failureKindOf(await rig.port.recentThread("relative"))).toBe("workspace");
});

test("rootOfWorkspace gives the deepest project root, the default folder for a default-folder workspace, and nothing outside", async () => {
  const base = tempDir();
  const project = join(base, "app");
  mkdirSync(join(project, "sub"), { recursive: true });
  const rig = rigAt(join(base, "config"), join(base, "data"));
  await rig.port.create({ root: project });
  // 동기 원천의 값은 마지막 읽기 결과다. 읽기 한 번으로 채운다
  await rig.port.roots();
  expect(rig.port.rootOfWorkspace(join(project, "sub"))).toBe(project);
  expect(rig.port.rootOfWorkspace(join(base, "elsewhere"))).toBeUndefined();
  const made = await rig.port.defaultWorkspace(ids.next("thr"));
  if (!made.ok) throw new Error("the default folder must be made");
  await rig.port.roots();
  expect(rig.port.rootOfWorkspace(made.value)).toBe(
    realpathSync(join(rig.dataDir, DEFAULT_PROJECT_FOLDER_NAME)),
  );
});
