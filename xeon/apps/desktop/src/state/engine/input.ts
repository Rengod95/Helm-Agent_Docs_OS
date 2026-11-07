// src/state/engine/input.ts
import type {
  EventId,
  ItemRecord,
  ItemStartedPayload,
  ItemUpdatedPayload,
  ThreadId,
  ThreadStartedPayload,
  ThreadUpdatedPayload,
  TurnCompletedPayload,
  TurnId,
} from "@fresnel/contracts/conversation";
import type { PlanId } from "@fresnel/contracts/capabilities";
import type {
  ApprovalRequestedPayload,
  InputQueuedPayload,
  LeaseAcquiredPayload,
  LeaseRejectedPayload,
  LeaseReleasedPayload,
  ScopeChangedPayload,
  ReviewAppliedPayload,
  ReviewSubmittedPayload,
  ScopeHandlerFailedPayload,
  DialogStatusData,
  StatusItemRecord,
} from "@fresnel/contracts/records";
import type {
  PendingApproval as WirePendingApproval,
  StoreId,
  SubId,
  ThreadSummary,
} from "@fresnel/contracts/wire";
import type { EngineState } from "../../transport/ipc.ts";

type DurableBase = {
  readonly seq: number;
  readonly eventId: EventId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly at: string;
};

/**
 * 계획 사건의 내용(내구, `work.plan_submitted`·`work.plan_withdrawn`). 본문과 산출물은 싣지 않는다.
 * 제출은 "submitted", 승인 없이 나가기는 "withdrawn"이다. 철회 사건은 제목이 없어 title이 null이다.
 */
export type PlanEventFact = {
  readonly planId: PlanId;
  readonly version: number;
  readonly title: string | null;
  readonly status: "submitted" | "withdrawn";
};

/**
 * 큐에 든 입력의 화면 미리보기. 글은 앞 120자(넘으면 "…")만 싣고, 글이 없는 항목(이미지만, 맥락 항목, 빈 글)은 짧은 이름표 키다.
 */
export type QueuedPreview =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "label";
      readonly labelKey: "image" | "context" | "helm" | "empty";
      /** 화면에 그리지 않는 내부 지시(`display: false`). 칩으로 보이지 않는다 */
      readonly internal?: true;
    };

/**
 * 큐에 든 입력 하나의 사실(내구, `input.queued`). 입력 id는 이벤트 id(`DurableBase.eventId`)다.
 * 입력 본문은 미리보기로 줄이고, 출처는 종류만 싣는다.
 */
export type QueuedInputFact = {
  readonly mode: InputQueuedPayload["mode"];
  readonly requestId: string;
  readonly sourceType: InputQueuedPayload["source"]["type"];
  readonly preview: QueuedPreview;
  /**
   * 예약이 넣은 입력의 예약 id(`source.timerId`). 예약 출처가 아니면 없다.
   * 살아 있는 연결에서 시작한 예약 대화의 출처를 거울에서 정하는 데 쓴다(`thread.started`에는 출처가 없다).
   */
  readonly scheduleId?: string;
};

/** 경계에서 payload를 검증한 내구 이벤트. 거울이 쓰지 않는 kind는 other로 위치만 넘긴다 */
export type DurableFact =
  | (DurableBase & { readonly type: "thread.started"; readonly payload: ThreadStartedPayload })
  | (DurableBase & { readonly type: "thread.updated"; readonly payload: ThreadUpdatedPayload })
  | (DurableBase & { readonly type: "thread.closed" })
  | (DurableBase & { readonly type: "turn.started" })
  | (DurableBase & { readonly type: "turn.completed"; readonly payload: TurnCompletedPayload })
  | (DurableBase & { readonly type: "item.recorded"; readonly item: ItemRecord })
  | (DurableBase & {
      readonly type: "approval.requested";
      readonly request: ApprovalRequestedPayload;
    })
  | (DurableBase & { readonly type: "approval.resolved"; readonly approvalId: EventId })
  | (DurableBase & { readonly type: "lease.acquired"; readonly payload: LeaseAcquiredPayload })
  | (DurableBase & { readonly type: "lease.released"; readonly payload: LeaseReleasedPayload })
  | (DurableBase & { readonly type: "lease.rejected"; readonly payload: LeaseRejectedPayload })
  | (DurableBase & { readonly type: "scope.changed"; readonly payload: ScopeChangedPayload })
  | (DurableBase & { readonly type: "review.applied"; readonly payload: ReviewAppliedPayload })
  | (DurableBase & { readonly type: "review.submitted"; readonly payload: ReviewSubmittedPayload })
  | (DurableBase & { readonly type: "plan.event"; readonly plan: PlanEventFact })
  /** 큐에 든 입력. 입력 id는 이 사실의 `eventId`다 */
  | (DurableBase & { readonly type: "input.queued"; readonly input: QueuedInputFact })
  /** 입력이 turn에 배치됐다. `inputId`는 `input.queued`의 이벤트 id다 */
  | (DurableBase & { readonly type: "input.placed"; readonly inputId: EventId })
  /** 입력이 거둬졌다(사용자 철회, 중단, 대체). `inputId`는 `input.queued`의 이벤트 id다 */
  | (DurableBase & { readonly type: "input.withdrawn"; readonly inputId: EventId })
  | (DurableBase & { readonly type: "other" })
  | (DurableBase & { readonly type: "unreadable" });

