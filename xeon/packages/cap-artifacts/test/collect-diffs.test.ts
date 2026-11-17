import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ItemRecord, JsonValue, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { DurableEventEnvelope, EventFeed, EventKind } from "@fresnel/contracts/records";
import { collectDiffs } from "../src/reviews/collect.ts";
import { fixedIds } from "./support/harness.ts";

// L2.artifacts.spec §4.2.1 변경 수집. 결과 `details`의 파일 변경 기록을 `fileChangesOf`로 읽는다(M5e §4.7 F-5).
// 옛 형식(`FileChange` 한 건)과 새 형식(`fileChanges` 목록)을 같은 규칙으로 읽고, 이름은 보지 않는다.

const ids = fixedIds(11);
const threadId: ThreadId = ids.next("thr");
const turnId: TurnId = ids.next("trn");
const otherTurnId: TurnId = ids.next("trn");

const OLD_DIFF = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n";
const LIST_DIFF_1 = "--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-p\n+q\n";
const LIST_DIFF_2 = "--- /dev/null\n+++ b/c.ts\n@@ -0,0 +1 @@\n+new\n";

/** 도구 결과 한 건을 `item.recorded` 이벤트로 만든다. `details`가 없으면 결과에 싣지 않는다 */
function toolResultEvent(
  seq: number,
  turn: TurnId,
  toolCallId: string,
  options: { readonly isError?: boolean; readonly details?: JsonValue },
): DurableEventEnvelope {
  const item: ItemRecord = {
    itemId: ids.next("itm"),
    status: "completed",
    kind: "toolResult",
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "patch_file",
      content: [],
      ...(options.details === undefined ? {} : { details: options.details }),
      isError: options.isError ?? false,
      timestamp: 0,
    },
    effectId: null,
  };
  return {
    id: ids.next("evt"),
    kind: "item.recorded" satisfies EventKind,
    version: 1,
    threadId,
    turnId: turn,
    stepId: null,
    recordedAt: seq,
    causationId: null,
    correlationId: null,
    payload: { item },
    durable: true,
    seq,
    parentId: null,
  };
}

/** 이벤트 목록을 `headSeq`와 `read`로 읽는 피드. 시험이 쓰는 필터(종류 접두)만 지킨다 */
function feedOf(events: readonly DurableEventEnvelope[]): Pick<EventFeed, "headSeq" | "read"> {
  return {
    headSeq: () => ok(events.length),
    read: (after, upto, filter) => {
      const prefixes = filter?.kindPrefixes ?? [];
      const picked = events.filter(
        (event) =>
          event.seq > after &&
          event.seq <= upto &&
          prefixes.some((prefix) => event.kind.startsWith(prefix)),
      );
      return ok({ events: picked, scannedTo: upto });
    },
  };
}

describe("collectDiffs reads the change record of tool results", () => {
  const events = [
    // 옛 형식: 파일 변경 한 건
    toolResultEvent(1, turnId, "c1", {
      details: { path: "a.ts", existed: true, diff: OLD_DIFF, added: 1, removed: 1 },
    }),
    // 새 형식: 목록. 빈 diff 항목은 건너뛰고 나머지는 파일마다 한 항목이다
    toolResultEvent(2, turnId, "c2", {
      details: {
        fileChanges: [
          {
            path: "b.ts",
            op: "modify",
            existed: true,
            diff: LIST_DIFF_1,
            added: 1,
            removed: 1,
            source: "reported",
          },
          {
            path: "d.ts",
            op: "modify",
            existed: true,
            diff: "",
            added: 0,
            removed: 0,
            source: "observed",
          },
          {
            path: "c.ts",
            op: "create",
            existed: false,
            diff: LIST_DIFF_2,
            added: 1,
            removed: 0,
            source: "reported",
          },
        ],
      },
    }),
    // 오류 결과와 기록이 없는 결과는 건너뛴다
    toolResultEvent(3, turnId, "c3", {
      isError: true,
      details: { path: "e.ts", existed: true, diff: OLD_DIFF, added: 1, removed: 1 },
    }),
    toolResultEvent(4, turnId, "c4", {}),
    // 다른 턴의 결과는 이 턴 수집에 들지 않는다
    toolResultEvent(5, otherTurnId, "c5", {
      details: { path: "f.ts", existed: true, diff: OLD_DIFF, added: 1, removed: 1 },
    }),
  ];

  test("a turn collects the old and the listed records in call order, one item per file", () => {
    expect(collectDiffs(feedOf(events), threadId, { type: "turn", turnId })).toEqual(
      ok([
        { toolCallId: "c1", diff: OLD_DIFF },
        { toolCallId: "c2", diff: LIST_DIFF_1 },
        { toolCallId: "c2", diff: LIST_DIFF_2 },
      ]),
    );
  });

  test("tool calls by id collect the same way and skip the calls they do not name", () => {
    expect(
      collectDiffs(feedOf(events), threadId, {
        type: "toolCalls",
        toolCallIds: ["c2", "c3", "c4"],
      }),
    ).toEqual(
      ok([
        { toolCallId: "c2", diff: LIST_DIFF_1 },
        { toolCallId: "c2", diff: LIST_DIFF_2 },
      ]),
    );
  });

  test("a tool result whose name is not edit or write is read by its record, not by its name", () => {
    // 이름이 `patch_file`인 결과(위 시험들)가 이미 이름과 무관함을 보인다. 옛 형식 한 건도 같은 규칙으로 읽는다
    expect(
      collectDiffs(
        feedOf([
          toolResultEvent(1, turnId, "p1", {
            details: { path: "a.ts", existed: true, diff: OLD_DIFF, added: 1, removed: 1 },
          }),
        ]),
        threadId,
        {
          type: "toolCalls",
          toolCallIds: ["p1"],
        },
      ),
    ).toEqual(ok([{ toolCallId: "p1", diff: OLD_DIFF }]));
  });
});
