import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { EventWire, ProjectListItem, ThreadSummary } from "@fresnel/contracts/wire";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import { projectPanelOf } from "../../src/views/project/project-model.ts";
import { sidebarRowsOf } from "../../src/views/thread-groups.ts";
import { STORE, SUB, evt, thr } from "../state/helpers.ts";

// 살아 있는 연결에서 새로 생긴 대화(`thread.started`)에는 프로젝트가 없다(엔진 사실에 소속이 없다). 프로젝트 패널은
// 그 대화의 작업 폴더를 담은 가장 깊은 루트로 소속을 정한다. 목록을 다시 읽기 전에도 대화가 제 프로젝트에 서는지 고정한다.

const AT = "2026-11-22T00:00:00.000Z";

function wire(seq: number, threadId: ThreadId, workspace: string | null): EventWire {
  return {
    id: evt(seq),
    kind: "thread.started",
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload:
      workspace === null
        ? { title: null, forkedFrom: null }
        : { title: null, forkedFrom: null, workspace },
    redactions: [],
  };
}

const started = (seq: number, threadId: ThreadId, workspace: string | null): DurableFact =>
  decodeDurable(wire(seq, threadId, workspace));

const SUBSCRIBED: MirrorInput = {
  type: "subscribed",
  sub: SUB,
  storeId: STORE,
  start: 0,
  live: true,
  from: "head",
};

function mirrorOf(facts: readonly DurableFact[]): EngineMirror {
  const inputs: readonly MirrorInput[] = [
    SUBSCRIBED,
    { type: "batch", sub: SUB, from: 0, to: facts.length, caughtUp: true, facts: [...facts] },
  ];
  return inputs.reduce((state, input) => reduceMirror(state, input).state, INITIAL_MIRROR);
}

function summariesOf(state: EngineMirror): readonly ThreadSummary[] {
  return state.threads.ids.flatMap((id) => {
    const found = state.threads.byId[id];
    return found === undefined ? [] : [found];
  });
}

function project(id: string, root: string): ProjectListItem {
  return { projectId: id, name: id, root, createdAt: AT, rev: 1, threadCount: 0, runningCount: 0 };
}

describe("live thread.started without a project", () => {
  const state = mirrorOf([
    started(1, thr(1), "/w/app/api"),
    started(2, thr(2), "/w/app/web/ui"),
    started(3, thr(3), null),
  ]);
  const threads = summariesOf(state);

  test("the mirror keeps the started conversations and they carry no project", () => {
    expect(threads.map((thread) => thread.threadId).toSorted()).toEqual([thr(1), thr(2), thr(3)]);
    expect(threads.map((thread) => thread.project)).toEqual([undefined, undefined, undefined]);
  });

  test("the panel places them by the deepest root, and one without a folder is left without a project", () => {
    const model = projectPanelOf(
      sidebarRowsOf(threads),
      [project("prj_app", "/w/app"), project("prj_web", "/w/app/web")],
      true,
    );
    const placed = Object.fromEntries(
      model.projects.map((entry) => [
        entry.project.projectId,
        entry.rows.map((row) => [row.thread.threadId, row.rel]),
      ]),
    );
    expect(placed).toEqual({
      prj_app: [[thr(1), "api"]],
      prj_web: [[thr(2), "ui"]],
    });
    expect(model.loose.map((row) => row.thread.threadId)).toEqual([thr(3)]);
  });
});
