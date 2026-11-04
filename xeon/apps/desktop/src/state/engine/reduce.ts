// src/state/engine/reduce.ts (발췌. 7절 표의 나머지 분기도 같은 모양이다)
import { assertNever, Bug } from "@fresnel/contracts";
import {
  maskPartText,
  type EventId,
  type ItemId,
  type ItemRecord,
  type PartDelta,
  type ThreadId,
  type TurnId,
} from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { Reduced as SharedReduced } from "../shared/pipeline.ts";
import type { DurableFact, MirrorInput, VolatileFact } from "./input.ts";
import { unknownFailureText } from "./failure-text.ts";
import {
  EMPTY_STREAMING,
  HANDLER_FAILURE_CAP,
  INITIAL_MIRROR,
  TRANSITION_CAP,
  REVIEW_RESULT_CAP,
  type EngineMirror,
  type HandlerFailureRecord,
  type Link,
  type ResetReason,
  type PendingApproval,
  type ResyncReason,
  type ReviewResult,
  type Streaming,
  type StreamingItem,
  type StreamingPart,
  type Transcript,
  RECENT_TURN_CAP,
  type TransitionRecord,
  PLAN_CAP,
  type PlanRecord,
  QUEUED_INPUT_CAP,
  type QueuedInput,
  SETTLED_CAP,
  SETTLED_INPUT_CAP,
} from "./state.ts";

/** 이 입력이 거울에 한 일. journal이 기록한다 */
export type ApplyNote = "applied" | "duplicate" | "stale" | "foreign" | "gap" | "reset" | "failed";
type Reduced<S> = SharedReduced<S, ApplyNote>;

/** 같은 원인으로 이 횟수를 넘겨 다시 맞추면 failed로 둔다 */
export const MAX_SYNC_ATTEMPTS = 3;

const keep = (state: EngineMirror, note: ApplyNote): Reduced<EngineMirror> => ({ state, note });
/** 최근 turn id 목록에 하나를 더한다. 이미 있으면 그대로 두고, 상한을 넘으면 가장 오래된 것부터 버린다 */
function withRecentTurn(list: readonly TurnId[] | undefined, id: TurnId): readonly TurnId[] {
  const base = list ?? [];
  if (base.includes(id)) return base;
  return [...base, id].slice(-RECENT_TURN_CAP);
}

const turnKey = (threadId: ThreadId, turnId: TurnId | null): string =>
  `${threadId}:${turnId ?? ""}`;

function enterResync(state: EngineMirror, reason: ResyncReason): EngineMirror {
  if (state.link.phase === "failed") return state; // failed는 connecting 입력으로만 벗어난다
  const attempt = state.link.phase === "resync" ? state.link.attempt + 1 : 1;
  const link: Link =
    attempt > MAX_SYNC_ATTEMPTS
      ? { phase: "failed", reason }
      : { phase: "resync", reason, attempt };
  return { ...state, link };
}

export function enterReset(state: EngineMirror, reason: ResetReason): EngineMirror {
  if (state.link.phase === "failed") return state;
  const attempt = state.link.phase === "reset" ? state.link.attempt + 1 : 1;
  const link: Link =
    attempt > MAX_SYNC_ATTEMPTS ? { phase: "failed", reason } : { phase: "reset", reason, attempt };
  return { ...state, link };
}

function withTurnFailure(
  state: EngineMirror,
  threadId: ThreadId,
  failure: string | null,
): EngineMirror {
  const { [threadId]: _old, ...rest } = state.turnFailures;
  return {
    ...state,
    turnFailures: failure === null ? rest : { ...rest, [threadId]: failure },
  };
}

