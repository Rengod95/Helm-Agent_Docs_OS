import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ProjectListItem, ThreadSummary } from "@fresnel/contracts/wire";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { StaticProjects, type ProjectsLoad } from "../../src/views/project/project-source.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { ThreadList } from "../../src/views/thread-list.tsx";
import { STORE, SUB, summary, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function project(id: string, root: string, name: string): ProjectListItem {
  return { projectId: id, name, root, createdAt: "t", rev: 1, threadCount: 0, runningCount: 0 };
}

function mirror(threads: readonly ThreadSummary[]): EngineMirror {
  const inputs: MirrorInput[] = [
    { type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } },
    { type: "subscribed", sub: SUB, storeId: STORE, start: 5, live: true, from: "head" },
    { type: "threads", threads },
  ];
  return inputs.reduce((state, input) => reduceMirror(state, input).state, INITIAL_MIRROR);
}

function html(threads: readonly ThreadSummary[], load: ProjectsLoad): string {
  const ui = frozen<UiState>(createUiStore().read.getState());
  return renderToString(
    <Providers engine={frozen(mirror(threads))} ui={ui} commands={fakeCommands()}>
      <StaticProjects load={load}>
        <ShellStoreContext value={createShellStore(1280)}>
          <ThreadList folderPick={() => Promise.resolve(undefined)} />
        </ShellStoreContext>
      </StaticProjects>
    </Providers>,
  );
}

const THREADS = [
  summary(thr(1), { title: "루트 대화", workspace: "/w/app" }),
  summary(thr(2), { title: "하위 대화", workspace: "/w/app/api" }),
  summary(thr(3), { title: "기본 폴더 대화", workspace: null }),
];

describe("project panel", () => {
  test("ready projects show the root, a subfolder head and the conversations without a project", () => {
    const out = html(THREADS, {
      status: "ready",
      projects: [project("prj_app", "/w/app", "app"), project("prj_doc", "/w/doc", "doc")],
      pending: new Map([["prj_app", 2]]),
    });
    expect(out).toContain('data-project-panel="tree"');
    expect(out).toContain('data-project="prj_app"');
    // 대화가 없는 프로젝트도 머리가 선다
    expect(out).toContain('data-project="prj_doc"');
    expect(out).toContain('data-project-folder="api"');
    expect(out).toContain("프로젝트 없는 대화");
    expect(out).toContain("리뷰 2");
    // 예전 작업 폴더 묶음은 보이지 않는다
    expect(out).not.toContain("작업 폴더 없음");
    // 대화 셋이 모두 한 번씩 줄로 선다
    for (const title of ["루트 대화", "하위 대화", "기본 폴더 대화"])
      expect(out.split(title).length - 1).toBeGreaterThanOrEqual(1);
  });

  test("more than five conversations in a project are cut with a count", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      summary(thr(i + 1), { title: `대화${i + 1}`, workspace: "/w/app" }),
    );
    const out = html(many, {
      status: "ready",
      projects: [project("prj_app", "/w/app", "app")],
      pending: new Map(),
    });
    expect(out).toContain("3개 더 보기");
    expect(out).toContain("대화5");
    expect(out).not.toContain("대화6");
  });

  test("conversations without a project are cut the same way", () => {
    const loose = Array.from({ length: 7 }, (_, i) =>
      summary(thr(i + 1), { title: `질문${i + 1}`, workspace: null }),
    );
    const out = html(loose, { status: "ready", projects: [], pending: new Map() });
    expect(out).toContain("2개 더 보기");
    expect(out).toContain("질문5");
    expect(out).not.toContain("질문6");
  });

  test("a test run conversation is not drawn in the project panel", () => {
    const out = html(
      [
        summary(thr(1), { title: "보통 대화", workspace: "/w/app" }),
        summary(thr(2), {
          title: "시험 실행 대화",
          workspace: "/w/app",
          testRun: { profileId: null, target: "helm", paused: false },
        }),
      ],
      { status: "ready", projects: [project("prj_app", "/w/app", "app")], pending: new Map() },
    );
    expect(out).toContain("보통 대화");
    expect(out).not.toContain("시험 실행 대화");
  });

  test("an engine without projects keeps the folder groups", () => {
    const out = html(THREADS, { status: "unsupported" });
    expect(out).not.toContain("data-project-panel");
    expect(out).toContain("작업 폴더 없음");
  });

  test("no projects yet shows only the conversations without a project and a way to make one", () => {
    const out = html([THREADS[2] ?? summary(thr(9))], {
      status: "ready",
      projects: [],
      pending: new Map(),
    });
    expect(out).toContain("data-project-empty");
    expect(out).toContain("폴더를 골라 프로젝트 만들기");
    expect(out).toContain("프로젝트 없는 대화");
  });
});
