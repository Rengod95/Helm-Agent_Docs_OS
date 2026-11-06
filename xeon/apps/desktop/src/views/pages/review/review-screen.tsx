import { detach, rethrow } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import type { ReviewAnswerJson } from "@fresnel/contracts/records";
import type { ReviewGetResult } from "@fresnel/contracts/wire";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useApprovalMirror,
  useLinkPhase,
  useReviewResults,
  useThreadSummaries,
} from "../../../state/engine/index.ts";
import {
  useApprovalDetail,
  useApprovalSend,
  useObserving,
  useReviewTarget,
} from "../../../state/ui/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useCommands } from "../../commands.ts";
import {
  INITIAL_REVIEW_STATE,
  currentReviewOf,
  hunkIdsOf,
  reviewAnswerOf,
  reviewFilesOf,
  reviewReducer,
  reviewResultViewOf,
  shownHunkIdsOf,
  submitBlockOf,
  tallyOf,
  type ReviewKeyAction,
  type ReviewSummary,
} from "../../review-model.ts";
import {
  ReviewView,
  type ReviewBodyLoad,
  type ReviewHandlers,
  type ReviewOpenView,
} from "./review-view.tsx";

// 변경 검토 화면(P-04)의 동작. 연 승인은 UI 스토어의 `reviewTarget`이 정하고, 대기열에서 빠지면 같은 리뷰의 다음 라운드를 따라간다.
// 검토가 닫혔으면 이 리뷰의 제출 결과(엔진 거울의 `review_applied`·`review_submitted`)를 보인다.
// hunk 본문은 `commands.review.get`으로 읽고(파일 종류와 이진 여부는 승인 요청의 요약이 준다), 결정과 의견은 화면 로컬 초안(`reviewReducer`)이 든다.
// 답은 `respondApproval`로 보낸다. 그림은 `review-view.tsx`가, 답과 초안의 값은 `review-model.ts`가 맡는다.

/** 본문 읽기의 원본 상태. 화면 값(`ReviewBodyLoad`)은 요약과 합쳐 그릴 때 만든다 */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly review: ReviewGetResult };

/** 마지막으로 연 승인. 다른 곳에서 답해 대기열에서 빠져도 본문을 읽기 전용으로 두려고 기억한다 */
interface SeenReview {
  readonly approvalId: EventId;
  readonly review: ReviewSummary;
  readonly threadId: ThreadId | null;
}

export function ReviewScreen(): ReactNode {
  const target = useReviewTarget();
  const mirror = useApprovalMirror();
  const results = useReviewResults();
  const shell = useShellActions();
  const pending = useMemo(
    () =>
      mirror.ids.flatMap((id) => {
        const entry = mirror.byId[id];
        return entry === undefined ? [] : [entry];
      }),
    [mirror],
  );
  // 이 화면에서 답을 보낸 승인들. 그 승인이 빠진 것은 다른 곳의 답이 아니라 우리 답이다
  const [answered, setAnswered] = useState<readonly EventId[]>([]);
  const [seen, setSeen] = useState<SeenReview | null>(null);
  const onBack = (): void => {
    shell.updatePlace({ screen: "chat", scroll: 0 });
  };
  const onAnswered = (approvalId: EventId): void => {
    setAnswered((ids) => (ids.includes(approvalId) ? ids : [...ids, approvalId]));
  };
  const current = target === null ? null : currentReviewOf(target, pending);
  const currentId = current === null ? null : current.approvalId;
  const currentReview = current === null ? null : current.review;
  const currentEntry = pending.find((entry) => entry.approvalId === currentId);
  const currentThread = currentEntry === undefined ? null : currentEntry.threadId;
  // 렌더 중에 맞춘다(효과로 두면 승인이 빠진 렌더에 옛 값이 한 번 더 그려진다). 같은 값이면 다시 쓰지 않는다
  if (
    currentId !== null &&
    currentReview !== null &&
    (seen === null ||
      seen.approvalId !== currentId ||
      seen.review !== currentReview ||
      seen.threadId !== currentThread)
  ) {
    setSeen({ approvalId: currentId, review: currentReview, threadId: currentThread });
  }
  if (current === null) {
    // 제출이 끝나 승인이 대기열에서 빠졌다. 결과가 왔으면 제출 결과 표를 보인다
    const record =
      target === null ? undefined : results.find((r) => r.reviewId === target.reviewId);
    const result =
      record !== undefined && record.submitted
        ? reviewResultViewOf(record.outcomes, record.delivery)
        : null;
    // 다른 곳에서 답해 승인이 빠졌다(P-04 D-resolved). 결과가 없고 이 화면에서 답하지 않았으면 마지막 본문을 읽기 전용으로 둔다
    if (
      result === null &&
      seen !== null &&
      target !== null &&
      seen.review.reviewId === target.reviewId &&
      !answered.includes(seen.approvalId)
    ) {
      return (
        <OpenReview
          key={seen.approvalId}
          approvalId={seen.approvalId}
          review={seen.review}
          threadId={seen.threadId}
          resolved
          onAnswered={onAnswered}
          onBack={onBack}
        />
      );
    }
    return <ReviewView onBack={onBack} open={null} result={result} />;
  }
  // 승인이 바뀌면(다음 라운드) 화면 초안과 본문 읽기를 새로 시작한다
  return (
    <OpenReview
      key={current.approvalId}
      approvalId={current.approvalId}
      review={current.review}
      threadId={currentThread}
      resolved={false}
      onAnswered={onAnswered}
      onBack={onBack}
    />
  );
}

