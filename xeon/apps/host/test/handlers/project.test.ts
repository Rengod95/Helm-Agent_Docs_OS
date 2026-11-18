import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import { WireError, type ProfileInput, type ThreadSummary } from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// review m5 §3.4, §4.4, §4.8.1, §4.4.8. 프로젝트 처리기와 대화 생성·목록의 프로젝트 소속, 프로필 기본값을 wire로 본다.
// 저장은 임시 폴더의 `projects.json`과 `profiles.json`이다. 대화 저장은 가짜 엔진이 한다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-project-handlers-"));
  roots.push(dir);
  return realpathSync(dir);
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function rig(): { readonly host: FakeHost; readonly configDir: string } {
  const configDir = tempDir();
  const host = createFakeHost({
    profiles: { configDir, pluginFacts: () => [] },
    overrides: { pluginReview: { list: () => Promise.resolve(ok({ items: [] })) } },
  });
  return { host, configDir };
}

async function connect(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

/** 거절된 호출의 와이어 오류 kind. 성공이면 undefined다 */
function kindOf(call: Promise<unknown>): Promise<string | undefined> {
  return call.then(
    () => undefined,
    (error: unknown) =>
      error instanceof WireError ? error.data.kind : `not a wire error: ${String(error)}`,
  );
}

function profileOf(id: string): ProfileInput {
  return { id, title: id, plugins: [], settings: [], startDrive: null };
}

// ── project.* ───────────────────────────────────────────────────────────

test("project.create makes a project named after the folder, and project.list shows it with zero counts", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = join(tempDir(), "billing");
  mkdirSync(folder);
  const created = await connection.request("project.create", { root: folder });
  expect(created.project).toMatchObject({ name: "billing", root: realpathSync(folder), rev: 1 });
  const listed = await connection.request("project.list", {});
  expect(listed.projects).toEqual([{ ...created.project, threadCount: 0, runningCount: 0 }]);
});

test("project.create refuses a relative or missing root with project.rootInvalid, and a duplicate with project.exists", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  expect(await kindOf(connection.request("project.create", { root: "relative" }))).toBe(
    "project.rootInvalid",
  );
  expect(await kindOf(connection.request("project.create", { root: join(folder, "none") }))).toBe(
    "project.rootInvalid",
  );
  await connection.request("project.create", { root: folder });
  expect(await kindOf(connection.request("project.create", { root: folder }))).toBe(
    "project.exists",
  );
});

test("project.get reports pendingReview 0 when the review box holds nothing for it (the count with items is the int test) and project.notFound for an unknown id", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const created = await connection.request("project.create", { root: tempDir(), name: "one" });
  const got = await connection.request("project.get", { projectId: created.project.projectId });
  expect(got).toEqual({ project: created.project, pendingReview: 0 });
  expect(await kindOf(connection.request("project.get", { projectId: "prj_none" }))).toBe(
    "project.notFound",
  );
});

test("project.rename and project.delete change the record and keep the threads", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  const created = await connection.request("project.create", { root: folder });
  const renamed = await connection.request("project.rename", {
    projectId: created.project.projectId,
    name: "Renamed",
  });
  expect(renamed.project).toMatchObject({ name: "Renamed", rev: 2 });
  expect(
    await connection.request("project.delete", { projectId: created.project.projectId }),
  ).toEqual({});
  const listed = await connection.request("project.list", {});
  expect(listed.projects).toEqual([]);
  expect(
    await kindOf(connection.request("project.delete", { projectId: created.project.projectId })),
  ).toBe("project.notFound");
});

test("project.instructions lists the AGENTS.md files from the root to the working folder, and a folder in no project is project.rootInvalid", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  const deep = join(folder, "a", "b");
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(folder, "AGENTS.md"), "rules");
  writeFileSync(join(deep, "AGENTS.md"), "more rules");
  await connection.request("project.create", { root: folder });
  const listed = await connection.request("project.instructions", { workspace: deep });
  expect(listed.files).toEqual([
    { path: "AGENTS.md", bytes: 5, included: true },
    { path: "a/b/AGENTS.md", bytes: 10, included: true },
  ]);
  expect(await kindOf(connection.request("project.instructions", { workspace: tempDir() }))).toBe(
    "project.rootInvalid",
  );
});

// ── thread.create와 thread.list의 프로젝트 소속 ─────────────────────────

test("thread.create in a project folder reports that project, and thread.list shows it on the thread", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  const sub = join(folder, "sub");
  mkdirSync(sub);
  const project = await connection.request("project.create", { root: folder, name: "shop" });
  const created = await connection.request("thread.create", { workspace: sub });
  expect(created.project).toEqual({ projectId: project.project.projectId, name: "shop" });
  const listed = await connection.request("thread.list", {});
  const summary = listed.threads.find(
    (thread: ThreadSummary) => thread.threadId === created.threadId,
  );
  expect(summary?.project).toEqual({ projectId: project.project.projectId, name: "shop" });
});

