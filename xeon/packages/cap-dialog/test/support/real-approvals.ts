// 실제 L1.tools 승인 서비스(core-tools의 ApprovalService)를 질문 시험에 붙인다. 승인 요청과 해결, 응답 검사(kind question의 QuestionAnswer 규칙),
// 취소, 메모리 대기는 모두 core-tools의 실제 구현이다. 저장소만 core-tools의 `fakeSession`(커밋 요청과 이벤트 열을 기록하는 세션)이다.
// 이 파일이 더하는 것은 시험이 쓰는 관찰 창(요청 목록, 호출 문맥)과 장애 주입뿐이다.
import { Bug, parse } from "@xeon/contracts";
import type { CallContext } from "@xeon/contracts/capabilities";
import { toJsonValue, type ApprovalId, type JsonValue } from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  type ProducerHandle,
  type StoreError,
} from "@xeon/contracts/records";
import type {
  ApprovalApplyOutcome,
  ApprovalDecision,
  L2ApprovalRequest,
  L2ApprovalSnapshot,
} from "@xeon/contracts/services";
import {
  fakeSession,
  realTools,
  sequentialIds,
  type FakeSession,
  type RealTools,
} from "@xeon/core-tools/testing";
import { questionApprovalsOver, type ApprovalsPortFactory } from "../../src/ports/approvals.ts";

const NOW = 1_767_571_200_000;
const REQUEST_COMMIT_KEY = /^approval:.+:request$/;

export interface RealApprovals {
  /** `dialogPlugin`이 기본으로 만드는 것과 같은 `questionApprovalsOver` 어댑터. 요청과 호출 문맥을 기록한다 */
  readonly factory: ApprovalsPortFactory;
  /** 어댑터의 `request`로 들어온 요청을 들어온 순서대로 */
  readonly requests: L2ApprovalRequest[];
  /** `forCall`이 받은 호출 문맥 */
  readonly contexts: (CallContext | undefined)[];
  readonly session: FakeSession;
  readonly l1: RealTools;
  /** 이벤트 로그의 승인 요청(멱등 재요청은 세지 않는다). `subject`는 body의 질문 묶음이다 */
  entries(): readonly { readonly approvalId: ApprovalId; readonly subject: JsonValue }[];
  /** 클라이언트가 `approval.respond`를 보낸 것처럼 응답한다. 검사에 걸리면 applied: false에 이유가 붙는다 */
  respond(
    approvalId: ApprovalId,
    decision: ApprovalDecision,
    answer?: JsonValue,
  ): Promise<ApprovalApplyOutcome>;
  /** 이 서비스 인스턴스가 아는 요청의 현재 상태. 재시작 직후에는 요청을 다시 불러야 보인다 */
  snapshotOf(approvalId: ApprovalId): L2ApprovalSnapshot | undefined;
  /**
   * 응답 검사 없이 `approval.resolved`를 이벤트 로그에 쓴다(구버전 클라이언트나 다른 프로세스가 남긴 규칙 밖 해결).
   * 이 인스턴스의 메모리 대기는 모르므로 `restart()`한 인스턴스로 읽는다
   */
  forceResolve(approvalId: ApprovalId, decision: ApprovalDecision, answer: JsonValue | null): void;
  /** 다음 승인 요청 커밋 한 번을 이 저장소 오류로 실패시킨다 */
  failNext(error: StoreError): void;
  /** 프로세스 재시작: 같은 이벤트 로그 위에 새 ApprovalService를 세운다(메모리 대기 목록이 비어 있다) */
  restart(): Promise<RealApprovals>;
}

interface Shared {
  readonly session: FakeSession;
  readonly producer: ProducerHandle;
  readonly faults: { next: StoreError | undefined };
}

function jsonOf(value: unknown): JsonValue {
  const json = toJsonValue(value);
  if (json === undefined) throw new Bug("real approvals: a stored value is not plain JSON");
  return json;
}

async function build(shared: Shared | undefined): Promise<RealApprovals> {
  const ids = sequentialIds(9000);
  const faults = shared?.faults ?? { next: undefined };
  const session =
    shared?.session ??
    fakeSession({
      clock: { now: () => NOW },
      ids,
      fault: (request) => {
        if (faults.next === undefined || !REQUEST_COMMIT_KEY.test(request.requestId)) {
          return undefined;
        }
        const error = faults.next;
        faults.next = undefined;
        return error;
      },
    });
  const l1 = await realTools({
    session,
    clock: { now: () => NOW },
    ids,
    ...(shared === undefined ? {} : { producer: shared.producer }),
  });
  const base = questionApprovalsOver(l1.approvals);
  const requests: L2ApprovalRequest[] = [];
  const contexts: (CallContext | undefined)[] = [];
  const factory: ApprovalsPortFactory = {
    forCall(context) {
      contexts.push(context);
      const port = base.forCall(context);
      return {
        ...port,
        request(input) {
          requests.push(input);
          return port.request(input);
        },
      };
    },
  };
  const self: RealApprovals = {
    factory,
    requests,
    contexts,
    session,
    l1,
    entries() {
      return session.events
        .filter((event) => event.kind === "approval.requested")
        .map((event) => {
          const payload = parse(ApprovalRequestedPayloadSchema, event.payload);
          if (!payload.ok || payload.value.body.kind !== "question") {
            throw new Bug("real approvals: a stored question request is damaged");
          }
          return { approvalId: event.id, subject: jsonOf(payload.value.body.question) };
        });
    },
    respond: (approvalId, decision, answer) =>
      l1.approvals.respond(approvalId, {
        decision,
        ...(answer === undefined ? {} : { answer }),
      }),
    snapshotOf(approvalId) {
      const opened = l1.approvals.get(approvalId);
      if (opened === undefined) return undefined;
      const { resolution } = opened;
      if (resolution === null) return { approvalId, state: "pending", resolution: null };
      const closed =
        resolution.resolvedBy === "cancelled" || resolution.resolvedBy === "superseded";
      return {
        approvalId,
        state: closed ? "cancelled" : "resolved",
        resolution: { decision: resolution.decision, answer: resolution.answer },
      };
    },
    forceResolve(approvalId, decision, answer) {
      const request = session.events.find((event) => event.id === approvalId);
      if (request === undefined) throw new Bug("real approvals: unknown approval id");
      const committed = session.commit({
        threadId: request.threadId,
        requestId: `forced:${approvalId}`,
        fingerprintSource: { approvalId },
        build: () => ({
          kind: "append",
          drafts: [
            l1.producer.draft({
              id: l1.ids.next("evt"),
              kind: "approval.resolved",
              threadId: request.threadId,
              turnId: null,
              stepId: null,
              causationId: approvalId,
              correlationId: null,
              payload: {
                approvalId,
                decision,
                answer,
                remember: "once",
                requestedRemember: null,
                resolvedBy: "user",
              },
            }),
          ],
          checkpoint: null,
        }),
      });
      if (!committed.ok)
        throw new Bug("real approvals: forced resolution failed", { cause: committed.error });
    },
    failNext(error) {
      faults.next = error;
    },
    restart: () => build({ session, producer: l1.producer, faults }),
  };
  return self;
}

export function realApprovals(): Promise<RealApprovals> {
  return build(undefined);
}
