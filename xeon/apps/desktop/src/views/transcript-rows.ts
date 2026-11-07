import type { ItemId } from "@fresnel/contracts/conversation";
import type { AnchoredCompaction } from "../state/engine/compaction-anchor.ts";
import type { CompactionRecord } from "../state/engine/state.ts";
import type { VirtualRow } from "./virtual-list.tsx";

// 트랜스크립트 목록의 줄 순서(L4 desktop-ux §6.6). 확정 item 줄, 작성 중 줄, 대화 요약 구분선을 한 목록으로 엮는다.
// 구분선은 자리 item 바로 뒤에 서고, 자리가 없으면 목록 맨 위다. 작성 중 줄은 확정 줄 뒤에 온다.

/** 목록의 한 줄. item 줄(확정 또는 작성 중)이거나 요약 구분선이다 */
export type TranscriptRow =
  | (VirtualRow & { readonly kind: "item"; readonly id: ItemId; readonly live: boolean })
  | (VirtualRow & { readonly kind: "compaction"; readonly record: CompactionRecord });

/** 요약 구분선 한 줄. 키는 사건 id라 목록 안에서 하나다 */
function compactionRow(record: CompactionRecord): TranscriptRow {
  return { kind: "compaction", key: `compact:${record.eventId}`, record };
}

export function transcriptRowsOf(input: {
  readonly ids: readonly ItemId[];
  readonly live: readonly ItemId[];
  /** 진행 중 item을 보일지. 열린 대화가 읽힌 뒤에만 참이다 */
  readonly showLive: boolean;
  readonly anchors: readonly AnchoredCompaction[];
}): readonly TranscriptRow[] {
  const head = input.anchors
    .filter((anchor) => anchor.after === null)
    .map((anchor) => compactionRow(anchor.record));
  const after = new Map<ItemId, TranscriptRow[]>();
  for (const anchor of input.anchors) {
    if (anchor.after === null) continue;
    after.set(anchor.after, [...(after.get(anchor.after) ?? []), compactionRow(anchor.record)]);
  }
  return [
    ...head,
    ...input.ids.flatMap((id): readonly TranscriptRow[] => [
      { kind: "item", key: id, id, live: false },
      ...(after.get(id) ?? []),
    ]),
    ...(input.showLive
      ? input.live.map((id): TranscriptRow => ({ kind: "item", key: `live:${id}`, id, live: true }))
      : []),
  ];
}