type VolatileBase = {
  readonly n: number;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
};

export type VolatileFact =
  | (VolatileBase & { readonly type: "item.started"; readonly payload: ItemStartedPayload })
  | (VolatileBase & { readonly type: "item.updated"; readonly payload: ItemUpdatedPayload })
  /** 확장 핸들러 실패. `afterSeq`는 발신 시점의 내구 head다(같은 실패는 열린 대화마다 한 번씩 온다). `at`은 기록된 시각(ISO)이다 */
  | (VolatileBase & {
      readonly type: "scope.handler_failed";
      readonly payload: ScopeHandlerFailedPayload;
      readonly afterSeq: number;
      readonly at: string;
    })
  /** 상태줄 칸 전체 스냅숏. 그 thread의 칸을 통째로 바꾼다 */
  | (VolatileBase & { readonly type: "dialog.status"; readonly payload: DialogStatusData })
  | (VolatileBase & { readonly type: "other" });

/** 엔진 거울의 유일한 입력. 엔진 사실(알림, 요청 결과, 셸 상태)과 컨트롤러의 요청 표시만 담는다 */
export type MirrorInput =
  | { readonly type: "engine"; readonly state: EngineState }
  | { readonly type: "connecting" }
  | {
      readonly type: "subscribed";
      readonly sub: SubId;
      readonly storeId: StoreId;
      readonly start: number;
      readonly live: boolean;
      readonly from: "cursor" | "head";
    }
  | {
      readonly type: "batch";
      readonly sub: SubId;
      readonly from: number;
      readonly to: number;
      readonly caughtUp: boolean;
      readonly facts: readonly DurableFact[];
    }
  | {
      readonly type: "backfill";
      readonly storeId: StoreId;
      readonly facts: readonly DurableFact[];
    }
  | { readonly type: "chunk"; readonly fact: VolatileFact }
  /** `status.list` 결과(열 때와 다시 맞춘 뒤). 그 thread의 칸을 통째로 바꾼다 */
  | {
      readonly type: "status";
      readonly threadId: ThreadId;
      readonly items: readonly StatusItemRecord[];
    }
  | { readonly type: "ended"; readonly sub: SubId }
  | { readonly type: "out_of_range" }
  | { readonly type: "subscribe_failed" }
  | { readonly type: "threads"; readonly threads: readonly ThreadSummary[] }
  /**
   * 새로 열린 대화의 `spawnedBy` 표지. 대화 시작 사실(`thread.started`)에는 위임으로 만든 자식인지가 없어서 목록을 다시 읽어 표지만 가져온다.
   * 표지가 없는 대화에만 붙이고 다른 칸은 건드리지 않는다 [결정: 오케스트레이터 기본값, rtE R-3]
   */
  | {
      readonly type: "spawned";
      readonly marks: readonly {
        readonly threadId: ThreadId;
        readonly spawnedBy: NonNullable<ThreadSummary["spawnedBy"]>;
      }[];
    }
  | { readonly type: "transcript_opening"; readonly threadId: ThreadId }
  | {
      readonly type: "transcript";
      readonly threadId: ThreadId;
      readonly asOfSeq: number;
      readonly items: readonly ItemRecord[];
      /** 읽는 상한에서 멈췄고 더 오래된 item이 남았다 */
      readonly truncated?: true;
    }
  | { readonly type: "transcript_closed" }
  | { readonly type: "approvals"; readonly approvals: readonly WirePendingApproval[] }
  /**
   * 화면이 승인을 대기열에서 뺀다(응답이 이미 해결됐다는 답 뒤의 제거, host가 모르는 승인의 지우기). 내구 사실이 아니라 거울만 바꾼다.
   * 거울에 없는 id면 아무것도 하지 않는다. 뺀 id는 `resolved`에 남아 목록 복원이 되살리지 못한다.
   */
  | { readonly type: "approval_dismissed"; readonly approvalId: EventId }
  | { readonly type: "threads_failed" }
  | {
      readonly type: "transcript_failed";
      readonly threadId: ThreadId;
      /** 읽지 못한 이유. `stale`은 낡은 스냅샷만 받은 경우다 */
      readonly reason: TranscriptFailureReason;
    };

type TranscriptFailureReason = "unavailable" | "failed" | "timeout" | "stale";
