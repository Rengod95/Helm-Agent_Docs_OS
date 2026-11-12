import { assertNever } from "@fresnel/contracts";
import type { ItemId, TurnId } from "@fresnel/contracts/conversation";
import type { AnchoredCompaction } from "../state/engine/compaction-anchor.ts";
import type { ConvoMarker } from "../state/engine/convo.ts";
import type { ItemShape, ShapeBlock } from "../state/engine/index.ts";
import type { CompactionRecord } from "../state/engine/state.ts";
import type { VirtualRow } from "./virtual-list.tsx";

// 대화 목록의 줄 순서(L4 desktop-ux §6.6, §16.2). 확정 item의 모양(`ItemShape`)을 대화용 줄로 나누고 묶는다.
// - 사용자 말 한 줄, 답의 글·생각 한 줄(reply), 이어지는 도구 호출 묶음 한 줄(activity), 결과물 도구(하위 에이전트·계획·할 일) 한 줄(card).
// - 턴 경계는 `turn.started`의 입력 item(`inputItemIds`)이나 사용자 말이다. 끝난 턴 뒤에 턴 발 줄(turnFoot)을 둔다.
// - 변화 표지(marker)는 seq로 그 뒤 첫 턴 앞에, 요약 구분선은 자리 item 뒤에, 주도 구간 머리·끝은 구간의 첫 턴 앞·마지막 턴 뒤에 선다.
// 키는 스트리밍 → 확정에서 바뀌지 않는다: 진행 중 글 줄과 그 item의 첫 글 줄은 모두 item id다. 묶음 키는 첫 호출 id라 묶음이 커져도 같다.

/** 묶음 안 항목 하나. 도구 호출이거나 호출 사이의 생각이다 */
export type ActivityEntry = {
  readonly itemId: ItemId;
  readonly block: Extract<ShapeBlock, { readonly kind: "call" | "thinking" }>;
};

export type CallBlock = Extract<ShapeBlock, { readonly kind: "call" }>;

/** 주도 구간 머리·끝이 읽는 값(`LeadSegment`에서 줄 모델이 쓰는 것만) */
export type LeadRef = { readonly leaseId: string; readonly turnIds: readonly TurnId[] };

type Lead = { readonly lead: string | null };

/** 목록의 한 줄. 모든 줄은 속한 주도 구간(`lead`, lease id)을 든다. 레일이 그 값으로 이어진다 */
export type TranscriptRow = VirtualRow &
  Lead &
  (
    | {
        readonly kind: "user";
        readonly id: ItemId;
        /** 바로 앞 확정 item(고쳐 보낼 때 여기까지 되감는다). 맨 앞이면 null */
        readonly prevId: ItemId | null;
      }
    | { readonly kind: "reply"; readonly id: ItemId; readonly blocks: readonly ShapeBlock[] }
    | { readonly kind: "activity"; readonly entries: readonly ActivityEntry[] }
    | { readonly kind: "card"; readonly itemId: ItemId; readonly call: CallBlock }
    | { readonly kind: "result"; readonly id: ItemId }
    | { readonly kind: "custom"; readonly id: ItemId }
    | { readonly kind: "live"; readonly id: ItemId }
    | { readonly kind: "compaction"; readonly record: CompactionRecord }
    | { readonly kind: "marker"; readonly marker: ConvoMarker }
    | { readonly kind: "leadHead"; readonly leaseId: string }
    | { readonly kind: "leadEnd"; readonly leaseId: string }
    | {
        readonly kind: "turnFoot";
        /** 턴을 모르면(시작 사건을 못 본 기록) null이다. 그때도 답 동작 줄은 보인다 */
        readonly turnId: TurnId | null;
        /** 이 턴의 마지막 답 item. 답 동작(복사·다시 만들기·갈라내기·되감기)의 대상이다 */
        readonly replyId: ItemId | null;
      }
  );

/** 줄 모델이 읽는 턴 값(`TurnSummary`의 일부) */
export type TurnRef = {
  readonly turnId: TurnId;
  readonly startedSeq: number | null;
  readonly inputItemIds: readonly ItemId[];
  readonly running: boolean;
};

/** 결과물이라 묶지 않고 카드로 늘 보이는 도구 */
const CARD_TOOLS: ReadonlySet<string> = new Set(["agent", "task_write", "submit_plan"]);
/** 묶지 않고 한 줄로 드러내는 도구(파일 변경은 diff가 보여야 한다) */
const SOLO_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

type Exchange = {
  readonly turn: TurnRef | null;
  readonly shapes: ItemShape[];
};

