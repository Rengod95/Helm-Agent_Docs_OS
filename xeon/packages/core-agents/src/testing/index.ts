// 다른 패키지의 시험이 쓰는 대역(@xeon/core-agents/testing). 테스트 파일에서만 import한다(DR-08).
// spawnRecorder·settleAll은 UC-2 통합 시험의 훅이고(L1.agents.plan AG-12), fakeChildLoop은 core-loop의 runChildTurn 대역이다.
import { ok, parse, type Result } from "@xeon/contracts";
import type { IdFactory, ItemId, ThreadId } from "@xeon/contracts/conversation";
import type { LoopTurnResult } from "@xeon/contracts/extensions";
import {
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
  type CommitListener,
  type SessionService,
} from "@xeon/contracts/records";
import type { ChildTurnRequest, LoopError } from "@xeon/contracts/services";
import type { AgentsLoop } from "../deps.ts";

export interface SpawnRecord {
  readonly seq: number;
  readonly parentThreadId: ThreadId;
  readonly childThreadId: ThreadId;
  readonly requestId: string;
}

export interface SpawnRecorder {
  /** 부모 threadId + requestId마다 agent.spawned의 seq */
  readonly spawned: ReadonlyMap<string, SpawnRecord>;
  /** 부모 threadId + requestId마다 agent.settled의 seq */
  readonly settled: ReadonlyMap<string, SpawnRecord>;
  spawnedSeq(parentThreadId: ThreadId, requestId: string): number | undefined;
  settledSeq(parentThreadId: ThreadId, requestId: string): number | undefined;
  /** requestIds의 agent.settled가 모두 기록될 때까지 기다린다 */
  settleAll(parentThreadId: ThreadId, requestIds: readonly string[]): Promise<void>;
  dispose(): void;
}

function keyOf(parent: ThreadId, requestId: string): string {
  return `${parent}|${requestId}`;
}

/**
 * agent.spawned·agent.settled의 seq를 기록한다. L3.helm.plan의 통합 시험이 "N개 agent.settled seq < 적용 turn의
 * turn.started seq, 적용 turn 1회"를 이 훅으로 검사한다
 */
export function spawnRecorder(session: Pick<SessionService, "feed">): SpawnRecorder {
  const spawned = new Map<string, SpawnRecord>();
  const settled = new Map<string, SpawnRecord>();
  const waiters = new Set<() => void>();
  const listener: CommitListener = (batch) => {
    for (const event of batch.events) {
      if (event.kind === "agent.spawned") {
        const payload = parse(AgentSpawnedPayloadSchema, event.payload);
        if (!payload.ok) continue;
        spawned.set(keyOf(event.threadId, payload.value.requestId), {
          seq: event.seq,
          parentThreadId: event.threadId,
          childThreadId: payload.value.childThreadId,
          requestId: payload.value.requestId,
        });
      } else if (event.kind === "agent.settled") {
        const payload = parse(AgentSettledEventPayloadSchema, event.payload);
        if (!payload.ok) continue;
        settled.set(keyOf(event.threadId, payload.value.requestId), {
          seq: event.seq,
          parentThreadId: event.threadId,
          childThreadId: payload.value.childThreadId,
          requestId: payload.value.requestId,
        });
      }
    }
    for (const wake of waiters) wake();
  };
  const unsubscribe = session.feed.onCommit(listener);
  return {
    spawned,
    settled,
    spawnedSeq: (parent, requestId) => spawned.get(keyOf(parent, requestId))?.seq,
    settledSeq: (parent, requestId) => settled.get(keyOf(parent, requestId))?.seq,
    settleAll(parentThreadId, requestIds): Promise<void> {
      const done = (): boolean =>
        requestIds.every((requestId) => settled.has(keyOf(parentThreadId, requestId)));
      if (done()) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      const check = (): void => {
        if (!done()) return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      return promise;
    },
    dispose: unsubscribe,
  };
}

export interface FakeChildTurn {
  readonly status: "completed" | "aborted" | "error";
  /** 자식 대화의 최종 어시스턴트 item id(보고를 읽는 곳) */
  readonly finalItemId?: ItemId;
  readonly usage?: LoopTurnResult["usage"];
}

export interface FakeChildLoop extends AgentsLoop {
  /** 실제로 실행한(재생이 아닌) 요청 */
  readonly calls: readonly ChildTurnRequest[];
}

/**
 * core-loop의 `runChildTurn` 대역. 같은 (threadId, requestId)는 기록된 결과를 replayed로 돌려준다.
 * turn 본문은 호출자가 정한다. 취소는 `request.signal`을 보고 스스로 `aborted`를 돌려준다
 */
export function fakeChildLoop(options: {
  readonly ids: IdFactory;
  readonly run: (request: ChildTurnRequest) => Promise<FakeChildTurn>;
}): FakeChildLoop {
  const calls: ChildTurnRequest[] = [];
  const recorded = new Map<string, LoopTurnResult>();
  return {
    calls,
    async runChildTurn(request): Promise<Result<LoopTurnResult, LoopError>> {
      const key = `${request.threadId}|${request.requestId}`;
      const prior = recorded.get(key);
      if (prior !== undefined) return ok({ ...prior, replayed: true });
      calls.push(request);
      const turn = await options.run(request);
      const result: LoopTurnResult = {
        outcome: {
          turnId: options.ids.next("trn"),
          status: turn.status,
          ...(turn.finalItemId === undefined ? {} : { finalItemId: turn.finalItemId }),
        },
        replayed: false,
        usage: turn.usage ?? null,
      };
      recorded.set(key, result);
      return ok(result);
    },
  };
}