function OpenReview(props: {
  readonly approvalId: EventId;
  readonly review: ReviewSummary;
  /** 승인이 속한 대화. 승인이 대기열에서 빠진 뒤에도 머리에 이름을 보이려고 호출한 쪽이 넘긴다 */
  readonly threadId: ThreadId | null;
  /** 다른 곳에서 답해 대기열에서 빠졌다. 본문은 읽기 전용이다 */
  readonly resolved: boolean;
  readonly onAnswered: (approvalId: EventId) => void;
  readonly onBack: () => void;
}): ReactNode {
  const { approvalId, review, threadId } = props;
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const sendState = useApprovalSend(approvalId);
  const detail = useApprovalDetail(approvalId);
  const threads = useThreadSummaries();
  // 원인 대화: 승인이 속한 대화의 이름과, 그 대화를 관찰만 하고 있는지(다른 창이 쓰는 중)
  const thread = threads.find((summary) => summary.threadId === threadId)?.title ?? null;
  const observing = useObserving(threadId);
  const [state, dispatch] = useReducer(reviewReducer, INITIAL_REVIEW_STATE);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  // 늦게 온 읽기가 새 읽기를 덮지 않도록 읽기마다 번호를 매긴다
  const latestRead = useRef(0);
  const reviewId = review.reviewId;

  const readBody = useCallback(async (): Promise<void> => {
    latestRead.current += 1;
    const seq = latestRead.current;
    const read = await commands.review.get(reviewId);
    if (seq !== latestRead.current) return;
    setLoad(read.ok ? { kind: "ready", review: read.value } : { kind: "failed" });
  }, [commands, reviewId]);

  useEffect(() => {
    // 연결이 없으면 읽지 않는다. 이미 읽은 본문은 그대로 둔다
    if (live) detach(readBody(), rethrow);
  }, [live, readBody]);

  const body: ReviewBodyLoad =
    load.kind === "ready"
      ? { kind: "ready", files: reviewFilesOf(review.files, load.review.files) }
      : load;
  const busy = sendState === "sending";
  const hunkIds = body.kind === "ready" ? hunkIdsOf(body.files) : [];
  const submitOpen = (): boolean =>
    body.kind === "ready" &&
    submitBlockOf({
      tally: tallyOf(hunkIds, state.draft),
      approveRemaining: state.draft.approveRemaining,
      live,
      busy: busy || observing,
    }) === null;

  const answerWith = (answer: ReviewAnswerJson): void => {
    props.onAnswered(approvalId);
    detach(commands.respondApproval(approvalId, { decision: "answer", answer }), rethrow);
  };
  const denyWith = (): void => {
    props.onAnswered(approvalId);
    detach(commands.respondApproval(approvalId, { decision: "deny" }), rethrow);
  };
  const submitReview = (): void => {
    if (!submitOpen()) return;
    answerWith(reviewAnswerOf(hunkIds, state.draft));
  };

  const handlers: ReviewHandlers = {
    retry: () => {
      setLoad({ kind: "loading" });
      detach(readBody(), rethrow);
    },
    fileSelect: (path) => {
      // 파일을 고르면 그 파일의 첫 보이는 hunk에 초점을 준다(j·k와 같은 규칙)
      const file = body.kind === "ready" ? body.files.find((f) => f.path === path) : undefined;
      const hunkId = file === undefined ? null : (shownHunkIdsOf(file, state.expanded)[0] ?? null);
      dispatch({ type: "focusMoved", path, hunkId });
    },
    fileExpand: (path) => {
      dispatch({ type: "fileExpanded", path });
    },
    hunkDecide: (hunkId, decision) => {
      dispatch({ type: "hunkDecided", hunkId, decision });
    },
    fileDecide: (ids, decision) => {
      dispatch({ type: "fileDecided", hunkIds: ids, decision });
    },
    composeOpen: (hunkId, line) => {
      dispatch({ type: "composeOpened", hunkId, line });
    },
    composeChange: (text) => {
      dispatch({ type: "composeChanged", text });
    },
    composeSave: (hunkId, line) => {
      dispatch({ type: "commentAdded", hunkId, line, text: state.composing?.text ?? "" });
    },
    composeCancel: () => {
      dispatch({ type: "composeCancelled" });
    },
    commentRemove: (key) => {
      dispatch({ type: "commentRemoved", key });
    },
    approveRemaining: (on) => {
      dispatch({ type: "approveRemainingChanged", on });
    },
    submit: submitReview,
    deny: () => {
      denyWith();
    },
    retryWrite: () => {
      if (threadId !== null) commands.retryWrite(threadId);
    },
    key: (action: ReviewKeyAction) => {
      // ⌘Enter는 제출 규칙을 다시 본다(`submitReview`가 막힌 제출을 보내지 않는다)
      if (action.type === "submit") {
        submitReview();
        return;
      }
      dispatch(action);
    },
  };

  const view: ReviewOpenView = {
    head: { title: review.title, round: review.round, thread },
    body,
    live,
    busy,
    observing,
    resolved: props.resolved,
    state,
    failure: busy || sendState === undefined ? undefined : sendState,
    failureDetail: detail,
    handlers,
  };
  return <ReviewView onBack={props.onBack} open={view} />;
}