/** 확정 item을 턴(또는 사용자 말) 단위로 가른다. 입력 item이나 사용자 말이 새 교환을 연다 */
function exchangesOf(
  shapes: readonly ItemShape[],
  turnByInput: ReadonlyMap<ItemId, TurnRef>,
): Exchange[] {
  const out: Exchange[] = [];
  let current: Exchange | null = null;
  for (const shape of shapes) {
    const turn = turnByInput.get(shape.id) ?? null;
    const opens =
      current === null ||
      (turn !== null && turn !== current.turn) ||
      (turn === null && shape.kind === "user");
    if (opens) {
      current = { turn, shapes: [] };
      out.push(current);
    }
    current?.shapes.push(shape);
  }
  return out;
}

/** 교환 하나의 줄. 도구 호출을 묶고, 호출 사이 생각은 묶음에, 글 앞 생각은 답 줄에 넣는다 */
function bodyRowsOf(
  exchange: Exchange,
  lead: string | null,
  prevOf: ReadonlyMap<ItemId, ItemId>,
): { readonly rows: TranscriptRow[]; readonly lastReply: ItemId | null } {
  const rows: TranscriptRow[] = [];
  let lastReply: ItemId | null = null;
  let pending: ActivityEntry[] = [];
  let held: ActivityEntry[] = [];
  const replyKeys = new Set<ItemId>();
  const replyKey = (id: ItemId, index: number): string => {
    if (replyKeys.has(id)) return `${id}:${index}`;
    replyKeys.add(id);
    return id;
  };
  const flushActivity = (): void => {
    const first = pending.find((entry) => entry.block.kind === "call");
    if (first !== undefined && first.block.kind === "call") {
      rows.push({ kind: "activity", key: `act:${first.block.callId}`, lead, entries: pending });
    }
    pending = [];
  };
  /** 붙잡아 둔 생각을 답 줄로 내보낸다(뒤에 호출이 오지 않았다) */
  const flushHeld = (): void => {
    for (const entry of held) {
      rows.push({
        kind: "reply",
        key: replyKey(entry.itemId, entry.block.index),
        lead,
        id: entry.itemId,
        blocks: [entry.block],
      });
    }
    held = [];
  };
  for (const shape of exchange.shapes) {
    switch (shape.kind) {
      case "hidden":
        break;
      case "user":
        flushActivity();
        flushHeld();
        rows.push({
          kind: "user",
          key: shape.id,
          lead,
          id: shape.id,
          prevId: prevOf.get(shape.id) ?? null,
        });
        break;
      case "result":
      case "custom":
        flushActivity();
        flushHeld();
        rows.push({ kind: shape.kind, key: shape.id, lead, id: shape.id });
        break;
      case "assistant": {
        let text: ShapeBlock[] = [];
        const flushText = (): void => {
          if (text.length === 0) return;
          const firstText = text[0];
          rows.push({
            kind: "reply",
            key: replyKey(shape.id, firstText?.index ?? 0),
            lead,
            id: shape.id,
            blocks: text,
          });
          lastReply = shape.id;
          text = [];
        };
        for (const block of shape.blocks) {
          if (block.kind === "thinking") {
            if (text.length > 0) text.push(block);
            else held.push({ itemId: shape.id, block });
            continue;
          }
          if (block.kind === "text") {
            flushActivity();
            // 글 앞 생각은 같은 item이면 이 답 줄의 머리로 들어가고, 앞 item의 것이면 따로 한 줄이다
            const mine = held.filter((entry) => entry.itemId === shape.id).map((e) => e.block);
            held = held.filter((entry) => entry.itemId !== shape.id);
            flushHeld();
            if (text.length === 0) text.push(...mine);
            text.push(block);
            continue;
          }
          flushText();
          if (CARD_TOOLS.has(block.name)) {
            flushActivity();
            flushHeld();
            rows.push({
              kind: "card",
              key: `card:${block.callId}`,
              lead,
              itemId: shape.id,
              call: block,
            });
            continue;
          }
          if (SOLO_TOOLS.has(block.name)) {
            flushActivity();
            pending = [...held, { itemId: shape.id, block }];
            held = [];
            flushActivity();
            continue;
          }
          pending.push(...held, { itemId: shape.id, block });
          held = [];
        }
        flushText();
        break;
      }
      default:
        return assertNever(shape, "ItemShape");
    }
  }
  flushActivity();
  flushHeld();
  return { rows, lastReply };
}

/** 표지를 놓을 교환 번호. seq가 그 교환의 턴 시작보다 앞이면 그 교환 앞이다. 어디에도 없으면 끝(교환 수) */
function markerSlotOf(marker: ConvoMarker, exchanges: readonly Exchange[]): number {
  if (marker.change.kind === "scheduled_start") {
    const turnId = marker.change.turnId;
    const at = exchanges.findIndex((e) => e.turn?.turnId === turnId);
    if (at >= 0) return at;
  }
  const at = exchanges.findIndex(
    (e) => e.turn !== null && e.turn.startedSeq !== null && e.turn.startedSeq > marker.seq,
  );
  return at >= 0 ? at : exchanges.length;
}