/** 순수 함수. 엔진 거울의 모든 변경은 여기서만 일어난다 */
export function reduceMirror(state: EngineMirror, input: MirrorInput): Reduced<EngineMirror> {
  switch (input.type) {
    case "engine":
      return input.state.kind === "running"
        ? keep({ ...state, engine: input.state }, "applied")
        : keep(
            {
              ...state,
              engine: input.state,
              link: { phase: "offline" },
              streaming: EMPTY_STREAMING,
            },
            "applied",
          );
    case "subscribed": {
      const link: Link = input.live
        ? { phase: "live", sub: input.sub }
        : { phase: "syncing", sub: input.sub };
      const cursor = { storeId: input.storeId, seq: input.start };
      if (input.from === "head") {
        return keep({ ...INITIAL_MIRROR, engine: state.engine, link, cursor }, "reset");
      }
      if (state.cursor === null || state.cursor.storeId !== input.storeId) {
        return keep(enterReset(state, "store_changed"), "reset");
      }
      return keep({ ...state, link, cursor }, "applied");
    }
    case "batch":
      return applyBatch(state, input);
    case "chunk":
      return applyChunk(state, input.fact);
    case "backfill": {
      // 연결 전에 생긴 계획과 대기 입력(`work.plan_*`, `input.*`)을 처음부터 다시 받은 것이다. 거울의 위치와 연결 상태는 건드리지 않는다.
      // 다른 저장소의 재생이면 버린다. 계획과 대기 입력 사실만 같은 규칙으로 넣는다(이미 있는 것은 그대로다)
      const cursor = state.cursor;
      if (cursor === null || cursor.storeId !== input.storeId) return keep(state, "foreign");
      let next = state;
      for (const fact of input.facts) {
        if (
          fact.type === "plan.event" ||
          fact.type === "input.queued" ||
          fact.type === "input.placed" ||
          fact.type === "input.withdrawn"
        ) {
          next = applyFact(next, fact);
        }
      }
      return keep(next, "applied");
    }
    case "out_of_range":
      return keep(enterReset(state, "out_of_range"), "reset");
    case "subscribe_failed":
      return keep(enterResync(state, "subscribe_failed"), "gap");
    case "connecting":
      return keep({ ...state, link: { phase: "connecting" } }, "applied");
    case "ended": {
      const link = state.link;
      if ((link.phase !== "syncing" && link.phase !== "live") || link.sub !== input.sub) {
        return keep(state, "foreign");
      }
      return keep(enterResync(state, "ended"), "gap");
    }
    case "threads": {
      const byId: Record<string, ThreadSummary> = {};
      // 목록의 lastTurnId는 거울이 아직 turn을 모르는 thread에만 채운다. 이미 있는 값은 turn.started 사실이라 더 새것이다
      const latestTurnId: Record<string, TurnId> = { ...state.latestTurnId };
      const recentTurnIds: Record<string, readonly TurnId[]> = { ...state.recentTurnIds };
      for (const t of input.threads) {
        byId[t.threadId] = t;
        if (t.lastTurnId !== undefined && latestTurnId[t.threadId] === undefined) {
          latestTurnId[t.threadId] = t.lastTurnId;
        }
        if (t.lastTurnId !== undefined) {
          recentTurnIds[t.threadId] = withRecentTurn(recentTurnIds[t.threadId], t.lastTurnId);
        }
      }
      return keep(
        {
          ...state,
          threads: { status: "ready", ids: input.threads.map((t) => t.threadId), byId },
          latestTurnId,
          recentTurnIds,
        },
        "applied",
      );
    }
    case "threads_failed": {
      // 이미 읽은 목록이 있으면 그대로 둔다. 가진 것이 없을 때만 오류를 보인다
      if (state.threads.status === "ready") return keep(state, "stale");
      return keep({ ...state, threads: { ...state.threads, status: "error" } }, "applied");
    }
    case "transcript_opening":
      return keep(
        {
          ...state,
          transcript: {
            status: "loading",
            threadId: input.threadId,
            sinceSeq: state.cursor?.seq ?? 0,
            held: [],
          },
        },
        "applied",
      );
    case "transcript":
      return applySnapshot(state, input);
    case "approvals": {
      // approval.list 결과(재설정 뒤 복원). 이미 있거나 이미 해결된 승인은 건너뛴다
      const fresh = input.approvals.filter(
        (a) =>
          state.approvals.byId[a.approvalId] === undefined &&
          !state.approvals.resolved.includes(a.approvalId),
      );
      if (fresh.length === 0) return keep(state, "applied");
      const byId: Record<string, PendingApproval> = { ...state.approvals.byId };
      for (const a of fresh) {
        byId[a.approvalId] = {
          approvalId: a.approvalId,
          threadId: a.request.surfaceThreadId,
          seq: a.seq,
          request: a.request,
        };
      }
      const ids = [...state.approvals.ids, ...fresh.map((a) => a.approvalId)];
      return keep({ ...state, approvals: { ...state.approvals, ids, byId } }, "applied");
    }
    case "transcript_failed": {
      const t = state.transcript;
      if (t === null || t.status !== "loading" || t.threadId !== input.threadId)
        return keep(state, "foreign");
      return keep({ ...state, transcript: { status: "error", threadId: t.threadId } }, "applied");
    }
    case "transcript_closed":
      return keep({ ...state, transcript: null }, "applied");
    default:
      return assertNever(input, "reduceMirror");
  }
}

