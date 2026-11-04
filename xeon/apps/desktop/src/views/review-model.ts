import { assertNever } from "@fresnel/contracts";
import type { EventId } from "@fresnel/contracts/conversation";
import type {
  ApprovalRequestedPayload,
  ReviewAnswerJson,
  ReviewAppliedPayload,
  ReviewSubmittedPayload,
} from "@fresnel/contracts/records";
import type { HunkView } from "@fresnel/contracts/wire";
import type { ReviewTarget } from "../state/ui/index.ts";

// 변경 검토 화면(P-04)의 순수 값(V-06, L4.desktop-ux §6.8). 화면 로컬 초안, 제출할 `ReviewAnswer`, 제출이 막힌 이유,
// hunk 줄 번호, 접힘, 라운드 따라가기, 키 판정, 제출 결과 표의 줄을 React 밖에서 시험한다(test/views/review-model.test.ts).
// 초안은 서버에 저장하지 않는다(W-03). 제출 모양은 core-tools `validateResponse`와 `ReviewAnswerSchema`가 받는 모양이다.

/** hunk의 결정. 대기는 아직 고르지 않은 hunk다 */
export type HunkDecision = "pending" | "approved" | "rejected";
/** 사용자가 고르는 결정(대기는 고르는 것이 아니라 지우는 것이다) */
export type SetDecision = Exclude<HunkDecision, "pending">;

/** 줄 의견의 대상 줄. 지운 줄은 옛 파일 번호, 추가와 문맥은 새 파일 번호다(`diffRowsOf`와 같은 규칙) */
export interface ReviewLine {
  readonly side: "old" | "new";
  readonly number: number;
}

/** 의견 한 줄. hunk에 붙고 지우기 대상이라 키를 가진다. `line`이 null이면 hunk 전체 의견이다 */
export interface ReviewComment {
  readonly key: string;
  readonly hunkId: string;
  readonly line: ReviewLine | null;
  readonly body: string;
}

/** 화면 로컬 초안. 결정은 고른 hunk만 적고, 의견은 쓴 순서대로 든다 */
export interface ReviewDraft {
  readonly decisions: Readonly<Record<string, SetDecision>>;
  readonly comments: readonly ReviewComment[];
  /** "남은 것 모두 승인": 참이면 대기 hunk를 승인으로 보고 제출한다 */
  readonly approveRemaining: boolean;
  /** 다음 의견 키 번호. 지운 뒤에도 키가 겹치지 않게 늘기만 한다 */
  readonly nextKey: number;
}

export const EMPTY_REVIEW_DRAFT: ReviewDraft = {
  decisions: {},
  comments: [],
  approveRemaining: false,
  nextKey: 1,
};

/** 의견 글자 상한(`ReviewAnswer`의 `body` 최대 길이와 같다) */
export const COMMENT_MAX = 8000;
/** 접기 기준: hunk가 이보다 많은 파일은 처음에 이만큼만 보이고 나머지는 펼친다 */
const HUNK_FOLD = 30;

export function hunkDecisionOf(draft: ReviewDraft, hunkId: string): HunkDecision {
  return draft.decisions[hunkId] ?? "pending";
}

/** hunk 하나의 결정을 정한다. `pending`이면 결정을 지운다 */
export function setHunkDecision(
  draft: ReviewDraft,
  hunkId: string,
  decision: HunkDecision,
): ReviewDraft {
  const { [hunkId]: _previous, ...rest } = draft.decisions;
  return {
    ...draft,
    decisions: decision === "pending" ? rest : { ...rest, [hunkId]: decision },
  };
}

/** 승인·거절 단추: 이미 같은 결정이면 대기로 되돌리고, 아니면 그 결정을 준다 */
export function toggleHunkDecision(
  draft: ReviewDraft,
  hunkId: string,
  decision: SetDecision,
): ReviewDraft {
  const next: HunkDecision = hunkDecisionOf(draft, hunkId) === decision ? "pending" : decision;
  return setHunkDecision(draft, hunkId, next);
}

/** 파일 단위 승인·거절: 파일의 hunk 모두에 같은 결정을 준다. 모두 이미 그 결정이면 대기로 되돌린다 */
export function toggleFileDecision(
  draft: ReviewDraft,
  hunkIds: readonly string[],
  decision: SetDecision,
): ReviewDraft {
  const next: HunkDecision = hunkIds.every((id) => hunkDecisionOf(draft, id) === decision)
    ? "pending"
    : decision;
  return hunkIds.reduce((acc, id) => setHunkDecision(acc, id, next), draft);
}

