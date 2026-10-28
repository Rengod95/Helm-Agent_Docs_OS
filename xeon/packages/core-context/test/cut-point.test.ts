import { describe, expect, test } from "bun:test";
import type {
  EventId,
  IdFactory,
  Message,
  ToolResultMessage,
  TurnId,
  Usage,
} from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { findCutPoint, type CutCandidate } from "../src/compaction/cut-point.ts";
import { prepareCompaction, type ThreadCompactionView } from "../src/compaction/compact.ts";

// L1.context.plan §5 cut_point_golden_cases. pi coding-agent/test/compaction.test.ts의 findCutPoint describe와
// durable harness-compaction.test.ts의 범위 선택 사례를 F 용어 픽스처로 옮겼다.
// 기대 인덱스는 이 파일의 추정(글자 수 / 4)으로 다시 계산했다. 원본 값과 달라진 곳은 사례마다 적었다.

const ids: IdFactory = fixedIdFactory();
const USAGE: Usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** 메시지의 글자 수 / 4 올림. 본문과 도구 호출 이름·인자만 센다 */
function estimate(message: Message): number {
  let chars = 0;
  if (message.role === "assistant") {
    for (const block of message.content) {
      if (block.type === "text") chars += block.text.length;
      else if (block.type === "toolCall")
        chars += block.name.length + JSON.stringify(block.arguments).length;
    }
  } else if (message.role === "system") {
    chars = typeof message.content === "string" ? message.content.length : 0;
  } else if (typeof message.content === "string") {
    chars = message.content.length;
  } else {
    chars = message.content.reduce(
      (sum, block) => sum + (block.type === "text" ? block.text.length : 0),
      0,
    );
  }
  return Math.ceil(chars / 4);
}

function user(text: string, turnId: TurnId | null): CutCandidate {
  return {
    eventId: ids.next("evt"),
    kind: "user",
    turnId,
    messages: [{ role: "user", content: text, timestamp: 1 }],
    usage: null,
  };
}

function assistant(text: string, turnId: TurnId | null, callId?: string): CutCandidate {
  return {
    eventId: ids.next("evt"),
    kind: "assistant",
    turnId,
    messages: [
      {
        role: "assistant",
        content:
          callId === undefined
            ? [{ type: "text", text }]
            : [{ type: "toolCall", id: callId, name: "read", arguments: { path: "big.txt" } }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-x",
        usage: USAGE,
        stopReason: callId === undefined ? "stop" : "toolUse",
        timestamp: 2,
      },
    ],
    usage: USAGE,
  };
}

function custom(text: string, turnId: TurnId | null): CutCandidate {
  return {
    eventId: ids.next("evt"),
    kind: "custom",
    turnId,
    messages: [{ role: "user", content: text, timestamp: 3 }],
    usage: null,
  };
}

function result(callId: string, text: string, turnId: TurnId | null): CutCandidate {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 4,
  };
  return { eventId: ids.next("evt"), kind: "toolResult", turnId, messages: [message], usage: null };
}

const t1: TurnId = ids.next("trn");
const t2: TurnId = ids.next("trn");