function applyBatch(
  state: EngineMirror,
  input: Extract<MirrorInput, { type: "batch" }>,
): Reduced<EngineMirror> {
  const link = state.link;
  if ((link.phase !== "syncing" && link.phase !== "live") || link.sub !== input.sub) {
    return keep(state, "foreign");
  }
  const cursor = state.cursor;
  if (cursor === null) {
    // subscribed가 cursor를 먼저 둔다. 없으면 입력 순서 불변식이 깨진 것이다
    throw new Bug("batch before subscribed");
  }
  if (input.to <= cursor.seq) return keep(state, "duplicate");
  if (input.from > cursor.seq) return keep(enterResync(state, "gap"), "gap");
  let next = state;
  const recorded: (Recorded & { readonly threadId: ThreadId })[] = [];
  for (const fact of input.facts) {
    if (fact.seq <= cursor.seq) continue;
    next = applyFact(next, fact); // 7.2 표
    if (fact.type === "item.recorded")
      recorded.push({ seq: fact.seq, item: fact.item, threadId: fact.threadId });
  }
  const open = next.transcript;
  if (open !== null) {
    const mine = recorded.filter((e) => e.threadId === open.threadId);
    if (mine.length > 0) next = { ...next, transcript: recordItems(open, mine) };
  }
  const nextLink: Link = input.caughtUp ? { phase: "live", sub: link.sub } : link;
  return keep(
    { ...next, cursor: { storeId: cursor.storeId, seq: input.to }, link: nextLink },
    "applied",
  );
}

