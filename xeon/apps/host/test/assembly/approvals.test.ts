import { expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import type {
  ApprovalView,
  DurableEventEnvelope,
  EventFeed,
  ProjectionQuery,
  ReadFailure,
  SessionService,
  ThreadLifecycle,
  ThreadListQuery,
  ThreadSummaryRow,
} from "@fresnel/contracts/records";
import type { ApprovalService } from "@fresnel/contracts/services";
import type { WireResult } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createApprovalPort } from "../../src/assembly/approvals.ts";
import type { ApprovalListFailure, ApprovalPort } from "../../src/types.ts";
import { FAKE_STORE_ID } from "../fixtures/fake-engine.ts";
import { partial } from "../fixtures/unsafe.ts";

// approval.list의 저장소 쪽(assembly/approvals.ts)을 가짜 세션으로 시험한다. 가짜는 쓰는 멤버만 채운 부분 대역이다.
// 실제 저장소 위의 승인 흐름은 test/int/approval.int.test.ts다.

const ids = fixedIdFactory(900);

/** 승인 요청 이벤트 하나와 투영이 보는 해결 여부 */
interface Request {
  readonly id: EventId;
  readonly threadId: ThreadId;
  readonly seq: number;
  readonly resolved?: boolean;
}

interface Scenario {
  /** 목록에 나오는 thread. `closed`면 닫힌 thread다 */
  readonly threads: readonly { readonly threadId: ThreadId; readonly closed?: boolean }[];
  readonly requests: readonly Request[];
  readonly head: number;
  /** 목록에는 나오지만 `query.thread`에서는 사라진 thread(목록을 읽은 뒤 지워진 경우) */
  readonly vanished?: readonly ThreadId[];
  /** 이 thread의 미해결 요청 투영을 읽으면 busy다 */
  readonly failPending?: ThreadId;
  readonly failHead?: boolean;
}

interface Calls {
  readonly lists: ThreadListQuery[];
  readonly pendingFor: ThreadId[];
  headReads: number;
}

function requestedEvent(request: Request): DurableEventEnvelope {
  return partial<DurableEventEnvelope>({
    id: request.id,
    kind: "approval.requested",
    threadId: request.threadId,
    seq: request.seq,
    payload: {
      origin: {
        threadId: request.threadId,
        turnId: null,
        stepId: null,
        toolCallId: null,
        caller: "main",
      },
      requestKey: `key-${String(request.seq)}`,
      title: "run a command",
      body: {
        kind: "tool",
        tool: {
          toolName: "bash",
          risk: "exec",
          args: { command: "echo hi" },
          argsHash: "h",
          ruleId: null,
        },
      },
      remember: ["once"],
      surfaceThreadId: request.threadId,
      requestedAt: request.seq,
    },
  });
}

function fakeSession(scenario: Scenario, calls: Calls): SessionService {
  const vanished = new Set<ThreadId>(scenario.vanished ?? []);
  const rows: ThreadSummaryRow[] = scenario.threads.map(({ threadId, closed }) =>
    partial<ThreadSummaryRow>({
      threadId,
      status: closed === true ? "closed" : "idle",
      pendingApprovals: scenario.requests.filter(
        (request) => request.threadId === threadId && request.resolved !== true,
      ).length,
    }),
  );
  const threads = partial<ThreadLifecycle>({
    list(query) {
      calls.lists.push(query);
      const visible = rows.filter((row) => query.includeClosed === true || row.status !== "closed");
      const start = query.cursor === undefined ? 0 : Number(query.cursor);
      const end = Math.min(start + (query.limit ?? 50), visible.length);
      return {
        threads: visible.slice(start, end),
        nextCursor: end < visible.length ? String(end) : null,
      };
    },
  });
  const query = partial<ProjectionQuery>({
    thread(threadId) {
      return ok(vanished.has(threadId) ? undefined : rows.find((row) => row.threadId === threadId));
    },
    pendingApprovals(threadId) {
      calls.pendingFor.push(threadId);
      if (scenario.failPending === threadId) return err({ kind: "busy" });
      return ok(
        scenario.requests
          .filter((request) => request.threadId === threadId)
          .map((request) =>
            partial<ApprovalView>({
              approvalId: request.id,
              threadId,
              resolved: request.resolved === true,
            }),
          ),
      );
    },
  });
  const feed = partial<EventFeed>({
    headSeq() {
      calls.headReads += 1;
      return scenario.failHead === true ? err({ kind: "busy" }) : ok(scenario.head);
    },
  });
  async function* readFrom(
    afterSeq: number,
    options?: { readonly threadId?: ThreadId },
  ): AsyncGenerator<Result<DurableEventEnvelope, ReadFailure>> {
    const ordered = scenario.requests.toSorted((a, b) => a.seq - b.seq);
    for (const request of ordered) {
      if (request.threadId !== options?.threadId || request.seq <= afterSeq) continue;
      yield ok(requestedEvent(request));
    }
  }
  return partial<SessionService>({ threads, query, feed, readFrom });
}

function portOf(scenario: Scenario): { readonly port: ApprovalPort; readonly calls: Calls } {
  const calls: Calls = { lists: [], pendingFor: [], headReads: 0 };
  const port = createApprovalPort({
    approvals: partial<ApprovalService>({}),
    session: fakeSession(scenario, calls),
    storeId: FAKE_STORE_ID,
    heldThreads: () => [],
  });
  return { port, calls };
}

