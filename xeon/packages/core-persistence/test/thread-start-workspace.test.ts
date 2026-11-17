// 대화 열기의 훅 순서와 대화 폴더 결정(H-7, A-20, E-13, U6). 스킬 탐색 쪽 확인은 cap-knowledge 시험이 한다.
import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ResourcesValue } from "@fresnel/contracts/extensions";
import { expectOk, openHarness, startTurn, type Harness } from "./support/harness.ts";
import { recordingHooks } from "./support/points.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";
import type { ThreadHooks } from "../src/index.ts";

const ROOT = "/proj";

function resourcesWith(overrides: Partial<ResourcesValue>): ResourcesValue {
  return {
    skillPaths: [],
    promptPaths: [],
    themePaths: [],
    workspaceCandidates: [],
    ...overrides,
  };
}

/** 폴더 `paths`만 있다고 치는 해석기. 없는 경로는 undefined다 */
function existing(paths: readonly string[]): (path: string) => Promise<string | undefined> {
  return (path) => Promise.resolve(paths.includes(path) ? path : undefined);
}

/** `workspace`를 대화 폴더로 만들고, 쓰기 소유를 얻어 쓰기 모드로 연다(newThread와 같은 순서) */
function threadIn(h: Harness, workspace: string | undefined): ThreadId {
  const threadId = h.ids.next("thr");
  expectOk(
    h.service.threads.create(
      workspace === undefined ? { threadId, title: "t" } : { threadId, title: "t", workspace },
    ),
  );
  const token = h.store.leases.acquire(`thread:${threadId}`, TEST_HOLDER_A);
  if (!token.ok) throw new Error("test lease failed");
  expectOk(h.service.openForWrite(threadId, token.value));
  return threadId;
}

function workspaceOf(h: Harness, threadId: ThreadId): string | null | undefined {
  return expectOk(h.service.query.thread(threadId))?.workspace;
}

/** 이 thread의 마지막 seq. 내부 커밋(thread.updated)도 여기에 보인다 */
function headOf(h: Harness, threadId: ThreadId): number {
  const row = expectOk(h.service.query.thread(threadId));
  if (row === undefined) throw new Error("test: thread not found");
  return row.headSeq;
}

describe("conversation open: thread.resources before thread.start", () => {
  test("the hook runs once per open, before thread.start, with the thread's folder as cwd", async () => {
    const recording = recordingHooks({ resources: resourcesWith({ skillPaths: ["/skills/a"] }) });
    const h = await openHarness({ points: recording.points });
    const threadId = threadIn(h, ROOT);
    await h.service.threads.openSettled(threadId);
    await Promise.resolve();
    const points = recording.calls.map((call) => call.point);
    expect(points.indexOf("thread.resources")).toBeLessThan(points.indexOf("thread.start"));
    const resourcesCalls = recording.calls.filter((call) => call.point === "thread.resources");
    // 두 열기(새 대화와 쓰기 열기) 모두 대화 폴더를 cwd로 준다
    expect(resourcesCalls.map((call) => call.payload)).toEqual([
      { cwd: ROOT, reason: "startup" },
      { cwd: ROOT, reason: "startup" },
    ]);
    expect(await h.service.threads.openSettled(threadId)).toEqual(
      resourcesWith({ skillPaths: ["/skills/a"] }),
    );
  });

  test("a failing resources hook does not stop thread.start and leaves no result", async () => {
    const base = recordingHooks();
    const points: ThreadHooks = {
      ...base.points,
      resources: () => {
        return Promise.reject(new Error("hook failed"));
      },
    };
    const h = await openHarness({ points });
    const threadId = threadIn(h, ROOT);
    await h.service.threads.openSettled(threadId);
    await Promise.resolve();
    expect(base.calls.map((call) => call.point)).toContain("thread.start");
    expect(await h.service.threads.openSettled(threadId)).toBeUndefined();
  });
});

