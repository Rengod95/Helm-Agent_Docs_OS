import { describe, expect, test } from "bun:test";
import type { ProjectListItem, ThreadSummary } from "@fresnel/contracts/wire";
import {
  capRows,
  checkProjectName,
  folderBlocksOf,
  isProjectCollapsed,
  isWithinRoot,
  pathSplitOf,
  projectOfThread,
  projectPanelOf,
  relativeFolder,
  sameFolderRunningOf,
  type PlacedRow,
} from "../../src/views/project/project-model.ts";
import { rootInstructionsOf } from "../../src/views/project/project-settings.tsx";
import { sidebarRowsOf } from "../../src/views/thread-groups.ts";
import { summary, thr } from "../state/helpers.ts";

function project(id: string, root: string, name: string): ProjectListItem {
  return {
    projectId: id,
    name,
    root,
    createdAt: "2026-11-22T00:00:00.000Z",
    rev: 1,
    threadCount: 0,
    runningCount: 0,
  };
}

const APP = project("prj_app", "/w/app", "app");
const DOCS = project("prj_docs", "/w/docs", "docs");
const NESTED = project("prj_web", "/w/app/web", "web");

function placed(threads: readonly ThreadSummary[]): readonly PlacedRow[] {
  return sidebarRowsOf(threads);
}

const ids = (rows: readonly { readonly thread: ThreadSummary }[]): readonly string[] =>
  rows.map((row) => row.thread.threadId);

describe("project membership", () => {
  test("a folder is inside a root by path segments, ignoring trailing separators", () => {
    expect(isWithinRoot("/w/app", "/w/app/")).toBe(true);
    expect(isWithinRoot("/w/app/src/x", "/w/app")).toBe(true);
    expect(isWithinRoot("/w/apple", "/w/app")).toBe(false);
    expect(relativeFolder("/w/app/", "/w/app")).toBe("");
    expect(relativeFolder("/w/app/src/x/", "/w/app")).toBe("src/x");
    expect(relativeFolder("/w/other", "/w/app")).toBeNull();
  });

  test("the deepest root wins, and the list's stale ref is used only for a listed project", () => {
    const projects = [APP, NESTED];
    expect(projectOfThread({}, "/w/app/web/ui", projects)?.projectId).toBe("prj_web");
    expect(projectOfThread({}, "/w/app/api", projects)?.projectId).toBe("prj_app");
    // 루트로 찾지 못하면(심볼릭 링크 경로) 목록이 준 소속을 쓴다
    expect(
      projectOfThread({ project: { projectId: "prj_app", name: "app" } }, "/link/app", projects)
        ?.projectId,
    ).toBe("prj_app");
    // 목록에서 뺀 프로젝트를 가리키는 낡은 소속은 버린다
    expect(
      projectOfThread({ project: { projectId: "prj_gone", name: "gone" } }, "/x", projects),
    ).toBeUndefined();
    expect(projectOfThread({ project: null }, null, projects)).toBeUndefined();
  });
});

describe("projectPanelOf", () => {
  const threads = [
    summary(thr(1), { workspace: "/w/docs" }),
    summary(thr(2), { workspace: "/w/app/api", status: "running" }),
    summary(thr(3), { workspace: null }),
    summary(thr(4), { workspace: "/w/app" }),
    // 하위 대화는 폴더가 없어도 부모(2)의 프로젝트와 하위 폴더를 따른다
    summary(thr(5), { workspace: null, spawnedBy: { kind: "subagent", threadId: thr(2) } }),
    summary(thr(6), { workspace: "/data/default-project/thr_x" }),
  ];

  test("projects follow their most recent conversation, empty ones come last by name", () => {
    const empty = project("prj_a", "/w/aaa", "aaa");
    const model = projectPanelOf(placed(threads), [APP, DOCS, empty], true);
    expect(model.projects.map((p) => p.project.projectId)).toEqual([
      "prj_docs",
      "prj_app",
      "prj_a",
    ]);
    const app = model.projects[1];
    expect(app === undefined ? [] : ids(app.rows)).toEqual([thr(2), thr(5), thr(4)]);
    expect(app?.rows.map((row) => row.rel)).toEqual(["api", "api", ""]);
    expect(app?.running).toBe(1);
    expect(ids(model.loose)).toEqual([thr(3), thr(6)]);
  });

  test("while searching, projects without a match are left out", () => {
    const model = projectPanelOf(
      placed([summary(thr(1), { workspace: "/w/docs" })]),
      [APP, DOCS],
      false,
    );
    expect(model.projects.map((p) => p.project.projectId)).toEqual(["prj_docs"]);
  });

  test("folder blocks put the root first and join the path under the root", () => {
    const model = projectPanelOf(placed(threads), [APP], true);
    const rows = model.projects[0]?.rows ?? [];
    expect(
      folderBlocksOf(rows, "/w/app/").map((block) => [block.rel, block.path, ids(block.rows)]),
    ).toEqual([
      ["", "/w/app", [thr(4)]],
      ["api", "/w/app/api", [thr(2), thr(5)]],
    ]);
  });
});

