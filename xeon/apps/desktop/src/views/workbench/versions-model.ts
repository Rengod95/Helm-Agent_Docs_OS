// 버전 탭의 그림 계산(AGE-76, 이력판). 이력 줄 목록, 사건과 승인 말, 되돌릴 수 없는 까닭, 빠지는 바뀜, 대기 중인 되돌리기를 값으로 낸다.
// 화면(`versions-tab.tsx`, `rollback-dialog.tsx`)은 이 값을 그린다. 읽기와 명령은 탭이 맡는다.
import type { MessageId } from "@fresnel/client/i18n";
import type {
  HistoryActor,
  HistoryEvent,
  PluginHistoryEntry,
  ReviewItem,
  RollbackBlock,
  WhatItDoesDiff,
} from "@fresnel/contracts/wire";

/** 탭이 읽은 이력. `unsupported`는 엔진이 이력을 모른다(오래된 엔진), `error`는 읽기 실패다 */
export type HistoryRead =
  | { readonly kind: "loading" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      /** 최신이 앞이다 */
      readonly entries: readonly PluginHistoryEntry[];
      readonly blocked: RollbackBlock | null;
      readonly pending: PendingRollback | null;
    };

/** 대기 중인 되돌리기 한 줄. `to`는 되돌릴 판의 버전이다 */
export interface PendingRollback {
  readonly itemId: string;
  readonly to: string;
}

/** 고른 줄의 변경 내용을 읽은 상태. `none`은 이 줄에 항목 id가 없다(판의 내용이 남지 않았다) */
export type DetailRead =
  | { readonly kind: "none" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly item: ReviewItem };

/** 되돌릴 수 없는 까닭. 플러그인이 막는 쪽(`RollbackBlock`), 탭의 잠금, 지금 판, 내용이 남지 않음 */
export type RollbackStop = RollbackBlock | "locked" | "current" | "notKept";

/** 빠지는 바뀜에 나열하는 줄 수 상한. 넘는 줄은 수로만 센다 */
export const DROPPED_LIMIT = 5;

const EVENT_WORD: Readonly<Record<HistoryEvent, MessageId>> = {
  create: "desktop.workbench.history.event.create",
  edit: "desktop.workbench.history.event.edit",
  import: "desktop.workbench.history.event.import",
  bundled: "desktop.workbench.history.event.bundled",
  rollback: "desktop.workbench.history.event.rollback",
};

const ACTOR_WORD: Readonly<Record<HistoryActor, MessageId>> = {
  user: "desktop.workbench.history.actor.user",
  migration: "desktop.workbench.history.actor.migration",
  release: "desktop.workbench.history.actor.release",
};

const STOP_WORD: Readonly<Record<RollbackStop, MessageId>> = {
  builtin: "desktop.workbench.history.stop.builtin",
  bundled: "desktop.workbench.history.stop.bundled",
  project: "desktop.workbench.history.stop.project",
  managed: "desktop.workbench.history.stop.managed",
  locked: "desktop.workbench.history.stop.managed",
  current: "desktop.workbench.history.stop.current",
  notKept: "desktop.workbench.history.stop.notKept",
};

/** 사건(만들기, 고치기, 가져오기, 내장 업데이트, 되돌리기)의 말 */
export function eventWordOf(event: HistoryEvent): MessageId {
  return EVENT_WORD[event];
}

/** 승인한 쪽의 말(사용자 승인, 가져오기, 앱 업데이트). 요약이 없는 줄의 글이다 */
export function actorWordOf(actor: HistoryActor): MessageId {
  return ACTOR_WORD[actor];
}

/** 되돌릴 수 없는 까닭의 말 */
export function stopWordOf(stop: RollbackStop): MessageId {
  return STOP_WORD[stop];
}

/** 판의 글: 매니페스트 버전, 없으면 해시 앞 8자 */
export function versionLabelOf(entry: Pick<PluginHistoryEntry, "version" | "contentHash">): string {
  return entry.version ?? entry.contentHash.replace(/^sha256:/, "").slice(0, 8);
}

/** 줄을 가리키는 키. 같은 판이 여러 줄이어도 사건과 시각이 다르다 */
export function entryKeyOf(entry: PluginHistoryEntry): string {
  return `${entry.at}|${entry.event}|${entry.contentHash}`;
}