/** 의견을 더한다. 앞뒤 공백을 떼고, 빈 글이면 초안을 그대로 돌려준다. `line`을 주면 그 줄에 붙는다 */
export function addReviewComment(
  draft: ReviewDraft,
  hunkId: string,
  text: string,
  line: ReviewLine | null = null,
): ReviewDraft {
  const body = text.trim();
  if (body === "") return draft;
  return {
    ...draft,
    comments: [
      ...draft.comments,
      { key: `c${draft.nextKey}`, hunkId, line, body: body.slice(0, COMMENT_MAX) },
    ],
    nextKey: draft.nextKey + 1,
  };
}

export function removeReviewComment(draft: ReviewDraft, key: string): ReviewDraft {
  return { ...draft, comments: draft.comments.filter((comment) => comment.key !== key) };
}

export function commentsOfHunk(draft: ReviewDraft, hunkId: string): readonly ReviewComment[] {
  return draft.comments.filter((comment) => comment.hunkId === hunkId);
}

function setApproveRemaining(draft: ReviewDraft, on: boolean): ReviewDraft {
  return { ...draft, approveRemaining: on };
}

/** 주어진 hunk들의 결정 수. 대기는 전체에서 승인과 거절을 뺀 수다 */
export interface ReviewTally {
  readonly approved: number;
  readonly rejected: number;
  readonly pending: number;
  readonly total: number;
}

export function tallyOf(hunkIds: readonly string[], draft: ReviewDraft): ReviewTally {
  const approved = hunkIds.filter((id) => hunkDecisionOf(draft, id) === "approved").length;
  const rejected = hunkIds.filter((id) => hunkDecisionOf(draft, id) === "rejected").length;
  return {
    approved,
    rejected,
    pending: hunkIds.length - approved - rejected,
    total: hunkIds.length,
  };
}

type CommentJson = ReviewAnswerJson["comments"][number];

/**
 * 제출 답(`ReviewAnswer`). 결정한 hunk만 싣고(대기는 싣지 않는다), 의견은 hunk에 붙여 보낸다(줄 의견은 줄까지 싣는다).
 * 이 리뷰의 hunk가 아닌 의견은 서버가 버리므로 여기서 뺀다. 순서는 리뷰의 hunk 순서와 의견을 쓴 순서다.
 */
export function reviewAnswerOf(hunkIds: readonly string[], draft: ReviewDraft): ReviewAnswerJson {
  const known = new Set(hunkIds);
  return {
    decisions: hunkIds.flatMap((hunkId) => {
      const decision = draft.decisions[hunkId];
      return decision === undefined ? [] : [{ hunkId, decision }];
    }),
    comments: draft.comments
      .filter((comment) => known.has(comment.hunkId))
      .map((comment): CommentJson => ({
        target:
          comment.line === null
            ? { type: "hunk", hunkId: comment.hunkId }
            : { type: "hunk", hunkId: comment.hunkId, line: comment.line },
        body: comment.body,
      })),
    submit: true,
    approveRemaining: draft.approveRemaining,
  };
}

/** "모두 승인": 남은 hunk를 모두 승인하고 제출한다(L4 §6.8, L2.artifacts §4.2.4). 초안은 싣지 않는다 */
export const APPROVE_ALL_ANSWER: ReviewAnswerJson = {
  decisions: [],
  comments: [],
  submit: true,
  approveRemaining: true,
};

/** 제출이 막힌 이유. 연결이 없으면 오프라인, 보내는 중이면 보내는 중, 대기 hunk가 남았으면 대기다 */
export type SubmitBlock = "offline" | "busy" | "pending";

/** 제출을 막는 이유 하나. 막히지 않았으면 null이다(오프라인, 보내는 중이 먼저 본다) */
export function submitBlockOf(state: {
  readonly tally: ReviewTally;
  readonly approveRemaining: boolean;
  readonly live: boolean;
  readonly busy: boolean;
}): SubmitBlock | null {
  if (!state.live) return "offline";
  if (state.busy) return "busy";
  if (!state.approveRemaining && state.tally.pending > 0) return "pending";
  return null;
}

