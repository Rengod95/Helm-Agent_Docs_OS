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
} from "@fresnel/contracts/conversation";
import type { TransitionEntry } from "@fresnel/client/workbench";
import type { PlanEventFact, QueuedInputFact } from "./input.ts";
import type {
  ApprovalRequestedPayload,
  ReviewAppliedPayload,
  ReviewSubmittedPayload,
  StatusItemRecord,
} from "@fresnel/contracts/records";
import type { StoreId, SubId, ThreadSummary } from "@fresnel/contracts/wire";
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
  /** 조각을 이어 붙인 원문. 호스트의 누적 길이와 맞는지 보려고만 쓴다. 화면에는 `text`만 나간다 */
  readonly raw: string;
  /** 화면에 그릴 텍스트. 호스트의 화면 가림 표식을 적용한 것이다(L0.secrets.spec §3.5.1) */
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

/** thread별 최근 turn id를 남기는 개수 상한 */
export const RECENT_TURN_CAP = 40;

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

/** 변경 검토 한 리뷰의 가장 최근 라운드 결과. `review_applied`(되돌림 결과)와 `review_submitted`(에이전트 전달)를 한 줄로 모은다 */
export type ReviewResult = {
  readonly reviewId: string;
  readonly round: number;
  /** `review_applied`의 결과. 되돌릴 것이 없었으면 이벤트가 없어서 null이다 */
  readonly outcomes: ReviewAppliedPayload["outcomes"] | null;
  /** `review_submitted`가 왔는지. 제출 결과 표는 이 값이 참일 때만 그린다 */
  readonly submitted: boolean;
  /** 에이전트 입력 전달. 전달할 결정·의견이 없었으면 null */
  readonly delivery: ReviewSubmittedPayload["delivery"];
};

/** 결과 기록 상한(리뷰 수). 넘으면 가장 오래된 리뷰부터 버린다 */
export const REVIEW_RESULT_CAP = 64;

/** 확장 핸들러 실패 기록 한 건(`scope.handler_failed`). owner는 "ext:<이름>" 또는 "hook:<이름>"이다 */
export type HandlerFailureRecord = {
  readonly owner: string;
  readonly point: string;
  readonly result: string;
  readonly message: string;
  readonly consecutive: number;
  /** 발신 시점의 내구 head. 같은 실패가 열린 대화마다 올 때 한 번만 넣으려고 쓴다 */
  readonly afterSeq: number;
};

/** 실패 기록 상한(행). 넘으면 가장 오래된 것부터 버린다(§6.24 기록 500행) */
export const HANDLER_FAILURE_CAP = 500;

/** 받은 전환 기록 한 건(`lease.*`·`scope.changed`, 내구). 화면 모델의 항목에 thread id를 더한다 */
export type TransitionRecord = TransitionEntry & { readonly threadId: ThreadId };

/** 전환 기록 상한(thread마다). 넘으면 그 thread의 가장 오래된 것부터 버린다(spec §4.9.8 최근 20개) */
export const TRANSITION_CAP = 20;

/** 받은 계획 기록 한 건. 계획마다 가장 최근에 받은 판 하나다. 계획 카드가 계획 id를 찾는 데 쓴다 */
export type PlanRecord = PlanEventFact & { readonly threadId: ThreadId };

/** 계획 기록 상한(thread마다). 넘으면 그 thread의 가장 오래된 계획부터 버린다 */
export const PLAN_CAP = 20;

/** 아직 배치되지 않은 대기 입력 한 건. 입력 id는 `input.queued` 이벤트 id다. 철회 칩이 쓴다 */
export type QueuedInput = QueuedInputFact & {
  readonly inputId: EventId;
  readonly threadId: ThreadId;
};

/** 대기 입력 기록 상한(thread마다). 넘으면 그 thread의 가장 오래된 입력부터 버린다 */
export const QUEUED_INPUT_CAP = 20;
/** 끝난 입력 id를 기억하는 수 */
export const SETTLED_INPUT_CAP = 256;

/** 상태줄 칸 수 상한(`DialogStatusData`의 `items` 상한과 같다) */
export const STATUS_ITEM_CAP = 32;

