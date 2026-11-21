import { describe, expect, test } from "bun:test";
import type {
  AssistantMessage,
  ItemId,
  ItemRecord,
  JsonValue,
} from "@fresnel/contracts/conversation";
import type { TurnSummary } from "../../../src/state/engine/index.ts";
import {
  changedTurnsOf,
  changesOf,
  pathPartsOf,
  rewindOf,
} from "../../../src/views/panels/changes/changes-model.ts";
import { itm, prt, trn, userItem } from "../../state/helpers.ts";

// 변경 탭 모델(DP-198~200): 완료된 도구 결과의 파일 변경(`fileChangesOf`)을 턴별·파일별로 모으고, 명령·하위 에이전트는 추적 밖으로 남긴다.
// 원천은 결과 `details`다. 호출 인자와 도구 이름으로는 파일을 세지 않는다(M5e §4.7, F-5).

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

/** 도구 결과 item. `details`를 주면 그 값이 결과에 실린다(파일 변경 기록이 여기 든다) */
function result(n: number, callId: string, isError = false, details?: JsonValue): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "toolResult",
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName: "edit",
      content: [],
      ...(details === undefined ? {} : { details }),
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
    requestId: null,
    invoked: [],
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

/** 결과 `details`에 실리는 파일 변경 한 건(목록 형식). 엔진이 `source`를 정한다 */
function entryOf(
  path: string,
  diff: string,
  added: number,
  removed: number,
  op: "create" | "modify" = "modify",
): JsonValue {
  return { path, op, existed: op === "modify", diff, added, removed, source: "observed" };
}

/** 결과 `details`의 목록 형식: `{ fileChanges: [...] }` */
function changed(...entries: JsonValue[]): JsonValue {
  return { fileChanges: entries };
}

/** 옛 형식: 파일 변경 한 건을 `details`에 그대로 둔다 */
function legacyOf(path: string, diff: string, added: number, removed: number): JsonValue {
  return { path, existed: true, diff, added, removed };
}

const DIFF_A = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n one\n-two\n+TWO\n+three\n";
const DIFF_A_LAST = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -2,1 +2,1 @@\n-three\n+3\n";
const DIFF_README = "--- /dev/null\n+++ b/README.md\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n";

function recordsOf(details: JsonValue): ReturnType<typeof userItem>[] {
  return [
    userItem(1, "a"),
    assistant(2, [edit("c1", "a.ts", "x", "y")]),
    result(3, "c1", false, details),
  ];
}