function applyChunk(state: EngineMirror, fact: VolatileFact): Reduced<EngineMirror> {
  const key = turnKey(fact.threadId, fact.turnId);
  if (fact.turnId !== null && state.streaming.settledTurns.includes(key))
    return keep(state, "stale");
  const last = state.streaming.lastN[key];
  if (last !== undefined && fact.n <= last) return keep(state, "duplicate");
  const counted: Streaming = {
    ...state.streaming,
    lastN: { ...state.streaming.lastN, [key]: fact.n },
  };
  switch (fact.type) {
    case "item.started": {
      const p = fact.payload;
      if (isRecorded(state, p.itemId)) return keep({ ...state, streaming: counted }, "stale");
      const item: StreamingItem = {
        itemId: p.itemId,
        threadId: fact.threadId,
        turnId: fact.turnId,
        kind: p.kind,
        toolName: p.toolName,
        parts: [],
      };
      return keep({ ...state, streaming: putStreaming(counted, item) }, "applied");
    }
    case "item.updated": {
      const update = fact.payload.update;
      switch (update.kind) {
        case "part_delta": {
          if (isRecorded(state, update.delta.itemId))
            return keep({ ...state, streaming: counted }, "stale");
          const current =
            counted.items[update.delta.itemId] ?? newAssistantItem(fact, update.delta);
          return keep(
            { ...state, streaming: putStreaming(counted, applyDelta(current, update.delta)) },
            "applied",
          );
        }
        case "part_completed":
        case "tool_progress":
          return keep({ ...state, streaming: counted }, "applied");
        default:
          return assertNever(update, "applyChunk.update");
      }
    }
    case "scope.handler_failed": {
      const p = fact.payload;
      const record: HandlerFailureRecord = {
        owner: p.owner,
        point: p.point,
        result: p.result,
        message: p.message,
        consecutive: p.consecutive,
        afterSeq: fact.afterSeq,
      };
      // 같은 실패는 열린 대화마다 한 번씩 온다. 발신 시점(afterSeq)과 내용이 같으면 한 번만 넣는다
      if (state.handlerFailures.some((r) => sameFailure(r, record))) {
        return keep({ ...state, streaming: counted }, "duplicate");
      }
      const handlerFailures = [...state.handlerFailures, record].slice(-HANDLER_FAILURE_CAP);
      return keep({ ...state, streaming: counted, handlerFailures }, "applied");
    }
    case "other":
      return keep({ ...state, streaming: counted }, "applied");
    default:
      return assertNever(fact, "applyChunk");
  }
}

function sameFailure(a: HandlerFailureRecord, b: HandlerFailureRecord): boolean {
  return (
    a.afterSeq === b.afterSeq &&
    a.owner === b.owner &&
    a.point === b.point &&
    a.result === b.result &&
    a.message === b.message &&
    a.consecutive === b.consecutive
  );
}

function isRecorded(state: EngineMirror, itemId: ItemId): boolean {
  const t = state.transcript;
  return (
    state.streaming.settledItems.includes(itemId) ||
    (t?.status === "ready" && t.items[itemId] !== undefined)
  );
}

/** 델타 하나의 비용은 그 item의 파트 수에 비례한다. 확정 item 레코드는 복사하지 않는다 */
function applyDelta(item: StreamingItem, delta: PartDelta): StreamingItem {
  const index = item.parts.findIndex((p) => p.contentIndex === delta.contentIndex);
  const before = index === -1 ? undefined : item.parts[index];
  const raw = delta.phase === "delta" ? (before?.raw ?? "") + delta.delta : (before?.raw ?? "");
  // 화면 텍스트는 호스트의 표식을 적용한 것이다. 표식이 맞지 않으면(조각을 놓쳤으면) 확정 item이 올 때까지 비운다
  const part: StreamingPart = {
    partId: delta.partId,
    contentIndex: delta.contentIndex,
    kind: delta.kind,
    raw,
    text: maskPartText(raw, delta.mask),
    done: delta.phase === "end",
  };
  const parts =
    index === -1
      ? [...item.parts, part].toSorted((a, b) => a.contentIndex - b.contentIndex)
      : item.parts.with(index, part);
  return { ...item, parts };
}
// ---- 7.2 표를 옮긴 나머지 함수(문서에는 표로만 있다) ----

function patchThread(
  state: EngineMirror,
  id: ThreadId,
  patch: (t: ThreadSummary) => ThreadSummary,
): EngineMirror {
  const current = state.threads.byId[id];
  if (current === undefined) return state;
  return {
    ...state,
    threads: { ...state.threads, byId: { ...state.threads.byId, [id]: patch(current) } },
  };
}

function bumpPending(state: EngineMirror, id: ThreadId, delta: 1 | -1): EngineMirror {
  return patchThread(state, id, (t) => ({
    ...t,
    pendingApprovals: Math.max(0, t.pendingApprovals + delta),
  }));
}