/** 고른 줄의 자리(이력 안). 고른 것이 없거나 이력이 바뀌어 사라졌으면 맨 앞(최신)이다 */
export function selectedIndexOf(
  entries: readonly PluginHistoryEntry[],
  key: string | null,
): number {
  if (key === null) return 0;
  const index = entries.findIndex((entry) => entryKeyOf(entry) === key);
  return index < 0 ? 0 : index;
}

/** 이력 줄 하나의 그림 */
export interface HistoryLine {
  readonly key: string;
  /** 이력 안의 자리. 고르기는 이 자리로 한다 */
  readonly index: number;
  readonly label: string;
  /** 지금 쓰는 판인가("지금" 꼬리표) */
  readonly current: boolean;
  readonly selected: boolean;
  readonly event: MessageId;
  readonly at: string;
  /** 줄의 아래 글: 요약이 있으면 요약, 없으면 승인한 쪽의 말 */
  readonly note:
    | { readonly kind: "summary"; readonly text: string }
    | { readonly kind: "actor"; readonly word: MessageId };
}

/** 이력 줄 목록. 최신이 앞이고 고른 자리의 줄만 `selected`다 */
export function historyLinesOf(
  entries: readonly PluginHistoryEntry[],
  selected: number,
): readonly HistoryLine[] {
  return entries.map((entry, index) => ({
    key: entryKeyOf(entry),
    index,
    label: versionLabelOf(entry),
    current: entry.current,
    selected: index === selected,
    event: eventWordOf(entry.event),
    at: entry.at,
    note:
      entry.summary === null || entry.summary.trim() === ""
        ? { kind: "actor", word: actorWordOf(entry.actor) }
        : { kind: "summary", text: entry.summary },
  }));
}

/**
 * 되돌릴 수 없는 까닭. 순서는 플러그인이 막는 까닭, 탭의 잠금(관리자 잠금), 지금 판, 내용이 남지 않음이다.
 * 아무 까닭도 없으면 null이고 되돌릴 수 있다
 */
export function rollbackStopOf(input: {
  readonly blocked: RollbackBlock | null;
  readonly locked: boolean;
  readonly entry: Pick<PluginHistoryEntry, "current" | "kept">;
}): RollbackStop | null {
  if (input.blocked !== null) return input.blocked;
  if (input.locked) return "locked";
  if (input.entry.current) return "current";
  if (!input.entry.kept) return "notKept";
  return null;
}

/**
 * 빠지는 바뀜: 고른 줄보다 최신인 줄(최신이 앞). 앞의 `limit`줄을 나열하고 나머지 수를 `rest`로 준다.
 * 고른 줄이 맨 앞이면 빈 목록이다
 */
export function droppedOf(
  entries: readonly PluginHistoryEntry[],
  selected: number,
  limit: number = DROPPED_LIMIT,
): { readonly lines: readonly PluginHistoryEntry[]; readonly rest: number } {
  const newer = entries.slice(0, selected);
  const lines = newer.slice(0, limit);
  return { lines, rest: newer.length - lines.length };
}

/** 지금 판의 글. 이력에 지금 줄이 없으면 설치본의 버전이다 */
export function currentLabelOf(entries: readonly PluginHistoryEntry[], installed: string): string {
  const current = entries.find((entry) => entry.current);
  return current === undefined ? installed : versionLabelOf(current);
}

/** 같은 플러그인의 대기 중인 되돌리기 항목 하나. 있으면 이력 목록 맨 위에 보인다 */
export function pendingRollbackOf(
  items: readonly ReviewItem[],
  name: string,
): PendingRollback | null {
  for (const item of items) {
    const rollback = item.rollback;
    if (item.state === "pending" && item.name === name && rollback !== undefined) {
      return { itemId: item.itemId, to: rollback.toVersion };
    }
  }
  return null;
}

/**
 * 고른 줄의 변경 내용 읽기 상태. 고른 줄에 항목 id가 없으면 `none`이고, 받은 응답이 아직 없거나 다른 항목의 응답이면 읽는 중이다
 * (늦게 온 응답이 다른 줄의 그림을 덮지 않게 항목 id를 맞춘다)
 */
export function detailRead(
  itemId: string | null,
  received: { readonly itemId: string; readonly read: DetailRead } | null,
): DetailRead {
  if (itemId === null) return { kind: "none" };
  if (received === null || received.itemId !== itemId) return { kind: "loading" };
  return received.read;
}

/** "하는 일의 차이"에 줄이 하나라도 있나. 없으면 "하는 일은 그대로예요"를 보인다 */
export function hasChangesOf(diff: WhatItDoesDiff): boolean {
  return diff.added.length + diff.changed.length + diff.removed.length > 0;
}