describe("conversation open: the folder decision", () => {
  test("a folder inside the root is committed before the first turn", async () => {
    const h = await openHarness({
      points: recordingHooks({
        resources: resourcesWith({ workspaceCandidates: ["/proj/app"], workspace: "/proj/app" }),
      }).points,
    });
    const threadId = threadIn(h, ROOT);
    const before = headOf(h, threadId);
    const outcome = expectOk(
      await h.service.threads.applyOpenWorkspace(threadId, existing(["/proj/app"]), "open-1"),
    );
    expect(outcome).toEqual({ workspace: "/proj/app", diagnostics: [] });
    expect(headOf(h, threadId)).toBe(before + 1);
    expect(workspaceOf(h, threadId)).toBe("/proj/app");
  });

  test("a folder outside the root (or sharing only a name prefix) is ignored and diagnosed", async () => {
    const h = await openHarness({
      points: recordingHooks({
        resources: resourcesWith({ workspaceCandidates: ["/elsewhere/x", "/projx/app"] }),
      }).points,
    });
    const threadId = threadIn(h, ROOT);
    const before = headOf(h, threadId);
    const outcome = expectOk(
      await h.service.threads.applyOpenWorkspace(
        threadId,
        existing(["/elsewhere/x", "/projx/app"]),
        "open-2",
      ),
    );
    expect(outcome.workspace).toBeNull();
    expect(outcome.diagnostics).toEqual([
      { code: "workspace_conflict", candidate: "/projx/app" },
      { code: "workspace_outside_project", candidate: "/elsewhere/x" },
    ]);
    expect(headOf(h, threadId)).toBe(before);
    expect(workspaceOf(h, threadId)).toBe(ROOT);
  });

  test("two handlers: the first candidate wins and the other is diagnosed as a conflict", async () => {
    const h = await openHarness({
      points: recordingHooks({
        resources: resourcesWith({
          workspaceCandidates: ["/proj/a", "/proj/b"],
          workspace: "/proj/a",
        }),
      }).points,
    });
    const threadId = threadIn(h, ROOT);
    const outcome = expectOk(
      await h.service.threads.applyOpenWorkspace(
        threadId,
        existing(["/proj/a", "/proj/b"]),
        "open-3",
      ),
    );
    expect(outcome).toEqual({
      workspace: "/proj/a",
      diagnostics: [{ code: "workspace_conflict", candidate: "/proj/b" }],
    });
    expect(workspaceOf(h, threadId)).toBe("/proj/a");
  });

  test("a folder that does not exist is ignored and diagnosed as missing", async () => {
    const h = await openHarness({
      points: recordingHooks({ resources: resourcesWith({ workspaceCandidates: ["/proj/gone"] }) })
        .points,
    });
    const threadId = threadIn(h, ROOT);
    const outcome = expectOk(
      await h.service.threads.applyOpenWorkspace(threadId, existing([]), "open-4"),
    );
    expect(outcome).toEqual({
      workspace: null,
      diagnostics: [{ code: "workspace_missing", candidate: "/proj/gone" }],
    });
    expect(workspaceOf(h, threadId)).toBe(ROOT);
  });

  test("a folder that arrives after the first turn is ignored", async () => {
    const h = await openHarness({
      points: recordingHooks({ resources: resourcesWith({ workspaceCandidates: ["/proj/app"] }) })
        .points,
    });
    const threadId = threadIn(h, ROOT);
    startTurn(h, threadId);
    const before = headOf(h, threadId);
    const outcome = expectOk(
      await h.service.threads.applyOpenWorkspace(threadId, existing(["/proj/app"]), "open-5"),
    );
    expect(outcome).toEqual({
      workspace: null,
      diagnostics: [{ code: "workspace_late", candidate: "/proj/app" }],
    });
    expect(headOf(h, threadId)).toBe(before);
    expect(workspaceOf(h, threadId)).toBe(ROOT);
  });

  test("with no handler contributing a folder nothing changes", async () => {
    const h = await openHarness();
    const threadId = threadIn(h, ROOT);
    const before = headOf(h, threadId);
    const outcome = expectOk(
      await h.service.threads.applyOpenWorkspace(threadId, existing([]), "open-6"),
    );
    expect(outcome).toEqual({ workspace: null, diagnostics: [] });
    expect(headOf(h, threadId)).toBe(before);
    expect(workspaceOf(h, threadId)).toBe(ROOT);
  });

  test("a thread without a folder has no root, so a proposed folder is ignored", async () => {
    const h = await openHarness({
      points: recordingHooks({ resources: resourcesWith({ workspaceCandidates: ["/proj/app"] }) })
        .points,
    });
    const threadId = threadIn(h, undefined);
    const outcome = expectOk(
      await h.service.threads.applyOpenWorkspace(threadId, existing(["/proj/app"]), "open-7"),
    );
    expect(outcome).toEqual({
      workspace: null,
      diagnostics: [{ code: "workspace_outside_project", candidate: "/proj/app" }],
    });
  });
});

describe("same-folder notice (U6)", () => {
  test("lists the other open conversations in the same folder, never this one or a closed one", async () => {
    const h = await openHarness();
    const first = threadIn(h, ROOT);
    const second = threadIn(h, ROOT);
    const elsewhere = threadIn(h, "/other");
    expect(expectOk(h.service.threads.sameFolder(first)).map((t) => t.threadId)).toEqual([second]);
    expect(expectOk(h.service.threads.sameFolder(elsewhere))).toEqual([]);
    expectOk(h.service.threads.close(second, null));
    expect(expectOk(h.service.threads.sameFolder(first))).toEqual([]);
  });

  test("a thread with no folder has an empty notice", async () => {
    const h = await openHarness();
    const alone = threadIn(h, undefined);
    expect(expectOk(h.service.threads.sameFolder(alone))).toEqual([]);
  });
});
