// src/state/engine/compaction-anchor.ts
import type { ItemId } from "@fresnel/contracts/conversation";
import type { CompactionRecord } from "./state.ts";

// 대화 요약 구분선이 서는 자리(L4 desktop-ux §6.6). `thread.read`는 item만 싣고 요약 사건의 목록 위치를 싣지 않으므로,
// 사건 시각(`at`)과 item의 메시지 시각으로 자리를 고른다: 요약 시각 이전의 마지막 item 뒤다. 그런 item이 없으면 목록 맨 위다(`after: null`).
// 자리는 근사다. 요약은 단계 사이에 커밋되므로 그 앞 item의 시각이 요약 시각보다 앞선다.

export interface AnchoredCompaction {
  readonly record: CompactionRecord;
  /** 이 구분선이 바로 뒤에 서는 item. null이면 목록 맨 위 */
  readonly after: ItemId | null;
}

/**
 * 요약 사건마다 자리를 붙인다. 시각 순서로 돌려준다. `stampOf`가 시각을 모르는 item은 자리 후보에서 뺀다.
 * 사건 시각을 읽지 못하면(ISO가 아니면) 그 사건은 자리를 잡지 못해 빠진다.
 */
export function anchorCompactions(
  ids: readonly ItemId[],
  stampOf: (id: ItemId) => number | undefined,
  records: readonly CompactionRecord[],
): readonly AnchoredCompaction[] {
  const stamps = ids.map((id) => stampOf(id));
  return records
    .flatMap((record) => {
      const at = Date.parse(record.at);
      return Number.isFinite(at) ? [{ record, at }] : [];
    })
    .toSorted((a, b) => a.at - b.at)
    .map(({ record, at }): AnchoredCompaction => {
      let after: ItemId | null = null;
      for (let index = 0; index < ids.length; index += 1) {
        const stamp = stamps[index];
        const id = ids[index];
        if (id !== undefined && stamp !== undefined && stamp <= at) after = id;
      }
      return { record, after };
    });
}