function putStreaming(streaming: Streaming, item: StreamingItem): Streaming {
  const known = streaming.items[item.itemId] !== undefined;
  return {
    ...streaming,
    itemIds: known ? streaming.itemIds : [...streaming.itemIds, item.itemId],
    items: { ...streaming.items, [item.itemId]: item },
  };
}

function newAssistantItem(
  fact: Extract<VolatileFact, { type: "item.updated" }>,
  delta: PartDelta,
): StreamingItem {
  return {
    itemId: delta.itemId,
    threadId: fact.threadId,
    turnId: fact.turnId,
    kind: "assistant",
    toolName: null,
    parts: [],
  };
}

const capped = <T>(list: readonly T[], value: T): readonly T[] =>
  list.includes(value) ? list : [...list, value].slice(-SETTLED_CAP);

/** 슬롯을 지우고 확정 표식을 남긴다. 늦게 온 조각이 슬롯을 되살리지 못한다 */
function settleItem(streaming: Streaming, itemId: ItemId): Streaming {
  const settledItems = capped(streaming.settledItems, itemId);
  if (streaming.items[itemId] === undefined) return { ...streaming, settledItems };
  const { [itemId]: _gone, ...items } = streaming.items;
  return {
    ...streaming,
    settledItems,
    itemIds: streaming.itemIds.filter((id) => id !== itemId),
    items,
  };
}

function dropStreamingTurn(
  streaming: Streaming,
  threadId: ThreadId,
  turnId: TurnId | null,
): Streaming {
  const key = turnKey(threadId, turnId);
  const itemIds = streaming.itemIds.filter((id) => {
    const it = streaming.items[id];
    return it === undefined || turnKey(it.threadId, it.turnId) !== key;
  });
  const items: Record<string, StreamingItem> = {};
  for (const id of itemIds) {
    const it = streaming.items[id];
    if (it !== undefined) items[id] = it;
  }
  const { [key]: _n, ...lastN } = streaming.lastN;
  const settledTurns =
    turnId === null ? streaming.settledTurns : capped(streaming.settledTurns, key);
  return { ...streaming, itemIds, items, lastN, settledTurns };
}

type Recorded = { readonly seq: number; readonly item: ItemRecord };

/**
 * 확정 item 여러 개를 transcript에 한 번의 복사로 넣는다. 하나씩 넣으면 K개에 O(K·N)이다
 * (N=8,000, K=500에서 JavaScriptCore 320 ms). entries는 모두 t의 thread 것이다.
 */
function recordItems(t: Transcript, entries: readonly Recorded[]): Transcript {
  if (t.status === "error") return t;
  if (t.status === "loading")
    return entries.length === 0 ? t : { ...t, held: [...t.held, ...entries] };
  const fresh = entries.filter((e) => e.seq > t.asOfSeq);
  if (fresh.length === 0) return t;
  const items: Record<string, ItemRecord> = { ...t.items };
  const added: ItemId[] = [];
  for (const e of fresh) {
    if (items[e.item.itemId] === undefined) added.push(e.item.itemId);
    items[e.item.itemId] = e.item;
  }
  // 새 id가 없으면 itemIds 참조를 그대로 둔다(교체만 있는 batch가 목록 부품을 다시 그리지 않게)
  return { ...t, itemIds: added.length === 0 ? t.itemIds : [...t.itemIds, ...added], items };
}