/** 접기를 적용한 hunk 목록. 펼치지 않은 파일은 `HUNK_FOLD`개만 보이고 나머지 수를 준다 */
export function foldedHunksOf<T>(
  hunks: readonly T[],
  expanded: boolean,
): { readonly shown: readonly T[]; readonly hidden: number } {
  if (expanded || hunks.length <= HUNK_FOLD) return { shown: hunks, hidden: 0 };
  return { shown: hunks.slice(0, HUNK_FOLD), hidden: hunks.length - HUNK_FOLD };
}

/** 줄 하나의 표시. 지운 줄은 옛 파일 번호, 추가와 문맥은 새 파일 번호다(caustic `CodeDiffLine` 규칙) */
export interface DiffRow {
  readonly kind: "context" | "add" | "remove";
  readonly number: number;
  readonly text: string;
}

export function diffRowsOf(
  hunk: Pick<HunkView, "oldStart" | "newStart" | "lines">,
): readonly DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNumber = hunk.oldStart;
  let newNumber = hunk.newStart;
  for (const line of hunk.lines) {
    if (line.kind === "del") {
      rows.push({ kind: "remove", number: oldNumber, text: line.text });
      oldNumber += 1;
    } else if (line.kind === "add") {
      rows.push({ kind: "add", number: newNumber, text: line.text });
      newNumber += 1;
    } else {
      rows.push({ kind: "context", number: newNumber, text: line.text });
      oldNumber += 1;
      newNumber += 1;
    }
  }
  return rows;
}

/** 줄 하나가 줄 의견의 대상이 될 때의 줄(지운 줄은 옛 파일 번호, 나머지는 새 파일 번호) */
export function lineOfRow(row: DiffRow): ReviewLine {
  return { side: row.kind === "remove" ? "old" : "new", number: row.number };
}

/** 파일들의 hunk 본문 id를 리뷰 순서대로 모은다 */
export function hunkIdsOf(
  files: readonly { readonly hunks: readonly { readonly hunkId: string }[] }[],
): readonly string[] {
  return files.flatMap((file) => file.hunks.map((hunk) => hunk.hunkId));
}

/** 화면이 보는 검토 요청 본문(승인 요청의 `review`와 같은 모양) */
export type ReviewSummary = Extract<ApprovalRequestedPayload["body"], { kind: "review" }>["review"];

/** 대기열의 승인 한 건. 엔진 거울의 `PendingApproval`이 이 모양을 가진다 */
export interface ReviewCandidate {
  readonly approvalId: EventId;
  readonly request: ApprovalRequestedPayload;
}

/**
 * 지금 보여 줄 검토 승인. 연 승인이 아직 대기열에 있으면 그것이다. 해결됐으면 같은 리뷰의 가장 높은 라운드 승인을 따라간다
 * (§6.8 다음 라운드). 둘 다 없으면 null이고 화면은 "이미 처리된 요청이에요"를 보인다.
 */
export function currentReviewOf(
  target: ReviewTarget,
  pending: readonly ReviewCandidate[],
): { readonly approvalId: EventId; readonly review: ReviewSummary } | null {
  let next: { readonly approvalId: EventId; readonly review: ReviewSummary } | null = null;
  for (const candidate of pending) {
    const { body } = candidate.request;
    if (body.kind !== "review" || body.review.reviewId !== target.reviewId) continue;
    if (candidate.approvalId === target.approvalId) {
      return { approvalId: candidate.approvalId, review: body.review };
    }
    if (next === null || body.review.round > next.review.round) {
      next = { approvalId: candidate.approvalId, review: body.review };
    }
  }
  return next;
}

/** 화면의 고르기 상태: 고른 파일, 집중한 hunk(키보드 커서), 쓰는 중인 의견, 펼친 파일. 초안과 함께 한 상태다 */
export interface ReviewState {
  readonly draft: ReviewDraft;
  readonly selectedPath: string | null;
  /** 집중한 hunk. 고른 파일의 보이는 hunk 가운데 하나이거나 없다(null). j·k·n·p와 클릭이 옮긴다 */
  readonly focusedHunkId: string | null;
  readonly composing: {
    readonly hunkId: string;
    readonly line: ReviewLine | null;
    readonly text: string;
  } | null;
  readonly expanded: readonly string[];
}

