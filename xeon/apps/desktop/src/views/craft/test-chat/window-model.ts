// 테스트 챗 창(C7, `review.m6-craft-flows` 6.14)의 순수 모델. 창의 꼴, 대화 빌리기, 끌기의 한계, 맥락 칩, 드래프트 줄을 정한다.
// 화면 부품은 `test-chat-window.tsx`, 상태 저장소는 `window-state.ts`다. 시험은 이 파일만 본다.
import type { ContextRef, ThreadId } from "@fresnel/contracts/conversation";
import type { DraftInfo } from "@fresnel/contracts/wire";
import type { MessageId } from "@fresnel/client/i18n";

/**
 * 창의 꼴 셋(개발 빌드의 전환기로 바꿔 본다). 셋 다 오른쪽 가운데의 세로 단추 띠 왼쪽 12px에서 끝나 띠와 겹치지 않는다.
 * - `dock`: 무대 오른쪽 아래 모서리의 카드(폭 440, 높이 640까지). 접으면 같은 모서리의 머리 한 줄. 기본 [제안]
 * - `column`: 무대 위아래를 다 쓰는 오른쪽 열(폭 440). 접으면 위쪽의 머리 한 줄
 * - `strip`: 무대 아래의 넓고 낮은 판(폭 720, 높이 480). 접으면 아래쪽의 머리 한 줄
 */
export type TestChatShape = "dock" | "column" | "strip";
export const TEST_CHAT_SHAPES: readonly TestChatShape[] = ["dock", "column", "strip"];
export const DEFAULT_TEST_CHAT_SHAPE: TestChatShape = "dock";

export const SHAPE_TEXT: Readonly<Record<TestChatShape, MessageId>> = {
  dock: "desktop.craft.testChat.dev.shape.dock",
  column: "desktop.craft.testChat.dev.shape.column",
  strip: "desktop.craft.testChat.dev.shape.strip",
};

/** 접힌 창이 서는 쪽. 열은 위, 나머지는 아래다 */
export function collapsedEdgeOf(shape: TestChatShape): "top" | "bottom" {
  return shape === "column" ? "top" : "bottom";
}

// ── 대화 빌리기 ──
// 창은 대화 화면의 부품(메시지, 도구 줄, 승인 카드, 입력창)을 그대로 쓰고, 그 부품들은 "고른 대화" 하나를 그린다.
// 그래서 창이 보이는 동안(Craft 영역, 창이 열림) 창의 대화를 고른 대화로 빌리고, 창이 숨으면 빌리기 전의 대화로 돌려준다.

export type Borrow =
  | { readonly kind: "idle" }
  /** `thread`를 빌렸다. 돌려줄 대화가 `returnTo`(없으면 null: 고른 대화를 비운다) */
  | { readonly kind: "lent"; readonly thread: ThreadId; readonly returnTo: ThreadId | null };

export type BorrowAction =
  | { readonly kind: "select"; readonly thread: ThreadId }
  | { readonly kind: "leave" }
  | null;

export const IDLE_BORROW: Borrow = { kind: "idle" };

/**
 * 다음 빌리기 상태와 할 일. `show`는 창이 지금 그릴 대화(창이 숨었으면 null), `selected`는 지금 고른 대화다.
 * 창이 숨을 때 고른 대화가 이미 다른 대화로 바뀌었으면(사용자가 다른 대화를 골랐다) 그대로 두고 돌려주지 않는다
 */
export function borrowNext(
  borrow: Borrow,
  input: { readonly show: ThreadId | null; readonly selected: ThreadId | null },
): { readonly borrow: Borrow; readonly action: BorrowAction } {
  const { show, selected } = input;
  if (show !== null) {
    if (borrow.kind === "idle") {
      const next: Borrow = {
        kind: "lent",
        thread: show,
        returnTo: selected === show ? null : selected,
      };
      return { borrow: next, action: selected === show ? null : { kind: "select", thread: show } };
    }
    const next: Borrow = { kind: "lent", thread: show, returnTo: borrow.returnTo };
    return { borrow: next, action: selected === show ? null : { kind: "select", thread: show } };
  }
  if (borrow.kind === "idle") return { borrow, action: null };
  if (selected !== borrow.thread) return { borrow: IDLE_BORROW, action: null };
  return {
    borrow: IDLE_BORROW,
    action:
      borrow.returnTo === null ? { kind: "leave" } : { kind: "select", thread: borrow.returnTo },
  };
}

