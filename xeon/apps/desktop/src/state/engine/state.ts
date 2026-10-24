// src/state/engine/state.ts
import type {
  EventId,
  ItemId,
  ItemKind,
  ItemRecord,
  PartId,
  PartKind,
  ThreadId,
  TurnId,
} from "@xeon/contracts/conversation";
import type { ApprovalRequestedPayload } from "@xeon/contracts/records";
import type { StoreId, SubId, ThreadSummary } from "@xeon/contracts/wire";
import type { EngineState } from "../../transport/ipc.ts";

/** 재구독으로 고치는 어긋남. 화면 캐시는 그대로 둔다 */
export type ResyncReason = "gap" | "ended" | "subscribe_failed";
/** 캐시를 버리고 head부터 다시 읽어야 하는 어긋남 */
export type ResetReason = "store_changed" | "out_of_range" | "reducer_failed";

export type Link =
  | { readonly phase: "offline" }
  | { readonly phase: "connecting" }
  | { readonly phase: "syncing"; readonly sub: SubId }
  | { readonly phase: "live"; readonly sub: SubId }
  | { readonly phase: "resync"; readonly reason: ResyncReason; readonly attempt: number }
  | { readonly phase: "reset"; readonly reason: ResetReason; readonly attempt: number }
  | { readonly phase: "failed"; readonly reason: ResyncReason | ResetReason };

type Cursor = { readonly storeId: StoreId; readonly seq: number };

/** loading: 아직 읽지 않았거나 다시 읽는 중. error: 읽기에 실패했고 가진 것이 없다. 빈 목록과 구분하려는 표시다 */
type Threads = {
  readonly status: "loading" | "ready" | "error";
  readonly ids: readonly ThreadId[];
  readonly byId: Readonly<Record<string, ThreadSummary>>;
};

/**
 * 열린 thread 하나의 확정 item. loading 동안 그 thread의 item.recorded를 held에 모았다가
 * 스냅샷이 오면 asOfSeq보다 뒤의 것만 적용한다(스냅샷 + 재생).
 */
export type Transcript =
  | {
      readonly status: "loading";
      readonly threadId: ThreadId;
      /** 여는 시점의 cursor.seq. 스냅샷은 이 위치 이상을 반영해야 한다 */
      readonly sinceSeq: number;
      readonly held: readonly { readonly seq: number; readonly item: ItemRecord }[];
    }
  | {
      readonly status: "ready";
      readonly threadId: ThreadId;
      /** 스냅샷이 반영한 마지막 seq. 이 seq 이하 이벤트는 이 조각에 다시 적용하지 않는다 */
      readonly asOfSeq: number;
      readonly itemIds: readonly ItemId[];
      readonly items: Readonly<Record<string, ItemRecord>>;
    }
  | { readonly status: "error"; readonly threadId: ThreadId };

export type StreamingPart = {
  readonly partId: PartId;
  readonly contentIndex: number;
  readonly kind: PartKind;
  readonly text: string;
  readonly done: boolean;
};

export type StreamingItem = {
  readonly itemId: ItemId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly kind: ItemKind;
  readonly toolName: string | null;
  readonly parts: readonly StreamingPart[];
};

export type Streaming = {
  readonly itemIds: readonly ItemId[];
  readonly items: Readonly<Record<string, StreamingItem>>;
  /** (threadId, turnId)별 마지막으로 적용한 조각 번호 n */
  readonly lastN: Readonly<Record<string, number>>;
  /** 최근 확정된 item id. 늦게 온 조각을 걸러낸다. 가장 오래된 것부터 SETTLED_CAP개까지 */
  readonly settledItems: readonly ItemId[];
  /** 최근 끝난 (threadId, turnId) 키. turnId가 null인 조각은 넣지 않는다 */
  readonly settledTurns: readonly string[];
};

/** 확정 표식을 남기는 개수 상한 */
export const SETTLED_CAP = 256;

export type PendingApproval = {
  readonly approvalId: EventId;
  readonly threadId: ThreadId;
  readonly seq: number;
  readonly request: ApprovalRequestedPayload;
};

type Approvals = {
  /** 최근 해결된 승인 id(SETTLED_CAP개까지). approval.list 결과가 이미 해결된 승인을 되살리지 못하게 한다 */
  readonly resolved: readonly EventId[];
  readonly ids: readonly EventId[];
  readonly byId: Readonly<Record<string, PendingApproval>>;
};

export type EngineMirror = {
  readonly engine: EngineState | null;
  readonly link: Link;
  readonly cursor: Cursor | null;
  readonly threads: Threads;
  readonly transcript: Transcript | null;
  readonly streaming: Streaming;
  readonly approvals: Approvals;
};

export const EMPTY_STREAMING: Streaming = {
  itemIds: [],
  items: {},
  lastN: {},
  settledItems: [],
  settledTurns: [],
};

export const INITIAL_MIRROR: EngineMirror = {
  engine: null,
  link: { phase: "offline" },
  cursor: null,
  threads: { status: "loading", ids: [], byId: {} },
  transcript: null,
  streaming: EMPTY_STREAMING,
  approvals: { resolved: [], ids: [], byId: {} },
};