export const INITIAL_REVIEW_STATE: ReviewState = {
  draft: EMPTY_REVIEW_DRAFT,
  selectedPath: null,
  focusedHunkId: null,
  composing: null,
  expanded: [],
};

export type ReviewAction =
  /** 고른 파일과 집중한 hunk를 옮긴다. 파일이 바뀌면 쓰던 의견은 닫힌다 */
  | { readonly type: "focusMoved"; readonly path: string; readonly hunkId: string | null }
  | { readonly type: "fileExpanded"; readonly path: string }
  | { readonly type: "hunkDecided"; readonly hunkId: string; readonly decision: SetDecision }
  | {
      readonly type: "fileDecided";
      readonly hunkIds: readonly string[];
      readonly decision: SetDecision;
    }
  | {
      readonly type: "composeOpened";
      readonly hunkId: string;
      readonly line: ReviewLine | null;
    }
  | { readonly type: "composeChanged"; readonly text: string }
  | { readonly type: "composeCancelled" }
  | {
      readonly type: "commentAdded";
      readonly hunkId: string;
      readonly line: ReviewLine | null;
      readonly text: string;
    }
  | { readonly type: "commentRemoved"; readonly key: string }
  | { readonly type: "approveRemainingChanged"; readonly on: boolean };

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "focusMoved":
      return {
        ...state,
        selectedPath: action.path,
        focusedHunkId: action.hunkId,
        composing: action.path === state.selectedPath ? state.composing : null,
      };
    case "fileExpanded":
      return state.expanded.includes(action.path)
        ? state
        : { ...state, expanded: [...state.expanded, action.path] };
    case "hunkDecided":
      return {
        ...state,
        focusedHunkId: action.hunkId,
        draft: toggleHunkDecision(state.draft, action.hunkId, action.decision),
      };
    case "fileDecided":
      return {
        ...state,
        draft: toggleFileDecision(state.draft, action.hunkIds, action.decision),
      };
    case "composeOpened":
      return {
        ...state,
        focusedHunkId: action.hunkId,
        composing: { hunkId: action.hunkId, line: action.line, text: "" },
      };
    case "composeChanged":
      return state.composing === null
        ? state
        : { ...state, composing: { ...state.composing, text: action.text } };
    case "composeCancelled":
      return { ...state, composing: null };
    case "commentAdded": {
      const draft = addReviewComment(state.draft, action.hunkId, action.text, action.line);
      // 빈 글이면 입력 칸을 그대로 둔다
      return { ...state, draft, composing: draft === state.draft ? state.composing : null };
    }
    case "commentRemoved":
      return { ...state, draft: removeReviewComment(state.draft, action.key) };
    case "approveRemainingChanged":
      return { ...state, draft: setApproveRemaining(state.draft, action.on) };
    default:
      return assertNever(action, "ReviewAction");
  }
}

/**
 * 화면의 파일 한 개. 경로, 변경 종류, 이진 여부는 승인 요청의 요약이 주고(순서도 그 요약이 정한다), hunk 본문은 `review.get`이 준다.
 * 이진 파일은 본문에 hunk가 없다.
 */
export interface ReviewFile {
  readonly path: string;
  readonly change: ReviewSummary["files"][number]["change"];
  readonly binary: boolean;
  readonly hunks: readonly HunkView[];
}

/** 요약 파일 목록에 본문의 hunk를 경로로 붙인다. 본문에 없는 파일은 hunk가 없다 */
export function reviewFilesOf(
  summary: ReviewSummary["files"],
  bodies: readonly { readonly path: string; readonly hunks: readonly HunkView[] }[],
): readonly ReviewFile[] {
  return summary.map((file) => ({
    path: file.path,
    change: file.change,
    binary: file.binary,
    hunks: bodies.find((body) => body.path === file.path)?.hunks ?? [],
  }));
}

/** 접기를 적용한 뒤 보이는 hunk id. 펼치지 않은 긴 파일은 앞쪽 `HUNK_FOLD`개뿐이다 */
export function shownHunkIdsOf(file: ReviewFile, expanded: readonly string[]): readonly string[] {
  return foldedHunksOf(file.hunks, expanded.includes(file.path)).shown.map((hunk) => hunk.hunkId);
}

