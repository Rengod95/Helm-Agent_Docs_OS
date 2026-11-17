import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type { Project } from "@fresnel/contracts/wire";
import type { FileLock } from "@fresnel/platform-os";
import { createProjectStore, type ProjectsChange } from "../../src/assembly/m4/project-store.ts";

// review m5 §3.2 `projects.json`. 실제 임시 파일에 쓴다. 저장소는 규칙(같은 루트, 없는 id)을 모른다. 그것은 포트가 본다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-project-store-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NOW = Date.parse("2026-01-05T00:00:00.000Z");

// 파일 잠금 대역: 잠금은 항상 얻는다(한 프로세스 시험)
const fileLock: FileLock = {
  scope: "process",
  withLock: async (_path, fn) => ok(await fn()),
  updateText: () => Promise.reject(new Error("updateText is not part of this test")),
};

function projectOf(id: string, root: string, name = "app"): Project {
  return {
    projectId: id,
    name,
    root,
    createdAt: new Date(NOW).toISOString(),
    rev: 1,
  };
}

function storeAt(dir: string) {
  return createProjectStore({
    path: join(dir, "projects.json"),
    fileLock,
    clock: { now: () => NOW },
    signal: new AbortController().signal,
  });
}

test("a missing file reads as an empty list at rev 0", async () => {
  const store = storeAt(tempDir());
  expect(await store.read()).toEqual(ok({ projects: [], rev: 0 }));
});

test("a transact writes schemaVersion 1 with the rev, and a fresh store reads the same list back", async () => {
  const dir = tempDir();
  const first = storeAt(dir);
  const written = await first.transact<string, never>((snapshot) => {
    expect(snapshot).toEqual({ projects: [], rev: 0 });
    return ok({ projects: [projectOf("prj_one", "/work/one")], value: "done" });
  });
  expect(written).toEqual(ok({ value: "done", rev: 1 }));
  const onDisk: unknown = JSON.parse(readFileSync(join(dir, "projects.json"), "utf8"));
  expect(onDisk).toEqual({
    schemaVersion: 1,
    projects: [projectOf("prj_one", "/work/one")],
    rev: 1,
  });
  // 다른 저장소 인스턴스(재시작)도 같은 목록을 읽는다
  expect(await storeAt(dir).read()).toEqual(
    ok({ projects: [projectOf("prj_one", "/work/one")], rev: 1 }),
  );
});

test("a transact that changes nothing neither bumps the rev nor notifies", async () => {
  const dir = tempDir();
  const store = storeAt(dir);
  await store.transact<void, never>(() =>
    ok({ projects: [projectOf("prj_a", "/a")], value: undefined }),
  );
  const seen: ProjectsChange[] = [];
  store.onChange((change) => seen.push(change));
  const again = await store.transact<void, never>((snapshot) =>
    ok({ projects: snapshot.projects, value: undefined }),
  );
  expect(again).toEqual(ok({ value: undefined, rev: 1 }));
  expect(seen).toEqual([]);
});

test("a changed list notifies once with the rev and the ids that changed", async () => {
  const store = storeAt(tempDir());
  const seen: ProjectsChange[] = [];
  const off = store.onChange((change) => seen.push(change));
  await store.transact<void, never>(() =>
    ok({ projects: [projectOf("prj_a", "/a"), projectOf("prj_b", "/b")], value: undefined }),
  );
  await store.transact<void, never>((snapshot) =>
    ok({
      projects: snapshot.projects.filter((project) => project.projectId !== "prj_a"),
      value: undefined,
    }),
  );
  off();
  await store.transact<void, never>(() => ok({ projects: [], value: undefined }));
  expect(seen).toEqual([
    { rev: 1, ids: ["prj_a", "prj_b"] },
    { rev: 2, ids: ["prj_a"] },
  ]);
});

test("a corrupt file is reported as corrupt and is never overwritten", async () => {
  const dir = tempDir();
  const path = join(dir, "projects.json");
  writeFileSync(path, "{ not json");
  const store = storeAt(dir);
  const read = await store.read();
  expect(read.ok).toBe(false);
  if (read.ok) throw new Error("a corrupt file must not read as ok");
  expect(read.error.kind).toBe("corrupt");
  const written = await store.transact<void, never>(() =>
    ok({ projects: [projectOf("prj_x", "/x")], value: undefined }),
  );
  expect(written.ok).toBe(false);
  expect(readFileSync(path, "utf8")).toBe("{ not json");
});

test("a file with the wrong shape (extra key) is corrupt, not silently accepted", async () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "projects.json"),
    JSON.stringify({ schemaVersion: 1, projects: [], rev: 0, extra: true }),
  );
  const read = await storeAt(dir).read();
  expect(read.ok).toBe(false);
});

test("a change that refuses leaves the file as it was and returns the refusal", async () => {
  const dir = tempDir();
  const store = storeAt(dir);
  await store.transact<void, never>(() =>
    ok({ projects: [projectOf("prj_a", "/a")], value: undefined }),
  );
  const refused = await store.transact<void, "exists">(() => err("exists"));
  expect(refused).toEqual(err("exists"));
  expect(await store.read()).toEqual(ok({ projects: [projectOf("prj_a", "/a")], rev: 1 }));
});
