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
} from "@xeon/contracts/conversation";
import type { ApprovalRequestedPayload } from "@xeon/contracts/records";
import type {
  PendingApproval as WirePendingApproval,
  StoreId,
  SubId,
  ThreadSummary,
} from "@xeon/contracts/wire";
import type { EngineState } from "../../transport/ipc.ts";

type DurableBase = {
  readonly seq: number;
  readonly eventId: EventId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly at: string;
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
  | { readonly type: "chunk"; readonly fact: VolatileFact }
  | { readonly type: "ended"; readonly sub: SubId }
  | { readonly type: "out_of_range" }
  | { readonly type: "subscribe_failed" }
  | { readonly type: "threads"; readonly threads: readonly ThreadSummary[] }
  | { readonly type: "transcript_opening"; readonly threadId: ThreadId }
  | {
      readonly type: "transcript";
      readonly threadId: ThreadId;
      readonly asOfSeq: number;
      readonly items: readonly ItemRecord[];
    }
  | { readonly type: "transcript_closed" }
  | { readonly type: "approvals"; readonly approvals: readonly WirePendingApproval[] }
  | { readonly type: "threads_failed" }
  | { readonly type: "transcript_failed"; readonly threadId: ThreadId };