function applyFact(state: EngineMirror, fact: DurableFact): EngineMirror {
  switch (fact.type) {
    case "thread.started": {
      if (state.threads.byId[fact.threadId] !== undefined) return state;
      const summary: ThreadSummary = {
        threadId: fact.threadId,
        title: fact.payload.title,
        status: "idle",
        workspace: fact.payload.workspace ?? null,
        createdAt: fact.at,
        updatedAt: fact.at,
        headSeq: fact.seq,
        forkedFrom: fact.payload.forkedFrom,
        resumable: null,
        queuedInputs: 0,
        pendingApprovals: 0,
      };
      return {
        ...state,
        threads: {
          ...state.threads,
          ids: [fact.threadId, ...state.threads.ids],
          byId: { ...state.threads.byId, [fact.threadId]: summary },
        },
      };
    }
    case "thread.updated":
      return patchThread(state, fact.threadId, (t) => ({
        ...t,
        title: fact.payload.title !== undefined ? fact.payload.title : t.title,
        status: fact.payload.status ?? t.status,
        updatedAt: fact.at,
      }));
    case "thread.closed":
      return patchThread(state, fact.threadId, (t) => ({ ...t, status: "closed" }));
    case "turn.started": {
      const running = patchThread(state, fact.threadId, (t) => ({ ...t, status: "running" }));
      // turn.started의 turnId는 호스트가 항상 준다(projector가 turnIdOf로 읽는다). 없으면 기록하지 않는다
      const latestTurnId =
        fact.turnId === null
          ? running.latestTurnId
          : { ...running.latestTurnId, [fact.threadId]: fact.turnId };
      const recentTurnIds =
        fact.turnId === null
          ? running.recentTurnIds
          : {
              ...running.recentTurnIds,
              [fact.threadId]: withRecentTurn(running.recentTurnIds[fact.threadId], fact.turnId),
            };
      return withTurnFailure({ ...running, latestTurnId, recentTurnIds }, fact.threadId, null);
    }
    case "turn.completed": {
      const done = patchThread(state, fact.threadId, (t) => ({ ...t, status: "idle" }));
      const failure =
        fact.payload.status === "failed" ? (fact.payload.error ?? unknownFailureText()) : null;
      return withTurnFailure(
        { ...done, streaming: dropStreamingTurn(done.streaming, fact.threadId, fact.turnId) },
        fact.threadId,
        failure,
      );
    }
    case "item.recorded":
      // transcript 반영은 applyBatch가 batch 단위로 한 번에 한다
      return { ...state, streaming: settleItem(state.streaming, fact.item.itemId) };
    case "approval.requested": {
      if (state.approvals.byId[fact.eventId] !== undefined) return state;
      const pending = {
        approvalId: fact.eventId,
        threadId: fact.threadId,
        seq: fact.seq,
        request: fact.request,
      };
      const next: EngineMirror = {
        ...state,
        approvals: {
          ...state.approvals,
          ids: [...state.approvals.ids, fact.eventId],
          byId: { ...state.approvals.byId, [fact.eventId]: pending },
        },
      };
      return bumpPending(next, fact.threadId, 1);
    }
    case "approval.resolved": {
      const resolved = capped(state.approvals.resolved, fact.approvalId);
      const found = state.approvals.byId[fact.approvalId];
      if (found === undefined) return { ...state, approvals: { ...state.approvals, resolved } };
      const { [fact.approvalId]: _gone, ...byId } = state.approvals.byId;
      const next: EngineMirror = {
        ...state,
        approvals: {
          resolved,
          ids: state.approvals.ids.filter((id) => id !== fact.approvalId),
          byId,
        },
      };
      return bumpPending(next, found.threadId, -1);
    }
    case "lease.acquired":
      return recordTransition(
        state,
        fact,
        { kind: "lease.acquired", leaseEpoch: fact.payload.leaseEpoch ?? null },
        fact.payload.scopeId,
      );
    case "lease.released":
      return recordTransition(
        state,
        fact,
        { kind: "lease.released", reason: fact.payload.reason },
        fact.payload.scopeId,
      );
    case "lease.rejected":
      return recordTransition(
        state,
        fact,
        { kind: "lease.rejected", reason: fact.payload.reason },
        fact.payload.groupId,
      );
    case "scope.changed":
      return recordTransition(
        state,
        fact,
        {
          kind: "scope.changed",
          status: fact.payload.status,
          reason: fact.payload.reason ?? "request",
        },
        fact.payload.scopeId,
      );
    case "review.applied":
      return withReviewResult(state, fact.payload.reviewId, fact.payload.round, (r) => ({
        ...r,
        outcomes: fact.payload.outcomes,
      }));
    case "review.submitted":
      return withReviewResult(state, fact.payload.reviewId, fact.payload.round, (r) => ({
        ...r,
        submitted: true,
        delivery: fact.payload.delivery,
      }));
    case "plan.event":
      return recordPlan(state, fact);
    case "input.queued":
      return recordQueued(state, fact);
    case "input.placed":
    case "input.withdrawn":
      return dropQueued(state, fact.inputId);
    case "other":
    case "unreadable":
      return state;
    default:
      return assertNever(fact, "applyFact");
  }
}

