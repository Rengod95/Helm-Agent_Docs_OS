import { err, ok, parse, type Result } from "@xeon/contracts";
import { ItemRecordedPayloadSchema, EffectResultSchema } from "@xeon/contracts/records";
import type { ItemId } from "@xeon/contracts/conversation";
import type {
  EventsBatchParams,
  StoreId,
  StreamChunkParams,
  StreamPosition,
} from "@xeon/contracts/wire";
import type { RenderOp } from "./ops.ts";
import { progressOf } from "./stream.ts";
import { opsOfEvent, restoreRedactions } from "./transcript.ts";

// L4.cli.spec §3.5. 트랜스크립트 상태와 순수 적용 함수. 라이브러리와 무관하다: 화면은 RenderSink 뒤에 둔다(§4.9.2).

export type { RenderOp } from "./ops.ts";

export interface TranscriptState {
  /** 마지막으로 반영한 (storeId, to) */
  readonly position: StreamPosition | null;
  /** 진행 줄이 있는 item */
  readonly openItems: ReadonlySet<string>;
  readonly pendingApprovals: ReadonlySet<string>;
  /** afterSeq가 position보다 앞선 조각 */
  readonly deferredChunks: readonly StreamChunkParams[];
  /** 진행 줄 텍스트. 키 집합이 openItems와 같다 [spec에 더한 필드] */
  readonly progress: ReadonlyMap<string, string>;
  /** 내구 기록이 이미 온 item. 그 item의 늦은 조각을 버린다 [spec에 더한 필드] */
  readonly recordedItems: ReadonlySet<string>;
  /** 복구 규칙이 만든 결과의 effectId [spec에 더한 필드] */
  readonly synthesizedEffects: ReadonlySet<string>;
  /** turn별로 마지막에 본 조각 번호. 같거나 작은 n은 중복·과거라 버린다 [spec에 더한 필드] */
  readonly lastChunkN: ReadonlyMap<string, number>;
}

export interface RenderOptions {
  /** 터미널 폭. 도구 결과 렌더러에 넘긴다. 기본 80 */
  readonly width?: number;
}

const DEFAULT_RENDER_WIDTH = 80;

export function initialTranscript(position: StreamPosition | null): TranscriptState {
  return {
    position,
    openItems: new Set(),
    pendingApprovals: new Set(),
    deferredChunks: [],
    progress: new Map(),
    recordedItems: new Set(),
    synthesizedEffects: new Set(),
    lastChunkN: new Map(),
  };
}

export type BatchGap = {
  readonly kind: "gap";
  readonly expectedFrom: number;
  readonly got: number;
};

function recordedItemId(payload: unknown): ItemId | undefined {
  const parsed = parse(ItemRecordedPayloadSchema, payload);
  return parsed.ok ? parsed.value.item.itemId : undefined;
}

function synthesizedEffectId(payload: unknown): string | undefined {
  const parsed = parse(EffectResultSchema, payload);
  return parsed.ok && parsed.value.synthesized ? parsed.value.effectId : undefined;
}

/**
 * 순수 함수. 구간 규칙(F wire §3.4.2)을 검사하고 내구 이벤트를 RenderOp로 바꾼다.
 *   - from이 위치보다 크면 구멍이다: gap을 돌려준다. CLI는 마지막 to부터 다시 구독한다.
 *   - from이 위치보다 작으면(다시 받은 구간) seq가 위치 이하인 이벤트를 무시한다. 같은 seq를 두 번 그리지 않는다.
 *   - 위치가 아직 없으면(null) 첫 알림의 from이 기준이다.
 */
export function applyBatch(
  state: TranscriptState,
  batch: EventsBatchParams,
  storeId: StoreId,
  options: RenderOptions = {},
): Result<{ readonly state: TranscriptState; readonly ops: readonly RenderOp[] }, BatchGap> {
  const width = options.width ?? DEFAULT_RENDER_WIDTH;
  const baseline = state.position?.seq ?? batch.from;
  if (batch.from > baseline) return err({ kind: "gap", expectedFrom: baseline, got: batch.from });

  const fresh = batch.events.filter((event) => event.seq > baseline);
  const synthesized = new Set(state.synthesizedEffects);
  for (const event of fresh) {
    if (event.kind !== "effect.result") continue;
    const effectId = synthesizedEffectId(restoreRedactions(event.payload, event.redactions));
    if (effectId !== undefined) synthesized.add(effectId);
  }

  const progress = new Map(state.progress);
  const recorded = new Set(state.recordedItems);
  const approvals = new Set(state.pendingApprovals);
  const ops: RenderOp[] = [];
  for (const event of fresh) {
    if (event.kind === "item.recorded") {
      const itemId = recordedItemId(restoreRedactions(event.payload, event.redactions));
      if (itemId !== undefined) {
        recorded.add(itemId);
        if (progress.delete(itemId)) {
          ops.push({ kind: "clearProgress", itemId });
        }
      }
    }
    const eventOps = opsOfEvent(event, { synthesized, width });
    for (const op of eventOps) {
      if (op.kind === "approval") approvals.add(op.view.approvalId);
      if (op.kind === "approvalResolved") approvals.delete(op.approvalId);
    }
    ops.push(...eventOps);
  }

  const position: StreamPosition = {
    storeId: state.position?.storeId ?? storeId,
    seq: Math.max(baseline, batch.to),
  };
  const advanced: TranscriptState = {
    ...state,
    position,
    openItems: new Set(progress.keys()),
    pendingApprovals: approvals,
    deferredChunks: [],
    progress,
    recordedItems: recorded,
    synthesizedEffects: synthesized,
  };
  // 위치가 앞서 나가면서 적용할 수 있게 된 조각을 도착 순서대로 푼다(아직 앞선 조각은 applyChunk가 다시 미룬다)
  let current = advanced;
  for (const chunk of state.deferredChunks) {
    const applied = applyChunk(current, chunk);
    current = applied.state;
    ops.push(...applied.ops);
  }
  return ok({ state: current, ops });
}

/**
 * 순수 함수. 휘발 조각을 진행 줄로 바꾼다. 내구 기록이 이미 온 item의 조각과 같거나 지난 번호의 조각은 버린다.
 * afterSeq가 현재 위치보다 앞선 조각은 deferredChunks에 두고 그 seq까지 반영된 뒤 적용한다(F wire §3.4.4 마지막 항목).
 */
export function applyChunk(
  state: TranscriptState,
  chunk: StreamChunkParams,
): { readonly state: TranscriptState; readonly ops: readonly RenderOp[] } {
  const { event } = chunk;
  if (state.position === null || event.afterSeq > state.position.seq) {
    return {
      state: { ...state, deferredChunks: [...state.deferredChunks, chunk] },
      ops: [],
    };
  }
  const turnKey = event.turnId ?? event.threadId;
  const lastN = state.lastChunkN.get(turnKey);
  if (lastN !== undefined && event.n <= lastN) return { state, ops: [] };
  const seen = new Map(state.lastChunkN);
  seen.set(turnKey, event.n);
  const update = progressOf(chunk, state.progress);
  if (update === undefined || state.recordedItems.has(update.itemId)) {
    return { state: { ...state, lastChunkN: seen }, ops: [] };
  }
  const progress = new Map(state.progress);
  progress.set(update.itemId, update.text);
  return {
    state: {
      ...state,
      lastChunkN: seen,
      progress,
      openItems: new Set(progress.keys()),
    },
    ops: [{ kind: "progress", itemId: update.itemId, text: update.text }],
  };
}
