import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, EventKind, ReadFailure } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type {
  NoticeEmitFailure,
  NoticePort,
  NoticeReadFilter,
  NoticeReadPage,
  NoticeRecord,
} from "../../src/ports/notices.ts";

// 메모리 내구 로그 대역. 커밋마다 등록된 리스너를 동기로 부른다(피드 구독을 흉내 낸다). 읽기는 xeon.session 피드와 같은 규칙을 따른다:
// 접두에 맞는 행만 돌려주고, 맞지 않는 행도 scanLimit에 센다.

const FEED_PREFIXES: readonly string[] = [
  "turn.",
  "approval.",
  "work.",
  "agent.",
  "schedule.",
  "dialog.",
];
const ids = fixedIdFactory(7000);

export interface MemoryNotices extends NoticePort {
  /** 커밋된 내구 이벤트 전부. 시험이 행 수를 본다 */
  readonly log: readonly DurableEventEnvelope[];
  /** 임의의 내구 이벤트를 커밋한다. 리스너에게 동기로 전달한다 */
  commit(threadId: ThreadId, kind: EventKind, payload: unknown): DurableEventEnvelope;
  /** 커밋마다 부를 리스너(피드 대역) */
  listen(listener: (event: DurableEventEnvelope) => void): void;
}

function sameRecord(left: NoticeRecord, right: NoticeRecord): boolean {
  return (
    left.kind === right.kind &&
    left.title === right.title &&
    left.body === right.body &&
    left.origin === right.origin
  );
}

function matches(event: DurableEventEnvelope, threadId: ThreadId | undefined): boolean {
  if (threadId !== undefined && event.threadId !== threadId) return false;
  return FEED_PREFIXES.some((prefix) => event.kind.startsWith(prefix));
}

export function memoryNotices(): MemoryNotices {
  const log: DurableEventEnvelope[] = [];
  const listeners: ((event: DurableEventEnvelope) => void)[] = [];
  const byRequest = new Map<
    string,
    { readonly event: DurableEventEnvelope; readonly record: NoticeRecord }
  >();

  function commit(threadId: ThreadId, kind: EventKind, payload: unknown): DurableEventEnvelope {
    const event: DurableEventEnvelope = {
      id: ids.next("evt"),
      kind,
      version: 1,
      threadId,
      turnId: null,
      stepId: null,
      recordedAt: 1,
      causationId: null,
      correlationId: null,
      payload,
      durable: true,
      seq: log.length + 1,
      parentId: null,
    };
    log.push(event);
    for (const listener of listeners) listener(event);
    return event;
  }

  return {
    log,
    commit,
    listen: (listener) => {
      listeners.push(listener);
    },
    emit: (threadId, record, requestId): Result<DurableEventEnvelope, NoticeEmitFailure> => {
      if (requestId !== undefined) {
        const seen = byRequest.get(requestId);
        if (seen !== undefined) {
          return sameRecord(seen.record, record)
            ? ok(seen.event)
            : err({ kind: "key_reused", requestId });
        }
      }
      const event = commit(threadId, "dialog.notified", { notice: record });
      if (requestId !== undefined) byRequest.set(requestId, { event, record });
      return ok(event);
    },
    read: (afterSeq, filter: NoticeReadFilter): Result<NoticeReadPage, ReadFailure> => {
      const events: DurableEventEnvelope[] = [];
      let scannedTo = afterSeq;
      let scanned = 0;
      for (const event of log) {
        if (event.seq <= afterSeq) continue;
        if (scanned === filter.scanLimit || events.length === filter.limit) break;
        scanned += 1;
        scannedTo = event.seq;
        if (matches(event, filter.threadId)) events.push(event);
      }
      return ok({ events, scannedTo });
    },
  };
}

/** `turn.completed` payload. 상태와 오류만 바꾼다 */
export function turnCompleted(
  status: "completed" | "failed" | "interrupted",
  error?: string,
): unknown {
  return {
    status,
    stepCount: 1,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    error: error ?? null,
  };
}

/** `work.goal_settled` payload */
export function goalSettled(
  status: "met" | "limit_reached" | "judge_failed",
  judgments: number,
): unknown {
  return { goalId: "g1", status, judgments };
}

/** 도구 승인 요청(`approval.requested`, kind tool) payload */
export function toolApproval(threadId: ThreadId): unknown {
  return {
    origin: { threadId, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "k",
    title: "t",
    body: {
      kind: "tool",
      tool: { toolName: "bash", risk: "exec", args: {}, argsHash: "h", ruleId: null },
    },
    remember: ["once"],
    surfaceThreadId: threadId,
    requestedAt: 1,
  };
}

/** `agent.settled` payload. 종료 상태와 오류만 바꾼다 */
export function agentSettled(
  thread: ThreadId,
  status: "completed" | "error",
  error: string | null,
): unknown {
  return {
    childThreadId: thread,
    requestId: "req-1",
    status,
    report: null,
    answerItemId: null,
    usage: null,
    error,
  };
}
