// src/state/engine/reduce.ts (발췌. 7절 표의 나머지 분기도 같은 모양이다)
import { assertNever, Bug } from "@xeon/contracts";
import type { ItemId, ItemRecord, PartDelta, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { ThreadSummary } from "@xeon/contracts/wire";
import type { Reduced as SharedReduced } from "../shared/pipeline.ts";
import type { DurableFact, MirrorInput, VolatileFact } from "./input.ts";
import { unknownFailureText } from "./failure-text.ts";
import {
  EMPTY_STREAMING,
  INITIAL_MIRROR,
  type EngineMirror,
  type Link,
  type ResetReason,
  type PendingApproval,
  type ResyncReason,
  type Streaming,
  type StreamingItem,
  type StreamingPart,
  type Transcript,
  SETTLED_CAP,
} from "./state.ts";

/** 이 입력이 거울에 한 일. journal이 기록한다 */
export type ApplyNote = "applied" | "duplicate" | "stale" | "foreign" | "gap" | "reset" | "failed";
type Reduced<S> = SharedReduced<S, ApplyNote>;

/** 같은 원인으로 이 횟수를 넘겨 다시 맞추면 failed로 둔다 */
export const MAX_SYNC_ATTEMPTS = 3;

const keep = (state: EngineMirror, note: ApplyNote): Reduced<EngineMirror> => ({ state, note });
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
      for (const t of input.threads) byId[t.threadId] = t;
      return keep(
        { ...state, threads: { status: "ready", ids: input.threads.map((t) => t.threadId), byId } },
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
    case "other":
      return keep({ ...state, streaming: counted }, "applied");
    default:
      return assertNever(fact, "applyChunk");
  }
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
  const part: StreamingPart = {
    partId: delta.partId,
    contentIndex: delta.contentIndex,
    kind: delta.kind,
    text: delta.phase === "delta" ? (before?.text ?? "") + delta.delta : (before?.text ?? ""),
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
    case "turn.started":
      return withTurnFailure(
        patchThread(state, fact.threadId, (t) => ({ ...t, status: "running" })),
        fact.threadId,
        null,
      );
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
    case "other":
    case "unreadable":
      return state;
    default:
      return assertNever(fact, "applyFact");
  }
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
