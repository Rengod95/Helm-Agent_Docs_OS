import type { Clock } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { ApprovalOrigin } from "@xeon/contracts/services";
import { createTestHost } from "@xeon/ext-host/testing";
import { createApprovalService, type ApprovalsInternal } from "../approvals/service.ts";
import { fakeSession, type FakeSession } from "./fake-session.ts";
import { sequentialIds } from "./ids.ts";

// 실제 `ApprovalService`를 대역 세션 위에 세운 시험용 조립. 도구 호출 표가 없어 모든 요청이 턴 밖(그룹 코드)의 요청으로 취급된다.
// cap-*의 승인 어댑터를 실제 서비스에 붙여 보는 통합 시험이 쓴다(L2ApprovalsPort 기준 어댑터는 `l2ApprovalsPort`).

export interface FakeApprovalsOptions {
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /** 메모리에 남기는 해결된 요청 수 상한. 생략하면 서비스의 기본값 */
  readonly resolvedKept?: number;
}

export interface FakeApprovals {
  readonly approvals: ApprovalsInternal;
  readonly session: FakeSession;
  readonly ids: IdFactory;
  /** 요청의 출처로 쓸 수 있는 턴 밖 출처 */
  originOf(threadId: ThreadId): ApprovalOrigin;
  /** 이 대화에서 확장 지점을 쏠 수 있게 연다 */
  openThread(threadId: ThreadId): Promise<void>;
}

export async function fakeApprovals(options: FakeApprovalsOptions = {}): Promise<FakeApprovals> {
  const clock: Clock = options.clock ?? { now: () => 1_767_571_200_000 };
  const ids = options.ids ?? sequentialIds(5000);
  const session = fakeSession({ clock, ids });
  const host = await createTestHost();
  const approvals = createApprovalService({
    session,
    producer: session.producer("core.tools"),
    ids,
    clock,
    ext: host.host,
    logger: undefined,
    callOf: () => undefined,
    modeOf: () => "default",
    setMode: (_threadId, mode) => Promise.resolve({ ok: true, mode }),
    ...(options.resolvedKept === undefined ? {} : { resolvedKept: options.resolvedKept }),
  });
  return {
    approvals,
    session,
    ids,
    originOf: (threadId) => ({
      threadId,
      turnId: null,
      stepId: null,
      toolCallId: null,
      caller: "main",
    }),
    openThread: (threadId) => host.host.openThread(threadId),
  };
}
