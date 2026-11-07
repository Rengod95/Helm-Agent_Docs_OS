import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import {
  EventIdSchema,
  ThreadIdSchema,
  type EventId,
  type ThreadId,
} from "@fresnel/contracts/conversation";
import { renderToString } from "react-dom/server";
import type { CompactionRecord } from "../../src/state/engine/state.ts";
import { CompactionDividerView } from "../../src/views/compaction-divider.tsx";
import { compactionViewOf } from "../../src/views/compaction-model.ts";

// 대화 요약 구분선(L4 desktop-ux §6.6). 효과 없는 서버 렌더로 문구와 펼침 상태의 값을 비교한다.

function threadOf(value: string): ThreadId {
  const parsed = parse(ThreadIdSchema, value);
  if (!parsed.ok) throw new Bug(`bad test thread id ${value}`);
  return parsed.value;
}
function eventOf(value: string): EventId {
  const parsed = parse(EventIdSchema, value);
  if (!parsed.ok) throw new Bug(`bad test event id ${value}`);
  return parsed.value;
}
const THREAD = threadOf("thr_00000000000000000000000001");
const EVENT = eventOf("evt_00000000000000000000000001");

function recordOf(overrides: Partial<CompactionRecord> = {}): CompactionRecord {
  return {
    threadId: THREAD,
    eventId: EVENT,
    at: "2026-11-07T00:00:00.000Z",
    summary: "사용자는 캐시 무효화 버그를 고치고 있다.",
    tokensBefore: 120_000,
    tokensAfter: 30_000,
    reason: "threshold",
    ...overrides,
  };
}

describe("구분선의 문구 값", () => {
  test("이유는 자동 요약이면 자동, 직접 누른 것이면 수동, 옛 기록이면 없다", () => {
    expect(compactionViewOf(recordOf({ reason: "threshold" })).reason).toBe(
      "desktop.compaction.reason.auto",
    );
    expect(compactionViewOf(recordOf({ reason: "overflow" })).reason).toBe(
      "desktop.compaction.reason.auto",
    );
    expect(compactionViewOf(recordOf({ reason: "manual" })).reason).toBe(
      "desktop.compaction.reason.manual",
    );
    expect(compactionViewOf(recordOf({ reason: null })).reason).toBeNull();
  });

  test("요약 뒤 크기는 토큰 수를 짧게 쓴 글이고, 모르면 없다", () => {
    expect(compactionViewOf(recordOf({ tokensAfter: 30_000 })).tokensAfter).toBe("30k");
    expect(compactionViewOf(recordOf({ tokensAfter: null })).tokensAfter).toBeNull();
  });
});

describe("구분선 서버 렌더", () => {
  test("접힌 구분선은 제목, 이유, 요약 뒤 크기, 펼치기 단추를 보이고 요약 본문은 싣지 않는다", () => {
    const markup = renderToString(
      <CompactionDividerView record={recordOf()} open={false} onToggle={() => undefined} />,
    );
    expect(markup).toContain("여기까지 요약했어요");
    expect(markup).toContain(">자동<");
    expect(markup).toContain("요약 뒤 약 30k 토큰");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("요약 보기");
    expect(markup).not.toContain("캐시 무효화 버그");
  });

  test("펼친 구분선은 요약 본문을 읽기 영역에 보이고 접기 단추가 된다", () => {
    const markup = renderToString(
      <CompactionDividerView record={recordOf()} open onToggle={() => undefined} />,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("요약 접기");
    expect(markup).toContain('role="region"');
    expect(markup).toContain("사용자는 캐시 무효화 버그를 고치고 있다.");
  });

  test("수동 요약은 수동이라고 보이고, 옛 기록은 이유와 크기 줄이 없다", () => {
    const manual = renderToString(
      <CompactionDividerView
        record={recordOf({ reason: "manual" })}
        open={false}
        onToggle={() => undefined}
      />,
    );
    expect(manual).toContain(">수동<");
    const old = renderToString(
      <CompactionDividerView
        record={recordOf({ reason: null, tokensAfter: null })}
        open={false}
        onToggle={() => undefined}
      />,
    );
    expect(old).toContain("여기까지 요약했어요");
    expect(old).not.toContain("자동");
    expect(old).not.toContain("수동");
    expect(old).not.toContain("요약 뒤 약");
  });
});
