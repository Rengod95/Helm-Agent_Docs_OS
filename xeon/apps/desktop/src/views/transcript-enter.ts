import { assertNever } from "@fresnel/contracts";
import type { ItemId } from "@fresnel/contracts/conversation";
import type { RowEnter } from "../lib/motion-presets.tsx";
import type { TranscriptRow } from "./transcript-rows.ts";

// 대화 줄 들어옴을 언제 돌릴지(dzM2 시안 §2, L4 desktop-ux DP-117). 순수 함수라 화면 밖에서 시험한다(transcript.tsx가 쓴다).
// - 대화를 열어 처음 그린 줄(과거 대화)은 모두 알려진 줄이라 돌지 않는다. 목록 전체가 화면 전환 한 번으로 들어온다.
// - 그 뒤 커밋에서 알려진 집합에 없는 키가 새 줄이다. 가상 목록이 화면 밖 줄을 다시 마운트해도 키가 알려져 있어 돌지 않는다.
// - 진행 중 item이 확정되며 생긴 줄 가운데 이미 보이던 내용(같은 item의 뒤 글 조각)은 자리만 옮긴 것이라 돌지 않는다.

/** 줄 종류별 들어옴 갈래(시안 §2 표) */
export function rowEnterOf(kind: TranscriptRow["kind"]): RowEnter {
  switch (kind) {
    case "user":
      return "user";
    case "reply":
    case "live":
    case "pending":
      return "reply";
    case "activity":
    case "result":
      return "quiet";
    case "card":
    case "custom":
      return "card";
    case "turnFoot":
    case "leadEnd":
      return "foot";
    case "marker":
      return "divider";
    case "compaction":
      return "compaction";
    case "leadHead":
      return "leadHead";
    default:
      return assertNever(kind, "TranscriptRow.kind");
  }
}

/** 줄이 그리는 item id(묶음은 그 안 item 모두) */
export function rowItemIdsOf(row: TranscriptRow): readonly ItemId[] {
  switch (row.kind) {
    case "user":
    case "reply":
    case "live":
    case "result":
    case "custom":
      return [row.id];
    case "card":
      return [row.itemId];
    case "activity":
      return row.entries.map((entry) => entry.itemId);
    case "pending":
    case "compaction":
    case "marker":
    case "leadHead":
    case "leadEnd":
    case "turnFoot":
      return [];
    default:
      return assertNever(row, "TranscriptRow");
  }
}

/**
 * 이번 커밋에서 들어옴을 돌릴 줄 키.
 * `known`이 null이면 이 대화를 처음 그리는 커밋이라 아무것도 돌지 않는다.
 * `settled`는 직전 커밋에 진행 중이었다가 이번에 확정된 item이다. 그 item의 답 줄(뒤 글 조각)은 진행 중 줄에 이미 보이던 글이라 돌지 않는다.
 * 도구 줄·카드는 진행 중 줄에서 "도구 호출을 쓰는 중"으로 보이던 것이 실제 줄이 된 것이라 역시 돌지 않는다
 */
export function enteringKeysOf(input: {
  readonly rows: readonly TranscriptRow[];
  readonly known: ReadonlySet<string> | null;
  readonly settled: ReadonlySet<ItemId>;
}): ReadonlySet<string> {
  const out = new Set<string>();
  if (input.known === null) return out;
  for (const row of input.rows) {
    if (input.known.has(row.key)) continue;
    const moved = row.kind !== "user" && rowItemIdsOf(row).some((id) => input.settled.has(id));
    if (!moved) out.add(row.key);
  }
  return out;
}

/** 직전 진행 중 id 가운데 이번에 빠진 것(확정됐거나 끝났다) */
export function settledOf(before: readonly ItemId[], now: readonly ItemId[]): ReadonlySet<ItemId> {
  const still = new Set(now);
  return new Set(before.filter((id) => !still.has(id)));
}

/** "안 본 줄"로 세는 줄: 메시지(사용자 말, 답, 진행 중 글, 카드). 도구 줄·표지·발 줄은 세지 않는다 */
export function countsAsMessage(row: TranscriptRow): boolean {
  return (
    row.kind === "user" ||
    row.kind === "reply" ||
    row.kind === "live" ||
    row.kind === "card" ||
    row.kind === "custom"
  );
}

/** 되감기처럼 사용자 말 줄이 사라졌는지(목록 전체를 화면 전환으로 다시 들인다) */
export function lostUserRow(
  before: readonly TranscriptRow[],
  now: readonly TranscriptRow[],
): boolean {
  const keys = new Set(now.map((row) => row.key));
  return before.some((row) => row.kind === "user" && !keys.has(row.key));
}