export type EngineMirror = {
  readonly engine: EngineState | null;
  readonly link: Link;
  readonly cursor: Cursor | null;
  readonly threads: Threads;
  readonly transcript: Transcript | null;
  readonly streaming: Streaming;
  readonly approvals: Approvals;
  /** 실패로 끝난 마지막 turn의 오류 문장. thread별이며 다음 turn이 시작되면 지운다 */
  readonly turnFailures: Readonly<Record<string, string>>;
  /** thread별 가장 최근 turn id. thread.list의 `lastTurnId`로 먼저 채우고(없을 때만), 이후 `turn.started` 사실이 덮는다. 최근 실행 읽기가 턴을 고를 때 쓴다. 거울을 head부터 다시 맞추면 비우고, 뒤이은 목록 읽기가 다시 채운다 */
  readonly latestTurnId: Readonly<Record<string, TurnId>>;
  /** thread별로 이 거울이 본 최근 turn id(오래된 것부터, `RECENT_TURN_CAP`개까지). `lastTurnId`와 `turn.started` 사실로 채운다. 성능 측정 화면이 읽어 볼 Turn 후보를 고를 때 쓴다 */
  readonly recentTurnIds: Readonly<Record<string, readonly TurnId[]>>;
  /** 받은 확장 핸들러 실패 기록(휘발). 받은 순서대로 가장 새 것이 뒤에 오고 `HANDLER_FAILURE_CAP`행까지 둔다 */
  readonly handlerFailures: readonly HandlerFailureRecord[];
  /**
   * 받은 전환 기록(내구). 받은 순서이고 thread마다 `TRANSITION_CAP`개까지 둔다. 연결 전에 일어난 전환은 읽어 오지 않는다.
   * 거울을 head부터 다시 맞추면 비운다(실패 기록과 같다)
   */
  readonly transitions: readonly TransitionRecord[];
  /**
   * 받은 계획 기록(내구, `work.plan_*`). 계획마다 한 줄이고 가장 최근에 받은 사건이 뒤에 온다. thread마다 `PLAN_CAP`개까지 둔다.
   * 연결 전에 낸 계획은 읽어 오지 않는다. 거울을 head부터 다시 맞추면 비운다(전환 기록과 같다)
   */
  readonly plans: readonly PlanRecord[];
  /**
   * 아직 배치되지 않은 대기 입력(내구, `input.queued`). 받은 순서이고 thread마다 `QUEUED_INPUT_CAP`개까지 둔다.
   * `input.placed`·`input.withdrawn`이 오면 뺀다. 연결 전에 든 입력과 계획은 head부터 맞춘 뒤 `work.plan_`·`input.`만 거르는 처음부터의 재생(`backfill`)으로 채운다.
   * 거울을 head부터 다시 맞추면 비운다
   */
  readonly queuedInputs: readonly QueuedInput[];
  /**
   * thread별 상태줄 칸(B-09). 열 때 `status.list` 스냅숏으로 처음 채우고, 이후 휘발 `dialog.status`(전체 스냅숏)가 통째로 덮는다.
   * 스냅숏을 요청하는 동안 이벤트가 왔으면 링크가 스냅숏을 버린다(늦게 온 응답이 더 새 이벤트를 덮지 않게). 거울을 head부터 다시 맞추면 비운다
   */
  readonly statusItems: Readonly<Record<string, readonly StatusItemRecord[]>>;
  /** 이미 배치되거나 거둬진 입력 id(최근 `SETTLED_INPUT_CAP`개). 늦게 온 재생이 끝난 입력을 칩으로 되살리지 않게 한다 */
  readonly settledInputs: readonly EventId[];
  /** 변경 검토 결과(리뷰마다 가장 최근 라운드 하나). 받은 순서대로 가장 새 것이 뒤에 오고 `REVIEW_RESULT_CAP`개까지 둔다 */
  readonly reviewResults: readonly ReviewResult[];
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
  turnFailures: {},
  latestTurnId: {},
  recentTurnIds: {},
  handlerFailures: [],
  transitions: [],
  plans: [],
  queuedInputs: [],
  statusItems: {},
  settledInputs: [],
  reviewResults: [],
};
