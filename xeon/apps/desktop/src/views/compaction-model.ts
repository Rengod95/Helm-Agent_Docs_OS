import type { MessageId } from "@fresnel/client/i18n";
import type { CompactionRecord } from "../state/engine/state.ts";
import { tokenCountText } from "./model-usage.ts";

// 대화 요약 구분선의 문구 값(L4 desktop-ux §6.6). 자동 요약(임계, 넘침)과 직접 누른 요약은 같은 모양이고 이유 글만 다르다.

type CompactionReasonKey = "desktop.compaction.reason.auto" | "desktop.compaction.reason.manual";

/** 이유 글의 자리. 임계와 넘침은 사용자가 누르지 않은 자동 요약이라 "자동"이고, 직접 누르면 "수동"이다. 옛 기록은 이유가 없어 null이다 */
function compactionReasonKeyOf(reason: CompactionRecord["reason"]): CompactionReasonKey | null {
  if (reason === null) return null;
  return reason === "manual"
    ? "desktop.compaction.reason.manual"
    : "desktop.compaction.reason.auto";
}

/** "요약 뒤 약 n 토큰"의 n 글. 요약 뒤 크기를 모르면(옛 기록) null이라 줄을 그리지 않는다 */
function tokensAfterText(record: CompactionRecord): string | null {
  return record.tokensAfter === null ? null : tokenCountText(record.tokensAfter);
}

/** 구분선의 글 값 묶음. 그리는 부품이 이것만 본다 */
export interface CompactionView {
  readonly reason: MessageId | null;
  readonly tokensAfter: string | null;
}

export function compactionViewOf(record: CompactionRecord): CompactionView {
  return { reason: compactionReasonKeyOf(record.reason), tokensAfter: tokensAfterText(record) };
}