type TransitionFact = Extract<
  DurableFact,
  { readonly type: "lease.acquired" | "lease.released" | "lease.rejected" | "scope.changed" }
>;

function recordTransition(
  state: EngineMirror,
  fact: TransitionFact,
  change: TransitionRecord["change"],
  subject: string,
): EngineMirror {
  const record: TransitionRecord = {
    threadId: fact.threadId,
    seq: fact.seq,
    at: fact.at,
    turnId: fact.turnId,
    subject,
    change,
  };
  return { ...state, transitions: appendTransition(state.transitions, record) };
}

/** 같은 (thread, seq)는 한 번만 넣는다. thread마다 `TRANSITION_CAP`개만 두고, 넘으면 그 thread의 가장 오래된 것을 버린다 */
function appendTransition(
  list: readonly TransitionRecord[],
  record: TransitionRecord,
): readonly TransitionRecord[] {
  if (list.some((r) => r.threadId === record.threadId && r.seq === record.seq)) return list;
  const next = [...list, record];
  if (next.filter((r) => r.threadId === record.threadId).length <= TRANSITION_CAP) return next;
  const oldest = next.findIndex((r) => r.threadId === record.threadId);
  return next.filter((_, i) => i !== oldest);
}

/**
 * 계획 사건 하나를 거울에 넣는다. 계획마다 한 줄이고 가장 최근에 받은 것이 뒤에 온다.
 * 옛 판의 제출은 무시하고(판 번호가 줄어들면 안 된다), 철회는 기록된 판과 같은 판일 때만 바꾼다.
 * 철회 사건은 제목이 없으므로 기록의 제목을 그대로 둔다.
 */
function recordPlan(
  state: EngineMirror,
  fact: Extract<DurableFact, { readonly type: "plan.event" }>,
): EngineMirror {
  const { plan, threadId } = fact;
  const found = state.plans.find((r) => r.threadId === threadId && r.planId === plan.planId);
  let record: PlanRecord;
  if (plan.status === "submitted") {
    if (found !== undefined && found.version > plan.version) return state;
    record = {
      threadId,
      planId: plan.planId,
      version: plan.version,
      title: plan.title,
      status: "submitted",
    };
  } else {
    if (found === undefined || found.version !== plan.version) return state;
    record = { ...found, status: "withdrawn" };
  }
  const others = state.plans.filter((r) => r !== found);
  return { ...state, plans: capPlans([...others, record], threadId) };
}

/** thread마다 `PLAN_CAP`개만 두고, 넘으면 그 thread의 가장 오래된 계획을 버린다 */
function capPlans(list: readonly PlanRecord[], threadId: ThreadId): readonly PlanRecord[] {
  if (list.filter((r) => r.threadId === threadId).length <= PLAN_CAP) return list;
  const oldest = list.findIndex((r) => r.threadId === threadId);
  return list.filter((_, i) => i !== oldest);
}

