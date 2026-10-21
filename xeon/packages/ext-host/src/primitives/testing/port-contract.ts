// L1 포트 구현(core-loop, core-tasks, core-persistence)이 자기 테스트에서 돌리는 계약 시나리오(X.primitives.plan P-19).
// 인메모리 대역도 같은 시나리오를 통과해야 한다(test/primitives/port-contract.test.ts).
import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  InputQueuePort,
  LoopPort,
  LoopTurnRequest,
  RecordCommitPort,
} from "@xeon/contracts/extensions";
import { fixedIdFactory } from "./ids.ts";
import { flushMicrotasks } from "./timers.ts";

export interface PortContractFactories {
  readonly loop: () => LoopPort;
  readonly queue: () => InputQueuePort;
  readonly records: () => RecordCommitPort;
}

function turnRequest(threadId: ThreadId, requestId: string, leaseEpoch: number): LoopTurnRequest {
  return {
    threadId,
    scopeId: "contract-group",
    leaseId: "lease-contract",
    leaseEpoch,
    requestId,
    input: { kind: "user", content: "contract turn" },
    signal: new AbortController().signal,
  };
}

/** 같은 시나리오를 구현마다 다시 돌린다. 이름 앞에 구현 이름을 붙인다 */
export function runPortContract(name: string, factories: PortContractFactories): void {
  const ids = fixedIdFactory(5000);

  describe(`${name}: LoopPort`, () => {
    test("runTurn is idempotent per (scopeId, requestId)", async () => {
      const loop = factories.loop();
      const threadId = ids.next("thr");
      const first = await loop.runTurn(turnRequest(threadId, "turn-a", 1));
      const second = await loop.runTurn(turnRequest(threadId, "turn-a", 1));
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.outcome.turnId).toBe(first.outcome.turnId);
    });

    test("a smaller leaseEpoch is rejected", async () => {
      const loop = factories.loop();
      const threadId = ids.next("thr");
      await loop.runTurn(turnRequest(threadId, "turn-fence-1", 2));
      let rejected = false;
      try {
        await loop.runTurn(turnRequest(threadId, "turn-fence-2", 1));
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });

    test("whenIdle holds back new turns while fn runs", async () => {
      const loop = factories.loop();
      const threadId = ids.next("thr");
      let started = false;
      let pending: Promise<unknown> | undefined;
      await loop.whenIdle(threadId, async () => {
        pending = loop.runTurn(turnRequest(threadId, "turn-held", 1)).then(() => {
          started = true;
          return undefined;
        });
        await flushMicrotasks();
        expect(started).toBe(false);
        return undefined;
      });
      await pending;
      expect(started).toBe(true);
    });
  });

  describe(`${name}: InputQueuePort`, () => {
    test("enqueue is idempotent per (thread, scope, requestId)", async () => {
      const queue = factories.queue();
      const threadId = ids.next("thr");
      const request = {
        threadId,
        scopeId: "contract-group",
        requestId: "post-a",
        when: "followUp" as const,
        item: { kind: "user" as const, content: "hello" },
      };
      expect((await queue.enqueue(request)).duplicate).toBe(false);
      expect((await queue.enqueue(request)).duplicate).toBe(true);
      expect((await queue.enqueue({ ...request, scopeId: "other-group" })).duplicate).toBe(false);
    });
  });

  describe(`${name}: RecordCommitPort`, () => {
    test("expectStateRev rejects a stale revision and the same key replays", async () => {
      const records = factories.records();
      const threadId = ids.next("thr");
      const draft = (rev: number, prev: string | null) => ({
        id: ids.next("evt"),
        kind: "grp.contract-group.state.committed" as const,
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
        causationId: null,
        correlationId: null,
        payload: { scopeId: "contract-group", rev, prevEventId: prev, version: 1, doc: { rev } },
        durable: true as const,
      });
      const first = draft(1, null);
      const request = {
        threadId,
        requestId: "state-1",
        fingerprintSource: { scopeId: "contract-group", n: 1 },
        expectStateRev: { scopeId: "contract-group", rev: 0 },
        drafts: [first],
      };
      expect((await records.commit(request)).status).toBe("committed");
      expect((await records.commit({ ...request, drafts: [draft(1, null)] })).status).toBe(
        "replayed",
      );
      const stale = await records.commit({
        threadId,
        requestId: "state-2",
        fingerprintSource: { scopeId: "contract-group", n: 2 },
        expectStateRev: { scopeId: "contract-group", rev: 0 },
        drafts: [draft(1, null)],
      });
      expect(stale.status).toBe("rejected");
      if (stale.status === "rejected") expect(stale.code).toBe("state_conflict");
      const snapshot = await records.loadThread(threadId);
      expect(snapshot.states.map((state) => state.rev)).toEqual([1]);
    });
  });
}
