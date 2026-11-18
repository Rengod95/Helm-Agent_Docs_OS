import { expect, test } from "bun:test";
import {
  DEFAULT_PROJECT_ID,
  deepestRoot,
  isWithin,
  projectIdOf,
  projectRefOf,
  recentThreadOf,
  type ScopeRoot,
  type ScopeThread,
} from "../../src/assembly/m4/project-scope.ts";

// review m5 §4.4.2·§4.4.5·§4.4.8. 소속과 프로필 기본값은 저장하지 않고 계산한다. 값으로 비교한다.

const ROOTS: readonly ScopeRoot[] = [
  { projectId: "prj_outer", root: "/work", name: "outer" },
  { projectId: "prj_inner", root: "/work/app", name: "inner" },
  { projectId: DEFAULT_PROJECT_ID, root: "/data/default-project", name: null },
];

function thread(
  threadId: string,
  workspace: string | null,
  updatedAt: number,
  overrides: Partial<ScopeThread> = {},
): ScopeThread {
  return {
    threadId,
    workspace,
    profileId: null,
    updatedAt,
    testRun: false,
    craftChat: false,
    ...overrides,
  };
}

test("isWithin accepts the root itself and its children, never a sibling with the same prefix", () => {
  expect(isWithin("/work", "/work")).toBe(true);
  expect(isWithin("/work/app/src", "/work")).toBe(true);
  expect(isWithin("/workshop", "/work")).toBe(false);
  expect(isWithin("/", "/")).toBe(true);
  expect(isWithin("/anything", "/")).toBe(true);
});

test("deepestRoot picks the deepest root that contains the folder, and nothing outside every root", () => {
  expect(deepestRoot("/work/app/src/x", ROOTS)?.projectId).toBe("prj_inner");
  expect(deepestRoot("/work/other", ROOTS)?.projectId).toBe("prj_outer");
  expect(deepestRoot("/data/default-project/t1", ROOTS)?.projectId).toBe(DEFAULT_PROJECT_ID);
  expect(deepestRoot("/elsewhere", ROOTS)).toBeUndefined();
});

test("on a tie the first root in the list wins, so an explicit project beats the implicit default folder", () => {
  const tied: readonly ScopeRoot[] = [
    { projectId: "prj_explicit", root: "/data/default-project", name: "same" },
    { projectId: DEFAULT_PROJECT_ID, root: "/data/default-project", name: null },
  ];
  expect(deepestRoot("/data/default-project/t1", tied)?.projectId).toBe("prj_explicit");
});

test("projectRefOf reports explicit projects only; the default folder and a folder in no root give null", () => {
  expect(projectRefOf("/work/app/src", ROOTS)).toEqual({ projectId: "prj_inner", name: "inner" });
  expect(projectRefOf("/data/default-project/t1", ROOTS)).toBeNull();
  expect(projectRefOf("/elsewhere", ROOTS)).toBeNull();
  expect(projectRefOf(null, ROOTS)).toBeNull();
});

test("projectIdOf includes the implicit default folder project", () => {
  expect(projectIdOf("/data/default-project/t1", ROOTS)).toBe(DEFAULT_PROJECT_ID);
  expect(projectIdOf("/elsewhere", ROOTS)).toBeNull();
});

test("recentThreadOf takes the most recent thread in the same folder before any other", () => {
  const threads = [
    thread("newest-other", "/work/other", 30),
    thread("same-folder-recent", "/work/app", 20),
    thread("same-folder-old", "/work/app", 10),
  ];
  const picked = recentThreadOf({
    threads,
    workspace: "/work/app",
    projectIdOf: (path) => projectIdOf(path, ROOTS),
  });
  expect(picked?.threadId).toBe("same-folder-recent");
});

test("recentThreadOf falls back to the most recent thread of the same project when the folder has none", () => {
  const threads = [
    thread("elsewhere", "/elsewhere", 40),
    thread("other-in-project", "/work/other", 30),
    thread("project-old", "/work/third", 10),
  ];
  // /work/new는 같은 폴더의 대화가 없고 prj_outer에 있다. 그 안의 가장 최근 대화는 /work/other의 것이다
  const picked = recentThreadOf({
    threads,
    workspace: "/work/new",
    projectIdOf: (path) => projectIdOf(path, ROOTS),
  });
  expect(picked?.threadId).toBe("other-in-project");
});

test("recentThreadOf finds nothing when the folder is in a project with no other thread, even if other projects have threads", () => {
  const threads = [thread("elsewhere", "/elsewhere", 40), thread("inner", "/work/app/x", 30)];
  // /work/app/src는 prj_inner에 있다. prj_inner의 대화는 /work/app/x 하나이므로 그것이 고른 대화다
  const picked = recentThreadOf({
    threads,
    workspace: "/work/app/src",
    projectIdOf: (path) => projectIdOf(path, ROOTS),
  });
  expect(picked?.threadId).toBe("inner");
  // 같은 프로젝트의 대화가 하나도 없으면 undefined다(다른 프로젝트의 대화는 고르지 않는다)
  const none = recentThreadOf({
    threads: [thread("outer-only", "/work/other", 30)],
    workspace: "/work/app/src",
    projectIdOf: (path) => projectIdOf(path, ROOTS),
  });
  expect(none).toBeUndefined();
});

test("recentThreadOf returns undefined for a folder outside every root when no thread shares the folder", () => {
  const picked = recentThreadOf({
    threads: [thread("a", "/elsewhere", 5)],
    workspace: "/nowhere",
    projectIdOf: (path) => projectIdOf(path, ROOTS),
  });
  expect(picked).toBeUndefined();
});

test("recentThreadOf without a workspace is the most recent thread overall, and test run threads never count", () => {
  const threads = [
    thread("test-run", "/work/app", 50, { testRun: true, profileId: "craft" }),
    thread("real", "/work/other", 20, { profileId: "review" }),
    thread("older", "/work/app", 10, { profileId: "default" }),
  ];
  const picked = recentThreadOf({ threads, workspace: undefined, projectIdOf: () => null });
  expect(picked?.threadId).toBe("real");
  expect(picked?.profileId).toBe("review");
});

test("a craft thread (테스트 대화) never gives the profile default, in its folder or in the whole list", () => {
  const threads = [
    thread("craft-newest", "/work/app", 50, { craftChat: true, profileId: "craft" }),
    thread("normal", "/work/app", 10, { profileId: "review" }),
  ];
  const sameFolder = recentThreadOf({
    threads,
    workspace: "/work/app",
    projectIdOf: (path) => projectIdOf(path, ROOTS),
  });
  expect(sameFolder?.threadId).toBe("normal");
  expect(sameFolder?.profileId).toBe("review");
  const overall = recentThreadOf({ threads, workspace: undefined, projectIdOf: () => null });
  expect(overall?.threadId).toBe("normal");
  // 같은 폴더에 테스트 대화만 있으면 같은 폴더 단계는 비고, 같은 프로젝트의 다른 대화도 없으면 아무것도 고르지 않는다
  const onlyCraft = recentThreadOf({
    threads: [thread("craft-only", "/work/app", 5, { craftChat: true, profileId: "craft" })],
    workspace: "/work/app",
    projectIdOf: (path) => projectIdOf(path, ROOTS),
  });
  expect(onlyCraft).toBeUndefined();
});