/**
 * 큐에 든 입력 하나를 거울에 넣는다. 입력 id(이벤트 id)가 같으면 한 번만 넣는다. 가장 최근 입력이 뒤에 온다.
 * 상한을 넘으면 그 thread의 가장 오래된 입력을 버린다.
 */
function recordQueued(
  state: EngineMirror,
  fact: Extract<DurableFact, { readonly type: "input.queued" }>,
): EngineMirror {
  if (state.queuedInputs.some((r) => r.inputId === fact.eventId)) return state;
  if (state.settledInputs.includes(fact.eventId)) return state;
  const record: QueuedInput = {
    ...fact.input,
    inputId: fact.eventId,
    threadId: fact.threadId,
  };
  return {
    ...state,
    queuedInputs: capQueued([...state.queuedInputs, record], fact.threadId),
  };
}

/** 배치되거나 거둬진 입력을 뺀다. 거울이 모르는 입력이면 그대로 둔다(연결 전에 든 입력) */
function dropQueued(state: EngineMirror, inputId: EventId): EngineMirror {
  const settledInputs = state.settledInputs.includes(inputId)
    ? state.settledInputs
    : [...state.settledInputs, inputId].slice(-SETTLED_INPUT_CAP);
  const present = state.queuedInputs.some((r) => r.inputId === inputId);
  return {
    ...state,
    settledInputs,
    queuedInputs: present
      ? state.queuedInputs.filter((r) => r.inputId !== inputId)
      : state.queuedInputs,
  };
}

/** thread마다 `QUEUED_INPUT_CAP`개만 두고, 넘으면 그 thread의 가장 오래된 입력을 버린다 */
function capQueued(list: readonly QueuedInput[], threadId: ThreadId): readonly QueuedInput[] {
  if (list.filter((r) => r.threadId === threadId).length <= QUEUED_INPUT_CAP) return list;
  const oldest = list.findIndex((r) => r.threadId === threadId);
  return list.filter((_, i) => i !== oldest);
}

/**
 * 리뷰의 결과 한 줄을 고친다. 같은 라운드면 이어 채우고, 새 라운드면 옛 결과를 버리고 새로 만든다.
 * 옛 라운드의 이벤트는 무시한다. 리뷰마다 한 줄이고, 가장 최근에 바뀐 리뷰가 뒤에 온다.
 */
function withReviewResult(
  state: EngineMirror,
  reviewId: string,
  round: number,
  change: (current: ReviewResult) => ReviewResult,
): EngineMirror {
  const found = state.reviewResults.find((r) => r.reviewId === reviewId);
  if (found !== undefined && found.round > round) return state;
  const base: ReviewResult =
    found !== undefined && found.round === round
      ? found
      : { reviewId, round, outcomes: null, submitted: false, delivery: null };
  const reviewResults = [
    ...state.reviewResults.filter((r) => r.reviewId !== reviewId),
    change(base),
  ];
  return { ...state, reviewResults: reviewResults.slice(-REVIEW_RESULT_CAP) };
}

function applySnapshot(
  state: EngineMirror,
  input: Extract<MirrorInput, { type: "transcript" }>,
): Reduced<EngineMirror> {
  const t = state.transcript;
  if (t === null || t.status !== "loading" || t.threadId !== input.threadId)
    return keep(state, "foreign");
  if (input.asOfSeq < t.sinceSeq) return keep(state, "stale");
  const items: Record<string, ItemRecord> = {};
  const itemIds: ItemId[] = [];
  for (const item of input.items) {
    if (items[item.itemId] === undefined) itemIds.push(item.itemId);
    items[item.itemId] = item;
  }
  let ready: Transcript = {
    status: "ready",
    threadId: t.threadId,
    asOfSeq: input.asOfSeq,
    itemIds,
    items,
  };
  ready = recordItems(ready, t.held);
  let streaming = state.streaming;
  for (const id of itemIds) streaming = settleItem(streaming, id);
  return keep({ ...state, transcript: ready, streaming }, "applied");
}