/** 제출 규칙이 열려 있는가(키 ⌘Enter가 쓴다). 화면 하단의 제출 단추와 같은 판정이다 */
export function submitOpenOf(
  hunkIds: readonly string[],
  draft: ReviewDraft,
  state: { readonly live: boolean; readonly busy: boolean },
): boolean {
  return (
    submitBlockOf({
      tally: tallyOf(hunkIds, draft),
      approveRemaining: draft.approveRemaining,
      live: state.live,
      busy: state.busy,
    }) === null
  );
}

/** 키 판정이 보는 화면 값. 파일 순서, 파일마다 전체 hunk와 보이는 hunk, 고른 파일, 집중한 hunk, 의견을 쓰는 hunk, 잠금이다 */
export interface ReviewKeyFile {
  readonly path: string;
  readonly hunkIds: readonly string[];
  readonly shownHunkIds: readonly string[];
}

export interface ReviewKeyContext {
  readonly files: readonly ReviewKeyFile[];
  readonly selectedPath: string | null;
  readonly focusedHunkId: string | null;
  readonly composingHunkId: string | null;
  /** 응답을 보내는 중이 아니다. 결정·의견·파일 승인 키는 이때만 먹는다 */
  readonly editable: boolean;
  /** 제출 규칙이 열려 있다. 아니면 ⌘Enter가 아무 일도 하지 않는다 */
  readonly submitOpen: boolean;
}

/** 화면 값에서 키 판정 값을 만든다 */
export function reviewKeyContextOf(
  files: readonly ReviewFile[],
  state: ReviewState,
  flags: { readonly editable: boolean; readonly submitOpen: boolean },
): ReviewKeyContext {
  return {
    files: files.map((file) => ({
      path: file.path,
      hunkIds: file.hunks.map((hunk) => hunk.hunkId),
      shownHunkIds: shownHunkIdsOf(file, state.expanded),
    })),
    selectedPath: state.selectedPath,
    focusedHunkId: state.focusedHunkId,
    composingHunkId: state.composing?.hunkId ?? null,
    editable: flags.editable,
    submitOpen: flags.submitOpen,
  };
}

/** 키 입력 하나의 필요한 모양. `editing`은 의견 입력 칸에 초점이 있다는 뜻이다 */
export interface ReviewKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
  readonly editing: boolean;
}

/** 키가 만드는 동작. 제출만 화면이 따로 맡고(답을 조립해야 한다), 나머지는 초안 동작이다 */
export type ReviewKeyAction = ReviewAction | { readonly type: "submit" };

/** WebKit은 한글 조합 중 Enter의 keydown에 이 keyCode를 싣는다(composer-model과 같은 까닭) */
const IME_PROCESS_KEY_CODE = 229;

/** 고른 파일의 자리. 고른 파일이 없거나 목록에 없으면 첫 파일이다 */
function selectedIndexOf(files: readonly ReviewKeyFile[], selectedPath: string | null): number {
  return Math.max(
    0,
    files.findIndex((file) => file.path === selectedPath),
  );
}

/** j·k: 파일 이동. 끝에서는 멈춘다(돌지 않는다). 옮긴 파일의 첫 보이는 hunk에 초점을 준다 */
function stepFile(state: ReviewKeyContext, delta: 1 | -1): ReviewAction | null {
  const { files } = state;
  if (files.length === 0) return null;
  const index = selectedIndexOf(files, state.selectedPath);
  const target = files[index + delta];
  if (target === undefined) return null;
  return { type: "focusMoved", path: target.path, hunkId: target.shownHunkIds[0] ?? null };
}

/** n·p: 보이는 hunk 이동. 파일 경계를 넘는다. 초점이 없으면 n은 첫 hunk, p는 마지막 hunk다 */
function stepHunk(state: ReviewKeyContext, delta: 1 | -1): ReviewAction | null {
  const flat = state.files.flatMap((file) =>
    file.shownHunkIds.map((hunkId) => ({ path: file.path, hunkId })),
  );
  if (flat.length === 0) return null;
  const index = flat.findIndex((entry) => entry.hunkId === state.focusedHunkId);
  const next = index === -1 ? (delta === 1 ? 0 : flat.length - 1) : index + delta;
  const target = flat[next];
  if (target === undefined) return null;
  return { type: "focusMoved", path: target.path, hunkId: target.hunkId };
}

