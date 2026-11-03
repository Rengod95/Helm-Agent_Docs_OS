// loop.ask 시험이 함께 쓰는 승인 서비스 대역과 기록 읽기 도우미(drive-ask.test.ts, drive-ask-rerun.test.ts).
import { err, ok, parse } from "@fresnel/contracts";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import {
  LeaseAcquiredPayloadSchema,
  LeaseReleasedPayloadSchema,
  type LeaseAcquiredPayload,
  type LeaseReleasedPayload,
} from "@fresnel/contracts/records";
import {
  ApprovalServicePortKey,
  type ApprovalApplyOutcome,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResolution,
  type ApprovalResolvedBy,
  type ApprovalService,
} from "@fresnel/contracts/services";
import type { createTestHost } from "../../../src/testing/index.ts";

export type Host = Awaited<ReturnType<typeof createTestHost>>;

/** 시험이 대기 중인 승인에 넣는 해결. 질문 승인은 기억 범위가 once로 고정이라 싣지 않는다 */
interface Settlement {
  readonly decision: ApprovalDecision;
  readonly answer: JsonValue | null;
  readonly resolvedBy: ApprovalResolvedBy;
}

interface FakeEntry {
  readonly request: ApprovalRequest;
  resolution: ApprovalResolution | null;
  readonly waiters: Set<(resolution: ApprovalResolution) => void>;
}

export interface FakeApprovals {
  readonly service: ApprovalService;
  /** 새로 만든 승인 요청. 같은 requestKey로 다시 연 요청은 세지 않는다 */
  readonly created: readonly ApprovalRequest[];
  /** open이 받은 requestKey를 받은 순서대로(재호출 포함) */
  readonly openedKeys: readonly string[];
  /** cancel이 받은 approvalId. 끄기와 재시작 시험에서 비어 있어야 한다 */
  readonly cancelled: readonly string[];
  /** 대기 중인 승인을 사용자 답 없이 해결한다(만료 같은 경로). 대기 중이 아니면 시험이 실패한다 */
  settle(approvalId: string, settlement: Settlement): void;
}

