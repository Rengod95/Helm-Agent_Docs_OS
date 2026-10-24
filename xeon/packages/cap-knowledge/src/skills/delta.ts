import { compareBytes } from "../hash.ts";

// L2.knowledge.spec §4.2.6 인덱스 변경 알림. 순수 함수다. 모델이 보는 이름과 (잘린) 설명만 비교하므로 본문만 바뀐 변경은
// 델타에 나타나지 않는다.

/** 어느 시점에 모델이 볼 수 있는 인덱스. 이름 → 잘린 설명 */
export interface IndexSnapshot {
  /** 원장의 인덱스 버전(`indexVersion`). 같으면 인덱스가 같다 */
  readonly version: number;
  readonly descriptions: ReadonlyMap<string, string>;
}

export interface IndexDelta {
  readonly added: readonly { readonly name: string; readonly description: string }[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

export function diffIndex(before: IndexSnapshot, after: IndexSnapshot): IndexDelta {
  const added: { name: string; description: string }[] = [];
  const changed: string[] = [];
  for (const [name, description] of after.descriptions) {
    const previous = before.descriptions.get(name);
    if (previous === undefined) added.push({ name, description });
    else if (previous !== description) changed.push(name);
  }
  const removed = Array.from(before.descriptions.keys()).filter(
    (name) => !after.descriptions.has(name),
  );
  return {
    added: added.toSorted((a, b) => compareBytes(a.name, b.name)),
    changed: changed.toSorted(compareBytes),
    removed: removed.toSorted(compareBytes),
  };
}

export function isEmptyDelta(delta: IndexDelta): boolean {
  return delta.added.length === 0 && delta.changed.length === 0 && delta.removed.length === 0;
}

/** 메모 한 줄에 이름을 싣는 개수 상한. 넘으면 "외 N개"로 줄인다 */
const MAX_NAMES = 10;
/** 추가한 스킬 옆에 붙이는 설명 길이(코드 포인트) */
const NOTE_CHARS = 60;

function shortNote(description: string): string {
  const points = Array.from(description);
  return points.length <= NOTE_CHARS ? description : `${points.slice(0, NOTE_CHARS - 1).join("")}…`;
}

function listed(names: readonly string[]): string {
  const head = names.slice(0, MAX_NAMES).join(", ");
  return names.length > MAX_NAMES ? `${head} 외 ${String(names.length - MAX_NAMES)}개` : head;
}

/**
 * 델타 메모 한 줄. 델타가 비어 있으면 빈 문자열이다.
 * 예: `스킬 인덱스 변경: 추가 deploy-rollback(롤백 절차 …), 변경 release-checklist, 삭제 old-notes`
 */
export function formatIndexDelta(delta: IndexDelta): string {
  if (isEmptyDelta(delta)) return "";
  const parts: string[] = [];
  if (delta.added.length > 0) {
    const shown = delta.added.slice(0, MAX_NAMES).map((entry) => {
      const note = shortNote(entry.description);
      return note === "" ? entry.name : `${entry.name}(${note})`;
    });
    const rest = delta.added.length - shown.length;
    parts.push(`추가 ${shown.join(", ")}${rest > 0 ? ` 외 ${String(rest)}개` : ""}`);
  }
  if (delta.changed.length > 0) parts.push(`변경 ${listed(delta.changed)}`);
  if (delta.removed.length > 0) parts.push(`삭제 ${listed(delta.removed)}`);
  return `스킬 인덱스 변경: ${parts.join(", ")}`;
}