describe("changesOf", () => {
  test("턴마다 바꾼 파일과 줄 수를 모으고 전체는 경로별로 합친다", () => {
    const view = viewOf(
      [
        userItem(1, "정렬 고쳐 줘"),
        assistant(2, [edit("c1", "src/a.ts", "one\ntwo", "one\nTWO\nthree")]),
        result(3, "c1", false, changed(entryOf("src/a.ts", DIFF_A, 2, 1))),
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
        result(6, "c2", false, changed(entryOf("README.md", DIFF_README, 3, 0, "create"))),
        result(7, "c3", false, changed(entryOf("src/a.ts", DIFF_A_LAST, 1, 1))),
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
      ["README.md", 3, 0, false, 1],
    ]);
    expect([view.added, view.removed]).toEqual([6, 2]);
  });

  test("오류 결과의 변경은 세지 않고, 결과가 없는 파일 호출은 경로가 결과에서만 오므로 세지 않는다", () => {
    const failed = viewOf(
      [
        userItem(1, "a"),
        assistant(2, [edit("c1", "x.ts", "a", "b"), edit("c2", "y.ts", "a", "b")]),
        result(3, "c1", true, changed(entryOf("x.ts", DIFF_A, 1, 1))),
      ],
      [turn(1, itm(1))],
    );
    expect(failed.files).toEqual([]);
    const running = viewOf(
      [userItem(1, "a"), assistant(2, [edit("c1", "x.ts", "a", "b")])],
      [turn(1, itm(1), { running: true, end: null })],
    );
    expect(running.files).toEqual([]);
    expect(running.turns.map((t) => t.running)).toEqual([true]);
  });

  test("명령과 하위 에이전트 호출은 추적 밖으로 남기고, 도는 턴의 결과 없는 명령은 진행 중이다", () => {
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
    const running = viewOf(
      [
        userItem(1, "a"),
        assistant(2, [
          { type: "toolCall", id: "b1", name: "bash", arguments: { command: "bun test" } },
        ]),
      ],
      [turn(1, itm(1), { running: true, end: null })],
    );
    expect(running.untracked.map((u) => [u.kind, u.state])).toEqual([["command", "pending"]]);
  });

  test("도구 이름과 상관없이 완료된 결과의 파일 변경을 센다. 한 결과의 여러 파일은 파일마다 한 줄이다", () => {
    const view = viewOf(
      [
        userItem(1, "고쳐 줘"),
        assistant(2, [
          { type: "toolCall", id: "p1", name: "patch_file", arguments: { target: "docs/a.md" } },
        ]),
        result(
          3,
          "p1",
          false,
          changed(
            entryOf(
              "docs/a.md",
              "--- /dev/null\n+++ b/docs/a.md\n@@ -0,0 +1 @@\n+new line\n",
              1,
              0,
              "create",
            ),
            entryOf(
              "docs/b.md",
              "--- a/docs/b.md\n+++ b/docs/b.md\n@@ -1 +1 @@\n-old\n+new\n",
              1,
              1,
            ),
          ),
        ),
      ],
      [turn(1, itm(1))],
    );
    expect(view.files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ["docs/a.md", 1, 0],
      ["docs/b.md", 1, 1],
    ]);
  });

  test("옛 한 건 기록과 목록 기록은 같은 모양으로 읽는다", () => {
    const legacy = viewOf(recordsOf(legacyOf("a.ts", DIFF_A, 2, 1)), [turn(1, itm(1))]);
    const listed = viewOf(recordsOf(changed(entryOf("a.ts", DIFF_A, 2, 1))), [turn(1, itm(1))]);
    expect(legacy.files.map((f) => [f.path, f.added, f.removed])).toEqual([["a.ts", 2, 1]]);
    expect(listed.files).toEqual(legacy.files);
  });

  test("diff 줄을 더함·지움·문맥으로 나누고, 머리 30줄 뒤는 rest로 접는다. 머리 두 줄은 줄이 아니다", () => {
    const body = Array.from({ length: 33 }, (_, i) => `+line ${String(i)}`);
    const diff = [
      "--- a/big.ts",
      "+++ b/big.ts",
      "@@ -1,2 +1,34 @@",
      "-- old",
      ...body,
      " keep",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const view = viewOf(
      [
        userItem(1, "a"),
        assistant(2, [edit("c1", "big.ts", "x", "y")]),
        result(3, "c1", false, changed(entryOf("big.ts", diff, 33, 1))),
      ],
      [turn(1, itm(1))],
    );
    const [file] = view.files;
    const [only] = file?.edits ?? [];
    expect(only?.view.kind).toBe("edit");
    if (only?.view.kind !== "edit") throw new Error("expected an edit view");
    expect(only.view.head.length).toBe(30);
    expect(only.view.head.slice(0, 2)).toEqual([
      { kind: "remove", text: "- old" },
      { kind: "add", text: "line 0" },
    ]);
    expect(only.view.rest.length).toBe(5);
    expect(only.view.rest.at(-1)).toEqual({ kind: "context", text: "keep" });
    expect([only.added, only.removed]).toEqual([33, 1]);
  });

  test("결과 `details`가 없으면 그 결과는 파일을 싣지 않는다", () => {
    const view = viewOf(
      [userItem(1, "a"), assistant(2, [edit("c1", "a.ts", "x", "y")]), result(3, "c1")],
      [turn(1, itm(1))],
    );
    expect(view.files).toEqual([]);
  });
});

describe("턴별 보기와 되감기", () => {
  const records = [
    userItem(1, "하나"),
    assistant(2, [edit("c1", "a.ts", "a", "b")]),
    result(3, "c1", false, changed(entryOf("a.ts", DIFF_A_LAST, 1, 1))),
    userItem(4, "둘"),
    assistant(5, [{ type: "text", text: "말만" }]),
    userItem(6, "셋"),
    assistant(7, [edit("c2", "b.ts", "a", "b")]),
    result(8, "c2", false, changed(entryOf("b.ts", DIFF_A_LAST, 1, 1))),
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