test("thread.create in a folder that is in no project makes a project rooted there and reports it", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = join(tempDir(), "loose");
  mkdirSync(folder);
  const created = await connection.request("thread.create", { workspace: folder });
  expect(created.project).toMatchObject({ name: "loose" });
  const listed = await connection.request("project.list", {});
  expect(listed.projects.map((project: { name: string }) => project.name)).toEqual(["loose"]);
});

test("thread.create without a workspace asks for the default folder and reports no project", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const created = await connection.request("thread.create", {});
  expect(created.project).toBeNull();
  expect(host.fake.threadCreates.at(-1)).toMatchObject({ defaultFolder: true });
});

test("a test run thread never joins a project and does not make one", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = join(tempDir(), "t");
  mkdirSync(folder);
  const created = await connection.request("thread.create", { workspace: folder, testRun: true });
  expect(created.project).toBeNull();
  const listed = await connection.request("project.list", {});
  expect(listed.projects).toEqual([]);
});

test("project.list counts the threads whose folders are inside each project", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  const sub = join(folder, "sub");
  mkdirSync(sub);
  await connection.request("project.create", { root: folder, name: "counted" });
  await connection.request("thread.create", { workspace: sub });
  await connection.request("thread.create", { workspace: folder });
  const listed = await connection.request("project.list", {});
  expect(listed.projects).toEqual([
    expect.objectContaining({ name: "counted", threadCount: 2, runningCount: 0 }),
  ]);
});

// ── 프로필 기본값(§4.4.8) ───────────────────────────────────────────────

test("profile.defaultFor follows the most recent thread in the same folder, including its current profile after a switch", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  await connection.request("profile.put", { profile: profileOf("review"), baseRev: null });
  const first = await connection.request("thread.create", {
    workspace: folder,
    profileId: "review",
  });
  expect((await connection.request("profile.defaultFor", { workspace: folder })).profileId).toBe(
    "review",
  );
  const second = await connection.request("thread.create", { workspace: folder });
  // 두 번째 대화를 만들 때 프로필을 주지 않았으므로 같은 폴더의 가장 최근 대화(첫 번째)의 값을 쓴다
  expect(second.profileId).toBe("review");
  // 첫 대화를 기본으로 바꾸면 그것이 가장 최근 활동이고, 기본값도 기본이다
  await connection.request("thread.setProfile", { threadId: first.threadId, profileId: "default" });
  expect((await connection.request("profile.defaultFor", { workspace: folder })).profileId).toBe(
    "default",
  );
});

test("profile.defaultFor falls back to the same project, then to default", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  const sub = join(folder, "sub");
  mkdirSync(sub);
  await connection.request("project.create", { root: folder });
  await connection.request("profile.put", { profile: profileOf("review"), baseRev: null });
  await connection.request("thread.create", { workspace: sub, profileId: "review" });
  // 다른 폴더(같은 프로젝트 안)에는 대화가 없어 같은 프로젝트의 가장 최근 대화를 쓴다
  expect(
    (await connection.request("profile.defaultFor", { workspace: join(folder, "other") }))
      .profileId,
  ).toBe("review");
  // 프로젝트 밖의 폴더에는 대화가 없다
  expect((await connection.request("profile.defaultFor", { workspace: tempDir() })).profileId).toBe(
    "default",
  );
});

test("profile.defaultFor without a workspace is the most recent thread overall, and a deleted profile reads as default", async () => {
  const { host } = rig();
  const connection = await connect(host);
  await connection.request("profile.put", { profile: profileOf("gone"), baseRev: null });
  await connection.request("thread.create", { workspace: tempDir(), profileId: "gone" });
  expect((await connection.request("profile.defaultFor", {})).profileId).toBe("gone");
  await connection.request("profile.delete", { id: "gone" });
  expect((await connection.request("profile.defaultFor", {})).profileId).toBe("default");
});

test("a test run thread is never the source of the default profile", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  await connection.request("profile.put", { profile: profileOf("review"), baseRev: null });
  await connection.request("thread.create", {
    workspace: folder,
    profileId: "review",
    testRun: true,
  });
  expect((await connection.request("profile.defaultFor", { workspace: folder })).profileId).toBe(
    "default",
  );
  expect((await connection.request("profile.defaultFor", {})).profileId).toBe("default");
});

test("thread.create without a profileId stores the default-for value of its workspace", async () => {
  const { host } = rig();
  const connection = await connect(host);
  const folder = tempDir();
  await connection.request("profile.put", { profile: profileOf("review"), baseRev: null });
  await connection.request("thread.create", { workspace: folder, profileId: "review" });
  const next = await connection.request("thread.create", { workspace: folder });
  expect(next.profileId).toBe("review");
  expect(host.fake.chosenProfiles.get(next.threadId)).toBe("review");
});

test("a project change is pushed to every ready connection as project.changed", async () => {
  const { host } = rig();
  const connection = await connect(host);
  // 알림은 연결 안에서 비동기로 온다. 받는 순간 풀리는 약속을 기다린다(시험 시간 제한이 실패를 막는다)
  const received = new Promise<unknown>((resolve) => {
    connection.onNotification("project.changed", (params) => resolve(params));
  });
  const created = await connection.request("project.create", { root: tempDir() });
  expect(await received).toEqual({ rev: 1, ids: [created.project.projectId] });
});