describe("cut_point_golden_cases", () => {
  test("pi: no valid cut points keeps from the first entry", () => {
    const entries = [assistant("a", t1)];
    // assistant 하나는 후보다. 후보가 없는 경우는 toolResult뿐인 목록이다
    expect(findCutPoint([result("c", "x", t1)], 10, estimate)).toEqual({
      firstKeptIndex: 0,
      turnStartIndex: -1,
      isSplitTurn: false,
    });
    expect(findCutPoint(entries, 1000, estimate).firstKeptIndex).toBe(0);
  });

  test("pi: everything fits within the budget, so nothing is cut", () => {
    const entries = [user("1", t1), assistant("a", t1), user("2", t2), assistant("b", t2)];
    expect(findCutPoint(entries, 50_000, estimate).firstKeptIndex).toBe(0);
  });

  test("pi: a cut inside a turn at an assistant message is a split turn", () => {
    // 4자/토큰: 각 어시스턴트가 길게 이어진 턴 2 안에서 자른다
    const entries = [
      user("Turn 1", t1),
      assistant("A1", t1),
      user("Turn 2", t2),
      assistant("x".repeat(400), t2),
      assistant("y".repeat(400), t2),
      assistant("z".repeat(400), t2),
    ];
    const cut = findCutPoint(entries, 150, estimate);
    expect(entries[cut.firstKeptIndex]?.kind).toBe("assistant");
    expect(cut.isSplitTurn).toBe(true);
    expect(cut.turnStartIndex).toBe(2);
  });

  test("pi: a context-visible custom entry is budgeted and starts a turn", () => {
    const entries = [
      user("hi", t1),
      assistant("hello", t1),
      custom("x".repeat(4000), t2),
      assistant("ok", t2),
    ];
    const tiny = findCutPoint(entries, 1, estimate);
    expect(tiny).toEqual({ firstKeptIndex: 3, turnStartIndex: 2, isSplitTurn: true });
    const fits = findCutPoint(entries, 2, estimate);
    expect(fits).toEqual({ firstKeptIndex: 2, turnStartIndex: -1, isSplitTurn: false });
  });

  test("pi #9740: oversized trailing tool results fall back to the call before them", () => {
    const entries = [
      user("old history", t1),
      assistant("old answer", t1),
      user("read the large file", t2),
      assistant("", t2, "call-1"),
      result("call-1", "x".repeat(8000), t2),
    ];
    expect(findCutPoint(entries, 1000, estimate)).toEqual({
      firstKeptIndex: 3,
      turnStartIndex: 2,
      isSplitTurn: true,
    });
    // 준비 결과: 요약 대상은 지난 턴, 턴 앞부분은 현재 사용자 메시지
    const view: ThreadCompactionView = { head: null, candidates: entries };
    const prep = prepareCompaction(view, 1000, estimate, 0);
    expect(prep?.firstKeptEventId).toBe(entries[3]?.eventId);
    expect(prep?.messagesToSummarize).toEqual([
      ...(entries[0]?.messages ?? []),
      ...(entries[1]?.messages ?? []),
    ]);
    expect(prep?.turnPrefixMessages).toEqual(entries[2]?.messages);
    expect(prep?.isSplitTurn).toBe(true);
  });

  test("durable: cuts at a user entry", () => {
    const entries = [
      user("u1".repeat(50), t1),
      assistant("a1".repeat(50), t1),
      user("u2".repeat(50), t2),
      assistant("a2".repeat(50), t2),
    ];
    // 한 항목이 25토큰. 예산 40이면 뒤 두 항목을 채우고 사용자 u2에서 자른다
    expect(findCutPoint(entries, 40, estimate)).toEqual({
      firstKeptIndex: 2,
      turnStartIndex: -1,
      isSplitTurn: false,
    });
  });

  test("durable: in one long run it cuts at an assistant call and never at a tool result", () => {
    const entries: CutCandidate[] = [user("do it", t1)];
    for (let i = 0; i < 5; i += 1) {
      entries.push(assistant("", t1, `c${i}`));
      entries.push(result(`c${i}`, "r".repeat(400), t1));
    }
    const cut = findCutPoint(entries, 150, estimate);
    expect(entries[cut.firstKeptIndex]?.kind).toBe("assistant");
    expect(cut.firstKeptIndex).toBe(9);
    expect(cut.isSplitTurn).toBe(true);
    expect(cut.turnStartIndex).toBe(0);
  });

  test("durable: a huge last tool result stays with its assistant call", () => {
    const entries = [user("u", t1), assistant("", t1, "c"), result("c", "big".repeat(2000), t1)];
    expect(findCutPoint(entries, 100, estimate).firstKeptIndex).toBe(1);
  });

  test("durable: does not cut at a user entry that a result of the preceding call still follows", () => {
    const entries = [
      user("u1".repeat(50), t1),
      assistant("", t1, "c"),
      user("steer".repeat(20), t1),
      result("c", "r".repeat(100), t1),
      assistant("a2".repeat(50), t1),
    ];
    // 예산에 닿는 곳은 끼어든 사용자 메시지이지만 그 뒤에 호출 결과가 남으므로 다음 어시스턴트로 옮긴다
    const cut = findCutPoint(entries, 60, estimate);
    expect(cut.firstKeptIndex).toBe(4);
  });

  test("a cut that would orphan a result moves back to the call when nothing later is valid", () => {
    const entries = [
      user("u1", t1),
      assistant("", t1, "c"),
      user("steer".repeat(200), t1),
      result("c", "r", t1),
    ];
    const cut = findCutPoint(entries, 50, estimate);
    expect(cut.firstKeptIndex).toBe(1);
  });

  test("an assistant without a user message in its turn starts that turn", () => {
    const entries = [user("u", t1), assistant("a", t1), assistant("b".repeat(400), t2)];
    const cut = findCutPoint(entries, 10, estimate);
    expect(cut).toEqual({ firstKeptIndex: 2, turnStartIndex: -1, isSplitTurn: false });
  });

  test("candidates with a null turn id only start a turn at user or custom entries", () => {
    const entries = [
      user("u", null),
      assistant("a".repeat(400), null),
      assistant("b".repeat(400), null),
    ];
    const cut = findCutPoint(entries, 150, estimate);
    expect(cut.isSplitTurn).toBe(true);
    expect(cut.turnStartIndex).toBe(0);
  });
});

describe("prepareCompaction", () => {
  test("there is nothing to summarize when the cut keeps everything", () => {
    const view: ThreadCompactionView = {
      head: null,
      candidates: [user("u", t1), assistant("a", t1)],
    };
    expect(prepareCompaction(view, 50_000, estimate, 10)).toBeUndefined();
  });

  test("an earlier summary becomes previousSummary and its file lists carry over", () => {
    const candidates = [
      user("u1".repeat(100), t1),
      assistant("a1".repeat(100), t1),
      user("u2".repeat(100), t2),
      assistant("a2".repeat(100), t2),
    ];
    const head: EventId = ids.next("evt");
    const view: ThreadCompactionView = {
      head: {
        eventId: head,
        summary: "EARLIER",
        firstKeptEventId: candidates[0]?.eventId ?? head,
        details: { readFiles: ["a.ts"], modifiedFiles: ["b.ts"] },
      },
      candidates,
    };
    const prep = prepareCompaction(view, 100, estimate, 5);
    expect(prep?.previousSummary).toBe("EARLIER");
    expect(prep?.fileOps).toEqual({ read: ["a.ts"], modified: ["b.ts"] });
    expect(prep?.messagesToSummarize.length).toBeGreaterThan(0);
    expect(prep?.tokensBefore).toBe(5);
  });
});