describe("capRows", () => {
  const rows = [1, 2, 3, 4].flatMap((n) => [
    { thread: summary(thr(n)), child: false },
    { thread: summary(thr(n + 10)), child: true },
  ]);

  test("keeps the first top rows with their children and counts the hidden tops", () => {
    const capped = capRows(rows, 2, null);
    expect(ids(capped.shown)).toEqual([thr(1), thr(11), thr(2), thr(12)]);
    expect(capped.hidden).toBe(2);
  });

  test("a selected conversation below the cap stays visible", () => {
    const capped = capRows(rows, 2, thr(13));
    expect(ids(capped.shown)).toEqual([thr(1), thr(11), thr(2), thr(12), thr(3), thr(13)]);
    expect(capped.hidden).toBe(1);
    expect(capRows(rows, 4, null).hidden).toBe(0);
    // 멀리 있는 고른 대화는 그 묶음만 더 보이고 사이는 접힌 채다
    const far = capRows(rows, 1, thr(14));
    expect(ids(far.shown)).toEqual([thr(1), thr(11), thr(4), thr(14)]);
    expect(far.hidden).toBe(2);
  });
});

describe("pathSplitOf", () => {
  test("the separator and the last folder name are kept whole and the rest is the part that gets cut", () => {
    expect(pathSplitOf("services/billing-worker/src")).toEqual({
      head: "services/billing-worker",
      tail: "/src",
    });
    expect(pathSplitOf("drafts")).toEqual({ head: "", tail: "drafts" });
    expect(pathSplitOf("apps\\desktop")).toEqual({ head: "apps", tail: "\\desktop" });
  });
});

describe("isProjectCollapsed", () => {
  test("the five most recent projects start open, the rest start collapsed", () => {
    expect([0, 4, 5, 19].map((i) => isProjectCollapsed(undefined, i, false))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  test("a project holding the open conversation starts open, and a person's choice wins", () => {
    expect(isProjectCollapsed(undefined, 12, true)).toBe(false);
    expect(isProjectCollapsed(false, 12, false)).toBe(false);
    expect(isProjectCollapsed(true, 0, true)).toBe(true);
  });
});

describe("same folder and settings helpers", () => {
  test("only other running conversations in the very same folder are named", () => {
    const open = summary(thr(1), { workspace: "/w/app/" });
    const others = [
      open,
      summary(thr(2), { workspace: "/w/app", status: "running" }),
      summary(thr(3), { workspace: "/w/app", status: "idle" }),
      summary(thr(4), { workspace: "/w/app/api", status: "running" }),
    ];
    expect(ids(sameFolderRunningOf(open, others).map((thread) => ({ thread })))).toEqual([thr(2)]);
    expect(sameFolderRunningOf(summary(thr(5)), others)).toEqual([]);
    expect(sameFolderRunningOf(undefined, others)).toEqual([]);
  });

  test("names are trimmed and 1 to 128 characters", () => {
    expect(checkProjectName("  api  ")).toBe("api");
    expect(checkProjectName("   ")).toBeNull();
    expect(checkProjectName("x".repeat(129))).toBeNull();
  });

  test("the root AGENTS.md is the file at the root path, loaded or too large", () => {
    expect(
      rootInstructionsOf({
        files: [
          { path: "AGENTS.md", bytes: 2048, included: true },
          { path: "api/AGENTS.md", bytes: 10, included: true },
        ],
      }),
    ).toEqual({ bytes: 2048, included: true });
    expect(
      rootInstructionsOf({ files: [{ path: "AGENTS.md", bytes: 900_000, included: false }] }),
    ).toEqual({ bytes: 900_000, included: false });
    expect(
      rootInstructionsOf({ files: [{ path: "api/AGENTS.md", bytes: 1, included: true }] }),
    ).toBeNull();
  });
});
