import { describe, expect, test } from "bun:test";
import type { AssistantMessage, ItemId, ItemRecord } from "@fresnel/contracts/conversation";
import type { TurnSummary } from "../../../src/state/engine/index.ts";
import {
  changedTurnsOf,
  changesOf,
  pathPartsOf,
  rewindOf,
} from "../../../src/views/panels/changes/changes-model.ts";
import { itm, prt, trn, userItem } from "../../state/helpers.ts";

// 변경 탭 모델(DP-198~200): 확정 item의 edit·write 호출을 턴별·파일별로 모으고, 명령·하위 에이전트는 추적 밖으로 남긴다.

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(n: number, content: AssistantMessage["content"]): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    message: {
      role: "assistant",
      content,
      api: "anthropic-messages",
      provider: "anthropic",
      model: "m",
      usage: USAGE,
      stopReason: "toolUse",
      timestamp: 0,
    },
    partIds: content.map((_, i) => prt(n * 10 + i)),
  };
}

function result(n: number, callId: string, isError = false): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "toolResult",
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName: "edit",
      content: [],
      details: null,
      isError,
      timestamp: 0,
    },
    effectId: null,
  };
}

function turn(n: number, input: ItemId, over: Partial<TurnSummary> = {}): TurnSummary {
  return {
    turnId: trn(n),
    origin: "user",
    startedSeq: n,
    inputItemIds: [input],
    leadScopeId: null,
    model: null,
    startedAt: "2026-11-13T00:00:00.000Z",
    running: false,
    aborting: false,
    abort: null,
    steps: 1,
    durationMs: 1000,
    usage: null,
    rawUsage: null,
    end: { kind: "completed" },
    stopReason: "stop",
    warnings: [],
    notices: [],
    lastContextTokens: null,
    composition: null,
    ...over,
  };
}

function viewOf(records: readonly ItemRecord[], turns: readonly TurnSummary[]) {
  const items: Record<string, ItemRecord> = {};
  for (const r of records) items[r.itemId] = r;
  return changesOf({ itemIds: records.map((r) => r.itemId), items, turns });
}

const edit = (id: string, path: string, oldText: string, newText: string) =>
  ({ type: "toolCall", id, name: "edit", arguments: { path, oldText, newText } }) as const;

describe("changesOf", () => {
  test("턴마다 바꾼 파일과 줄 수를 모으고 전체는 경로별로 합친다", () => {
    const view = viewOf(
      [
        userItem(1, "정렬 고쳐 줘"),
        assistant(2, [edit("c1", "src/a.ts", "one\ntwo", "one\nTWO\nthree")]),
        result(3, "c1"),
        userItem(4, "README도"),
        assistant(5, [
          {
            type: "toolCall",
            id: "c2",
            name: "write",
            arguments: { path: "README.md", content: "a\nb\nc" },
          },
          edit("c3", "src/a.ts", "three", "3"),
        ]),
        result(6, "c2"),
        result(7, "c3"),
      ],
      [turn(1, itm(1)), turn(2, itm(4))],
    );
    expect(view.turns.map((t) => [t.number, t.prompt, t.added, t.removed])).toEqual([
      [1, "정렬 고쳐 줘", 2, 1],
      [2, "README도", 4, 1],
    ]);
    expect(
      view.files.map((f) => [f.path, f.added, f.removed, f.wholeWrite, f.edits.length]),
    ).toEqual([
      ["src/a.ts", 3, 2, false, 2],
      ["README.md", 3, 0, true, 1],
    ]);
    expect([view.added, view.removed]).toEqual([6, 2]);
  });

  test("오류 결과와 끝난 턴의 결과 없는 호출은 세지 않고, 도는 턴의 결과 없는 호출은 진행 중이다", () => {
    const failed = viewOf(
      [
        userItem(1, "a"),
        assistant(2, [edit("c1", "x.ts", "a", "b"), edit("c2", "y.ts", "a", "b")]),
        result(3, "c1", true),
      ],
      [turn(1, itm(1))],
    );
    expect(failed.files).toEqual([]);
    const running = viewOf(
      [userItem(1, "a"), assistant(2, [edit("c1", "x.ts", "a", "b")])],
      [turn(1, itm(1), { running: true, end: null })],
    );
    expect(running.files.map((f) => [f.path, f.pending])).toEqual([["x.ts", true]]);
  });

  test("명령과 하위 에이전트 호출은 추적 밖으로 남긴다", () => {
    const view = viewOf(
      [
        userItem(1, "테스트"),
        assistant(2, [
          { type: "toolCall", id: "c1", name: "bash", arguments: { command: "bun test" } },
          {
            type: "toolCall",
            id: "c2",
            name: "agent",
            arguments: { agent: "reviewer", task: "봐 줘" },
          },
          { type: "toolCall", id: "c3", name: "read", arguments: { path: "a.ts" } },
        ]),
        result(3, "c1"),
        result(4, "c2"),
        result(5, "c3"),
      ],
      [turn(1, itm(1))],
    );
    expect(view.untracked.map((u) => [u.kind, u.text, u.agent, u.state])).toEqual([
      ["command", "bun test", null, "applied"],
      ["agent", "봐 줘", "reviewer", "applied"],
    ]);
    expect(view.files).toEqual([]);
  });
});

describe("턴별 보기와 되감기", () => {
  const records = [
    userItem(1, "하나"),
    assistant(2, [edit("c1", "a.ts", "a", "b")]),
    result(3, "c1"),
    userItem(4, "둘"),
    assistant(5, [{ type: "text", text: "말만" }]),
    userItem(6, "셋"),
    assistant(7, [edit("c2", "b.ts", "a", "b")]),
    result(8, "c2"),
  ];

  test("바꾼 것이 있는 턴만 새 턴부터 싣는다", () => {
    const view = viewOf(records, [turn(1, itm(1)), turn(2, itm(4)), turn(3, itm(6))]);
    expect(changedTurnsOf(view).map((t) => t.number)).toEqual([3, 1]);
  });

  test("되감기는 그 턴의 마지막 item으로 가고 뒤의 턴 수를 알려 준다. 마지막 턴과 도는 대화는 막는다", () => {
    const view = viewOf(records, [turn(1, itm(1)), turn(2, itm(4)), turn(3, itm(6))]);
    const [first, , last] = view.turns;
    expect(first === undefined ? null : rewindOf(view, first)).toEqual({
      kind: "ok",
      target: itm(3),
      dropsTurns: 2,
    });
    expect(last === undefined ? null : rewindOf(view, last)).toEqual({ kind: "latest" });
    const busy = viewOf(records, [
      turn(1, itm(1)),
      turn(2, itm(4)),
      turn(3, itm(6), { running: true, end: null }),
    ]);
    const busyFirst = busy.turns[0];
    expect(busyFirst === undefined ? null : rewindOf(busy, busyFirst)).toEqual({ kind: "busy" });
  });
});

describe("pathPartsOf", () => {
  test("이름과 폴더로 나눈다", () => {
    expect(pathPartsOf("apps/desktop/src/a.ts")).toEqual({ name: "a.ts", dir: "apps/desktop/src" });
    expect(pathPartsOf("README.md")).toEqual({ name: "README.md", dir: "" });
  });
});
