import { assertNever } from "@fresnel/contracts";
import type { EventId } from "@fresnel/contracts/conversation";
import type { ApprovalRequestedPayload, ReviewAnswerJson } from "@fresnel/contracts/records";
import type { HunkView } from "@fresnel/contracts/wire";
import type { ReviewTarget } from "../state/ui/index.ts";

// 변경 검토 화면(P-04)의 순수 값(V-06, L4.desktop-ux §6.8). 화면 로컬 초안, 제출할 `ReviewAnswer`, 제출이 막힌 이유,
// hunk 줄 번호, 접힘, 라운드 따라가기를 React 밖에서 시험한다(test/views/review-model.test.ts).
// 초안은 서버에 저장하지 않는다(W-03). 제출 모양은 core-tools `validateResponse`와 `ReviewAnswerSchema`가 받는 모양이다.

/** hunk의 결정. 대기는 아직 고르지 않은 hunk다 */
export type HunkDecision = "pending" | "approved" | "rejected";
/** 사용자가 고르는 결정(대기는 고르는 것이 아니라 지우는 것이다) */
export type SetDecision = Exclude<HunkDecision, "pending">;

/** 의견 한 줄. hunk에 붙고 지우기 대상이라 키를 가진다 */
export interface ReviewComment {
  readonly key: string;
  readonly hunkId: string;
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

/** 의견을 더한다. 앞뒤 공백을 떼고, 빈 글이면 초안을 그대로 돌려준다 */
export function addReviewComment(draft: ReviewDraft, hunkId: string, text: string): ReviewDraft {
  const body = text.trim();
  if (body === "") return draft;
  return {
    ...draft,
    comments: [
      ...draft.comments,
      { key: `c${draft.nextKey}`, hunkId, body: body.slice(0, COMMENT_MAX) },
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
 * 제출 답(`ReviewAnswer`). 결정한 hunk만 싣고(대기는 싣지 않는다), 의견은 hunk에 붙여 보낸다.
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
        target: { type: "hunk", hunkId: comment.hunkId },
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

/** 화면의 고르기 상태: 고른 파일, 쓰는 중인 의견, 펼친 파일. 초안과 함께 한 상태다 */
export interface ReviewState {
  readonly draft: ReviewDraft;
  readonly selectedPath: string | null;
  readonly composing: { readonly hunkId: string; readonly text: string } | null;
  readonly expanded: readonly string[];
}

export const INITIAL_REVIEW_STATE: ReviewState = {
  draft: EMPTY_REVIEW_DRAFT,
  selectedPath: null,
  composing: null,
  expanded: [],
};

export type ReviewAction =
  | { readonly type: "fileSelected"; readonly path: string }
  | { readonly type: "fileExpanded"; readonly path: string }
  | { readonly type: "hunkDecided"; readonly hunkId: string; readonly decision: SetDecision }
  | {
      readonly type: "fileDecided";
      readonly hunkIds: readonly string[];
      readonly decision: SetDecision;
    }
  | { readonly type: "composeOpened"; readonly hunkId: string }
  | { readonly type: "composeChanged"; readonly text: string }
  | { readonly type: "composeCancelled" }
  | { readonly type: "commentAdded"; readonly hunkId: string; readonly text: string }
  | { readonly type: "commentRemoved"; readonly key: string }
  | { readonly type: "approveRemainingChanged"; readonly on: boolean };

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "fileSelected":
      return { ...state, selectedPath: action.path, composing: null };
    case "fileExpanded":
      return state.expanded.includes(action.path)
        ? state
        : { ...state, expanded: [...state.expanded, action.path] };
    case "hunkDecided":
      return {
        ...state,
        draft: toggleHunkDecision(state.draft, action.hunkId, action.decision),
      };
    case "fileDecided":
      return {
        ...state,
        draft: toggleFileDecision(state.draft, action.hunkIds, action.decision),
      };
    case "composeOpened":
      return { ...state, composing: { hunkId: action.hunkId, text: "" } };
    case "composeChanged":
      return state.composing === null
        ? state
        : { ...state, composing: { ...state.composing, text: action.text } };
    case "composeCancelled":
      return { ...state, composing: null };
    case "commentAdded": {
      const draft = addReviewComment(state.draft, action.hunkId, action.text);
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