/**
 * 창 밖의 Craft 화면(플러그인 상세의 최근 실행과 훅 시간, 검사 탭)이 볼 대화. 창이 빌린 대화가 열려 있으면 빌리기 전의 대화다
 * (없으면 null). 그 밖에는 열린 대화 그대로다. 테스트 챗은 창 안에서만 보이고 옆 화면이 따라가지 않는다
 */
export function workThreadOf(borrow: Borrow, open: ThreadId | null): ThreadId | null {
  return borrow.kind === "lent" && open === borrow.thread ? borrow.returnTo : open;
}

// ── 끌기 ──

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Offset {
  readonly x: number;
  readonly y: number;
}

export const ZERO_OFFSET: Offset = { x: 0, y: 0 };

/** 창과 둘레(무대, 세로 단추 띠) 사이(CSS px). 띠가 창 끝에서 떨어진 거리(`end-3`)와 같다 */
const WINDOW_GAP = 12;

/**
 * 끌어 옮긴 창의 위치를 둘레 안으로 자른다. `base`는 옮기기 전(오프셋 0)의 창 상자, `area`는 창이 설 수 있는 무대(머리 줄 아래),
 * `rail`은 세로 단추 띠(없으면 null). 창은 띠의 세로 칸(띠 왼쪽 끝 − `gap`부터 오른쪽)에 들어가지 않는다:
 * 띠는 본문 세로 가운데에 서고 창은 띠보다 길어서, 세로로 비키는 것만으로는 겹침을 막지 못한다
 */
export function clampOffset(
  base: Box,
  wanted: Offset,
  area: Box,
  rail: Box | null,
  gap: number = WINDOW_GAP,
): Offset {
  const rightLimit = Math.min(area.right - gap, rail === null ? Infinity : rail.left - gap);
  const minX = area.left + gap - base.left;
  const maxX = rightLimit - base.right;
  const minY = area.top + gap - base.top;
  const maxY = area.bottom - gap - base.bottom;
  return {
    x: clamp(wanted.x, minX, Math.max(minX, maxX)),
    y: clamp(wanted.y, minY, Math.max(minY, maxY)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── 맥락 칩 ──

/** 창 머리 아래 맥락 칩 하나. `plugin` 참조는 머리의 플러그인 이름과 같아 칩으로 두지 않는다 */
export interface ContextChip {
  readonly key: string;
  readonly label: MessageId;
}

const CONTEXT_TEXT: Readonly<Record<Exclude<ContextRef["kind"], "plugin">, MessageId>> = {
  finding: "desktop.craft.testChat.context.finding",
  turn: "desktop.craft.testChat.context.turn",
  call: "desktop.craft.testChat.context.call",
  replay: "desktop.craft.testChat.context.replay",
  review: "desktop.craft.testChat.context.review",
  draft: "desktop.craft.testChat.context.draft",
};

export function contextChipsOf(contexts: readonly ContextRef[]): readonly ContextChip[] {
  return contexts.flatMap((ref, index): ContextChip[] =>
    ref.kind === "plugin" ? [] : [{ key: `${ref.kind}:${index}`, label: CONTEXT_TEXT[ref.kind] }],
  );
}

// ── 드래프트 줄 ──

/** 창 아래쪽 드래프트 줄. 이 대화가 만든 가장 새 드래프트 하나다 */
export type DraftRow =
  | { readonly kind: "none" }
  /** 아직 리뷰에 보내지 않았다. "리뷰로 보내기" */
  | { readonly kind: "draft"; readonly draft: DraftInfo }
  /** 리뷰에 보냈다. "리뷰에서 보기" */
  | { readonly kind: "inReview"; readonly draft: DraftInfo; readonly itemId: string };

/** `plugin.draft.list`(새것이 먼저) 가운데 이 대화가 만든 첫 드래프트 */
export function draftRowOf(drafts: readonly DraftInfo[], threadId: string): DraftRow {
  const mine = drafts.find((draft) => draft.originThreadId === threadId);
  if (mine === undefined) return { kind: "none" };
  return mine.submittedItemId === null
    ? { kind: "draft", draft: mine }
    : { kind: "inReview", draft: mine, itemId: mine.submittedItemId };
}

const HASH_PREFIX = "sha256:";
const SHORT_HASH = 7;

/** 드래프트 줄의 이름: 엔진이 붙인 이름표가 있으면 그것, 없으면 내용 해시 앞 7자 */
export function draftLabelOf(draft: DraftInfo): string {
  if (draft.label !== null && draft.label.trim() !== "") return draft.label;
  const hex = draft.contentHash.startsWith(HASH_PREFIX)
    ? draft.contentHash.slice(HASH_PREFIX.length)
    : draft.contentHash;
  return hex.slice(0, SHORT_HASH);
}
