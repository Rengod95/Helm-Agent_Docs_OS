import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { DraftInput, EventKind } from "@xeon/contracts/records";
import { userItem } from "./support/builders.ts";
import { memoryLog, type MemoryLog } from "./support/log.ts";

// 시험용 메모리 로그의 생산자 규칙. 실제 저장소(core-persistence `producers.ts`, 9b0300b)는 item.recorded를 core.loop가 소유하고
// 컴팩션의 새 접두 item만 core.context가 낸다. 이 대역이 item.recorded를 아무 생산자에게나 열어 두었을 때 core.context의 소유권 오류가
// 가려졌다(M2 마감 재검토 병합 보고 2).

function draftOf(log: MemoryLog, kind: EventKind): DraftInput {
  return {
    id: log.ids.next("evt"),
    kind,
    threadId: log.threadId,
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload: kind === "item.recorded" ? userItem(log, "hello") : {},
  };
}

describe("memory log producer rule", () => {
  test("only core.context and core.loop can draft item.recorded", () => {
    const log = memoryLog();
    for (const producer of ["core.context", "core.loop"] as const) {
      const stamped = log.producer(producer).draft(draftOf(log, "item.recorded"));
      expect(stamped.producer).toBe(producer);
      expect(stamped.draft.kind).toBe("item.recorded");
    }
  });

  test("another producer drafting item.recorded is store.prefix_not_owned", () => {
    const log = memoryLog();
    for (const producer of ["core.persistence", "core.agents", "core.tools"] as const) {
      const handle = log.producer(producer);
      expect(() => handle.draft(draftOf(log, "item.recorded"))).toThrow(Bug);
      expect(() => handle.draft(draftOf(log, "item.recorded"))).toThrow(
        `store.prefix_not_owned: ${producer} cannot draft item.recorded`,
      );
    }
  });

  test("core.context cannot draft another loop kind, and drafts its own prefix", () => {
    const log = memoryLog();
    const context = log.producer("core.context");
    expect(() => context.draft(draftOf(log, "turn.started"))).toThrow(
      "store.prefix_not_owned: core.context cannot draft turn.started",
    );
    expect(context.draft(draftOf(log, "thread.compacted")).draft.kind).toBe("thread.compacted");
  });
});