/** 집중한 hunk가 보이는 hunk인지. 키의 결정과 의견은 보이는 hunk에만 건다 */
function focusedShown(state: ReviewKeyContext): string | null {
  const id = state.focusedHunkId;
  if (id === null) return null;
  return state.files.some((file) => file.shownHunkIds.includes(id)) ? id : null;
}

/**
 * 키 하나의 동작. 입력 칸에 글을 쓰는 중이면 ⌘Enter와 Esc만 본다. IME 조합 중, Alt 조합, 목록에 없는 수식 조합은 무시한다.
 * ⇧A는 고른 파일 전체를 승인하고, a·r은 집중한 hunk를 승인·거절한다(단추와 같은 토글). 판정할 것이 없으면 null이다.
 */
export function reviewKeyOf(
  event: ReviewKeyEvent,
  state: ReviewKeyContext,
): ReviewKeyAction | null {
  if (event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE || event.altKey) return null;
  const modified = event.metaKey || event.ctrlKey;
  if (event.key === "Enter") {
    return modified && !event.shiftKey && state.submitOpen ? { type: "submit" } : null;
  }
  if (event.key === "Escape" || event.key === "Esc") {
    if (modified || event.shiftKey || state.composingHunkId === null) return null;
    return { type: "composeCancelled" };
  }
  if (event.editing || modified) return null;
  const letter = event.key.toLowerCase();
  if (letter === "a" && event.shiftKey) {
    if (!state.editable) return null;
    const file = state.files[selectedIndexOf(state.files, state.selectedPath)];
    if (file === undefined || file.hunkIds.length === 0) return null;
    return { type: "fileDecided", hunkIds: file.hunkIds, decision: "approved" };
  }
  if (event.shiftKey) return null;
  if (letter === "j") return stepFile(state, 1);
  if (letter === "k") return stepFile(state, -1);
  if (letter === "n") return stepHunk(state, 1);
  if (letter === "p") return stepHunk(state, -1);
  if (letter === "a" || letter === "r") {
    const hunkId = focusedShown(state);
    if (!state.editable || hunkId === null) return null;
    return { type: "hunkDecided", hunkId, decision: letter === "a" ? "approved" : "rejected" };
  }
  if (letter === "c") {
    const hunkId = focusedShown(state);
    if (!state.editable || hunkId === null || state.composingHunkId === hunkId) return null;
    return { type: "composeOpened", hunkId, line: null };
  }
  return null;
}

/** 제출 결과 표의 한 줄. 되돌림 결과 하나가 hunk마다 한 줄이다. hunk가 없는 결과는 hunk 자리가 null이다 */
export interface ReviewResultRow {
  readonly path: string;
  readonly hunkId: string | null;
  readonly result: ReviewOutcome["result"];
  readonly method: ReviewOutcome["method"];
  readonly detail: string | null;
}

type ReviewOutcome = ReviewAppliedPayload["outcomes"][number];
/** 에이전트 입력 전달(`review_submitted`의 delivery) */
export type ReviewDelivery = NonNullable<ReviewSubmittedPayload["delivery"]>;

/** 되돌림 결과를 표의 줄로 편다. 순서는 이벤트의 순서를 따른다 */
export function reviewResultRowsOf(outcomes: readonly ReviewOutcome[]): readonly ReviewResultRow[] {
  return outcomes.flatMap((outcome): ReviewResultRow[] => {
    const base = {
      path: outcome.path,
      result: outcome.result,
      method: outcome.method,
      detail: outcome.detail ?? null,
    };
    if (outcome.hunkIds.length === 0) return [{ ...base, hunkId: null }];
    return outcome.hunkIds.map((hunkId) => ({ ...base, hunkId }));
  });
}

/** 제출 결과 표의 화면 값. 줄과 에이전트 전달(없으면 null) */
export interface ReviewResultView {
  readonly rows: readonly ReviewResultRow[];
  readonly delivery: { readonly when: string; readonly requestId: string } | null;
}

/** 엔진 거울의 결과(되돌림 결과, 전달)를 제출 결과 표의 값으로 바꾼다 */
export function reviewResultViewOf(
  outcomes: readonly ReviewOutcome[] | null,
  delivery: ReviewDelivery | null,
): ReviewResultView {
  return {
    rows: reviewResultRowsOf(outcomes ?? []),
    delivery: delivery === null ? null : { when: delivery.when, requestId: delivery.requestId },
  };
}