/** `ApprovalService` 전체를 메모리에서 구현한 대역. open은 requestKey로 멱등이고, 사용자 답은 respond로 넣는다 */
export function fakeApprovals(now: () => number): FakeApprovals {
  const byId = new Map<string, FakeEntry>();
  const byKey = new Map<string, FakeEntry>();
  const created: ApprovalRequest[] = [];
  const openedKeys: string[] = [];
  const cancelled: string[] = [];

  function resolve(entry: FakeEntry, settlement: Settlement): void {
    const resolution: ApprovalResolution = {
      approvalId: entry.request.approvalId,
      decision: settlement.decision,
      answer: settlement.answer,
      remember: "once",
      requestedRemember: null,
      resolvedBy: settlement.resolvedBy,
    };
    entry.resolution = resolution;
    for (const wake of entry.waiters) wake(resolution);
    entry.waiters.clear();
  }

  /** 대기 중인 승인을 해결한다. 해결할 것이 없으면 false */
  function resolvePending(approvalId: string, settlement: Settlement): boolean {
    const entry = byId.get(approvalId);
    if (entry === undefined || entry.resolution !== null) return false;
    resolve(entry, settlement);
    return true;
  }

  /** 대화의 미해결 요청 */
  function pendingOf(threadId: ThreadId): ApprovalRequest[] {
    return [...byId.values()]
      .filter((entry) => entry.resolution === null && entry.request.origin.threadId === threadId)
      .map((entry) => entry.request);
  }

  const service: ApprovalService = {
    async request(input, signal) {
      const opened = await service.open(input);
      if (!opened.ok) return opened;
      if (opened.value.resolution !== null) return ok(opened.value.resolution);
      const waited = await service.wait(opened.value.request.approvalId, signal);
      // 신호가 끊긴 대기는 취소 해결로 돌려주되 커밋하지 않는다(실제 서비스와 같다). 요청을 닫는 일은 호출자의 몫이다
      if (!waited.ok) {
        return ok({
          approvalId: opened.value.request.approvalId,
          decision: "deny",
          answer: null,
          remember: "once",
          requestedRemember: null,
          resolvedBy: "cancelled",
        });
      }
      return ok(waited.value);
    },
    async respond(approvalId, response): Promise<ApprovalApplyOutcome> {
      const entry = byId.get(approvalId);
      if (entry === undefined) return { applied: false, reason: "unknown_approval" };
      if (entry.resolution !== null) return { applied: false, reason: "already_resolved" };
      resolve(entry, {
        decision: response.decision,
        answer: response.answer ?? null,
        resolvedBy: "user",
      });
      return { applied: true };
    },
    pending: pendingOf,
    async restore(threadId) {
      return ok(pendingOf(threadId));
    },
    async cancel(approvalId, _reason) {
      cancelled.push(approvalId);
      const applied = resolvePending(approvalId, {
        decision: "deny",
        answer: null,
        resolvedBy: "cancelled",
      });
      return { applied };
    },
    async open(input) {
      const key = `${input.origin.threadId}|${input.requestKey}`;
      openedKeys.push(input.requestKey);
      const known = byKey.get(key);
      if (known !== undefined) return ok({ request: known.request, resolution: known.resolution });
      const request: ApprovalRequest = {
        ...input,
        approvalId: `appr_${String(created.length + 1)}`,
        surfaceThreadId: input.origin.threadId,
        requestedAt: now(),
      };
      const entry: FakeEntry = { request, resolution: null, waiters: new Set() };
      byId.set(request.approvalId, entry);
      byKey.set(key, entry);
      created.push(request);
      return ok({ request, resolution: null });
    },
    async wait(approvalId, signal) {
      const entry = byId.get(approvalId);
      if (entry === undefined) return err({ kind: "unknown" });
      if (entry.resolution !== null) return ok(entry.resolution);
      const { waiters } = entry;
      const resolution = await new Promise<ApprovalResolution | undefined>((resolve) => {
        if (signal.aborted) {
          resolve(undefined);
          return;
        }
        function onAnswer(answered: ApprovalResolution): void {
          signal.removeEventListener("abort", onAbort);
          resolve(answered);
        }
        function onAbort(): void {
          waiters.delete(onAnswer);
          resolve(undefined);
        }
        waiters.add(onAnswer);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return resolution === undefined ? err({ kind: "aborted" }) : ok(resolution);
    },
    get(approvalId) {
      const entry = byId.get(approvalId);
      return entry === undefined
        ? undefined
        : { request: entry.request, resolution: entry.resolution };
    },
  };

  return {
    service,
    created,
    openedKeys,
    cancelled,
    settle(approvalId, settlement) {
      if (!resolvePending(approvalId, settlement)) {
        throw new Error(`no pending approval ${approvalId} to settle`);
      }
    },
  };
}

export async function provideApprovals(t: Host, approvals: FakeApprovals): Promise<void> {
  await t.host.registerPlatform({
    name: "test-approvals",
    setup(ctx) {
      ctx.providePort(ApprovalServicePortKey, approvals.service);
    },
  });
}

/** 요청이 정확히 하나 있으면 그 요청을 돌려준다 */
export function onlyApproval(approvals: FakeApprovals): ApprovalRequest {
  const [only, ...rest] = approvals.created;
  if (only === undefined || rest.length > 0) {
    throw new Error(`expected one approval, found ${String(approvals.created.length)}`);
  }
  return only;
}

export function eventsOf(t: Host, thread: ThreadId, kind: string): unknown[] {
  return t.records
    .events(thread)
    .filter((event) => event.kind === kind)
    .map((event) => event.payload);
}

/** drive 락 부여 기록을 스키마로 읽는다. 기록이 맞지 않으면 시험을 실패시킨다 */
export function acquiredOf(t: Host, thread: ThreadId): LeaseAcquiredPayload[] {
  return t.records.events(thread).flatMap((event): LeaseAcquiredPayload[] => {
    if (event.kind !== "lease.acquired") return [];
    const parsed = parse(LeaseAcquiredPayloadSchema, event.payload);
    if (!parsed.ok) throw new Error("lease.acquired does not match its schema");
    return [parsed.value];
  });
}

/** drive 락 반납 기록을 스키마로 읽는다. 기록이 맞지 않으면 시험을 실패시킨다 */
export function releasedOf(t: Host, thread: ThreadId): LeaseReleasedPayload[] {
  return t.records.events(thread).flatMap((event): LeaseReleasedPayload[] => {
    if (event.kind !== "lease.released") return [];
    const parsed = parse(LeaseReleasedPayloadSchema, event.payload);
    if (!parsed.ok) throw new Error("lease.released does not match its schema");
    return [parsed.value];
  });
}

/** 질문 카드. 제목이 있는 선택지와 추천을 넣어 본문 옮김을 함께 본다 */