export function transcriptRowsOf(input: {
  readonly shapes: readonly ItemShape[];
  readonly live: readonly ItemId[];
  /** 진행 중 item을 보일지. 열린 대화가 읽힌 뒤에만 참이다 */
  readonly showLive: boolean;
  readonly anchors: readonly AnchoredCompaction[];
  readonly turns: readonly TurnRef[];
  readonly markers: readonly ConvoMarker[];
  readonly leads: readonly LeadRef[];
  /** 열린 대화가 도는 중이다. 마지막 교환에는 턴 발 줄을 두지 않는다 */
  readonly running: boolean;
}): readonly TranscriptRow[] {
  const turnByInput = new Map<ItemId, TurnRef>();
  for (const turn of input.turns) {
    for (const id of turn.inputItemIds) turnByInput.set(id, turn);
  }
  const leadOfTurn = new Map<TurnId, LeadRef>();
  for (const lead of input.leads) for (const id of lead.turnIds) leadOfTurn.set(id, lead);
  const exchanges = exchangesOf(input.shapes, turnByInput);
  const prevOf = new Map<ItemId, ItemId>();
  input.shapes.forEach((shape, index) => {
    const prev = input.shapes[index - 1];
    if (prev !== undefined) prevOf.set(shape.id, prev.id);
  });

  const markersAt = new Map<number, ConvoMarker[]>();
  for (const marker of input.markers) {
    const slot = markerSlotOf(marker, exchanges);
    markersAt.set(slot, [...(markersAt.get(slot) ?? []), marker]);
  }
  const markerRows = (slot: number): TranscriptRow[] =>
    (markersAt.get(slot) ?? []).map((marker) => ({
      kind: "marker",
      key: `mark:${marker.seq}`,
      lead: null,
      marker,
    }));

  const head: TranscriptRow[] = [];
  const after = new Map<ItemId, TranscriptRow[]>();
  for (const anchor of input.anchors) {
    const row: TranscriptRow = {
      kind: "compaction",
      key: `compact:${anchor.record.eventId}`,
      lead: null,
      record: anchor.record,
    };
    if (anchor.after === null) head.push(row);
    else after.set(anchor.after, [...(after.get(anchor.after) ?? []), row]);
  }

  const rows: TranscriptRow[] = [...head];
  const openedLeads = new Set<string>();
  exchanges.forEach((exchange, index) => {
    rows.push(...markerRows(index));
    const lead = exchange.turn === null ? undefined : leadOfTurn.get(exchange.turn.turnId);
    const leaseId = lead?.leaseId ?? null;
    if (lead !== undefined && !openedLeads.has(lead.leaseId)) {
      openedLeads.add(lead.leaseId);
      rows.push({
        kind: "leadHead",
        key: `lead:${lead.leaseId}`,
        lead: lead.leaseId,
        leaseId: lead.leaseId,
      });
    }
    const body = bodyRowsOf(exchange, leaseId, prevOf);
    for (const row of body.rows) {
      rows.push(row);
      const id = "id" in row ? row.id : row.kind === "card" ? row.itemId : null;
      // 요약 구분선은 자리 item 뒤에 선다. 묶음 안 item 자리는 묶음 뒤다
      if (id !== null) rows.push(...(after.get(id) ?? []));
      if (row.kind === "activity") {
        for (const entry of row.entries) rows.push(...(after.get(entry.itemId) ?? []));
      }
    }
    const last = index === exchanges.length - 1;
    const turnRunning = exchange.turn?.running === true || (last && input.running);
    if (!turnRunning && (body.lastReply !== null || exchange.turn !== null)) {
      const turnId = exchange.turn?.turnId ?? null;
      rows.push({
        kind: "turnFoot",
        key: `foot:${turnId ?? exchange.shapes[0]?.id ?? index}`,
        lead: leaseId,
        turnId,
        replyId: body.lastReply,
      });
    }
    // 구간의 마지막 턴이 끝났으면 끝 줄을 둔다(보유 중인지는 화면이 구간 값으로 다시 본다)
    const turnId = exchange.turn?.turnId;
    if (lead !== undefined && turnId !== undefined && lead.turnIds.at(-1) === turnId) {
      rows.push({
        kind: "leadEnd",
        key: `lead-end:${lead.leaseId}`,
        lead: null,
        leaseId: lead.leaseId,
      });
    }
  });
  rows.push(...markerRows(exchanges.length));
  if (input.showLive) {
    const recorded = new Set(input.shapes.map((shape) => shape.id));
    for (const id of input.live) {
      if (!recorded.has(id)) rows.push({ kind: "live", key: id, lead: null, id });
    }
  }
  return rows;
}