/** 두 열린 thread, 닫힌 thread 하나, 승인 없는 thread 하나. head는 20이다 */
function mixedScenario() {
  const A = ids.next("thr");
  const B = ids.next("thr");
  const C = ids.next("thr");
  const D = ids.next("thr");
  const a0 = ids.next("evt");
  const a1 = ids.next("evt");
  const a2 = ids.next("evt");
  const b1 = ids.next("evt");
  const bLate = ids.next("evt");
  const c1 = ids.next("evt");
  const scenario: Scenario = {
    threads: [{ threadId: A }, { threadId: B }, { threadId: C, closed: true }, { threadId: D }],
    requests: [
      { id: a0, threadId: A, seq: 1, resolved: true },
      { id: a1, threadId: A, seq: 3 },
      { id: c1, threadId: C, seq: 4 },
      { id: b1, threadId: B, seq: 5 },
      { id: a2, threadId: A, seq: 8 },
      { id: bLate, threadId: B, seq: 30 },
    ],
    head: 20,
  };
  return { scenario, A, B, D, a1, a2, b1 };
}

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("expected an ok result");
  return result.value;
}

test("listAll returns the open threads' unresolved approvals by seq, reads the head once, and skips closed and empty threads", async () => {
  const { scenario, A, B, a1, a2, b1 } = mixedScenario();
  const { port, calls } = portOf(scenario);
  const listed = valueOf(await port.listAll());
  expect(listed.approvals.map((approval) => [approval.approvalId, approval.seq])).toEqual([
    [a1, 3],
    [b1, 5],
    [a2, 8],
  ]);
  // 위치는 한 번 잰 head다. head 뒤의 요청(bLate, seq 30)은 목록에 없다
  expect(listed.position).toEqual({ storeId: FAKE_STORE_ID, seq: 20 });
  expect(calls.headReads).toBe(1);
  // 닫힌 thread(C)는 목록 질의에서 빠지고, 승인이 없는 thread(D)는 투영을 읽지 않는다
  expect(calls.lists).toEqual([{ includeClosed: false, limit: 200 }]);
  expect(calls.pendingFor).toEqual([A, B]);
});

test("listAll walks every page of the open thread list", async () => {
  const target = ids.next("thr");
  const requested = ids.next("evt");
  const threads = [
    ...Array.from({ length: 200 }, () => ({ threadId: ids.next("thr") })),
    { threadId: target },
  ];
  const { port, calls } = portOf({
    threads,
    requests: [{ id: requested, threadId: target, seq: 9 }],
    head: 9,
  });
  const listed = valueOf(await port.listAll());
  expect(listed.approvals.map((approval) => approval.approvalId)).toEqual([requested]);
  expect(calls.lists).toEqual([
    { includeClosed: false, limit: 200 },
    { includeClosed: false, limit: 200, cursor: "200" },
  ]);
});

test("listAll keeps the oldest 1000 approvals when more are pending", async () => {
  const thread = ids.next("thr");
  const requests: Request[] = Array.from({ length: 1001 }, (_, index) => ({
    id: ids.next("evt"),
    threadId: thread,
    seq: index + 1,
  }));
  const { port } = portOf({ threads: [{ threadId: thread }], requests, head: 1001 });
  const listed = valueOf(await port.listAll());
  expect(listed.approvals).toHaveLength(1000);
  expect(listed.approvals.map((approval) => approval.approvalId)).toEqual(
    requests.slice(0, 1000).map((request) => request.id),
  );
  expect(listed.approvals.at(0)?.seq).toBe(1);
  expect(listed.approvals.at(-1)?.seq).toBe(1000);
  expect(listed.position.seq).toBe(1001);
});

test("listAll skips a thread that vanished after the list and passes other failures on", async () => {
  const kept = ids.next("thr");
  const gone = ids.next("thr");
  const keptRequest = ids.next("evt");
  const goneRequest = ids.next("evt");
  const requests: Request[] = [
    { id: goneRequest, threadId: gone, seq: 2 },
    { id: keptRequest, threadId: kept, seq: 4 },
  ];
  const threads = [{ threadId: gone }, { threadId: kept }];
  const skipped = portOf({ threads, requests, head: 10, vanished: [gone] });
  const listed = valueOf(await skipped.port.listAll());
  expect(listed.approvals.map((approval) => approval.approvalId)).toEqual([keptRequest]);
  expect(skipped.calls.pendingFor).toEqual([kept]);

  const failingPending = await portOf({
    threads,
    requests,
    head: 10,
    failPending: kept,
  }).port.listAll();
  expect(failingPending.ok).toBe(false);
  if (!failingPending.ok) expect(failingPending.error).toEqual({ kind: "busy" });

  const failingHead = await portOf({ threads, requests, head: 10, failHead: true }).port.listAll();
  expect(failingHead.ok).toBe(false);
  if (!failingHead.ok) expect(failingHead.error).toEqual({ kind: "busy" });
});

test("list(threadId) still reads only that thread at the same head, and an unknown thread is thread_not_found", async () => {
  const { scenario, A, B, D, a1, a2, b1 } = mixedScenario();
  const { port } = portOf(scenario);
  const onA = valueOf(await port.list(A));
  expect(onA.approvals.map((approval) => approval.approvalId)).toEqual([a1, a2]);
  expect(onA.position).toEqual({ storeId: FAKE_STORE_ID, seq: 20 });
  const onB = valueOf(await port.list(B));
  expect(onB.approvals.map((approval) => approval.approvalId)).toEqual([b1]);
  const onD = valueOf(await port.list(D));
  expect(onD.approvals).toEqual([]);

  const unknown = ids.next("thr");
  const missing: Result<WireResult<"approval.list">, ApprovalListFailure> = await port.list(
    unknown,
  );
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error).toEqual({ kind: "thread_not_found", threadId: unknown });
});
