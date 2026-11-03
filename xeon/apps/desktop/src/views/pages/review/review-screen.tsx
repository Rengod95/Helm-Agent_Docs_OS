import { detach, rethrow } from "@fresnel/contracts";
import type { EventId } from "@fresnel/contracts/conversation";
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
import { useApprovalMirror, useLinkPhase } from "../../../state/engine/index.ts";
import { useApprovalDetail, useApprovalSend, useReviewTarget } from "../../../state/ui/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useCommands } from "../../commands.ts";
import {
  APPROVE_ALL_ANSWER,
  INITIAL_REVIEW_STATE,
  currentReviewOf,
  hunkIdsOf,
  reviewAnswerOf,
  reviewFilesOf,
  reviewReducer,
  submitBlockOf,
  tallyOf,
  type ReviewSummary,
} from "../../review-model.ts";
import {
  ReviewView,
  type ReviewBodyLoad,
  type ReviewHandlers,
  type ReviewOpenView,
} from "./review-view.tsx";

// 변경 검토 화면(P-04)의 동작. 연 승인은 UI 스토어의 `reviewTarget`이 정하고, 대기열에서 빠지면 같은 리뷰의 다음 라운드를 따라간다.
// hunk 본문은 `commands.review.get`으로 읽고(파일 종류와 이진 여부는 승인 요청의 요약이 준다), 결정과 의견은 화면 로컬 초안(`reviewReducer`)이 든다.
// 답은 `respondApproval`로 보낸다. 그림은 `review-view.tsx`가, 답과 초안의 값은 `review-model.ts`가 맡는다.

/** 본문 읽기의 원본 상태. 화면 값(`ReviewBodyLoad`)은 요약과 합쳐 그릴 때 만든다 */
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly review: ReviewGetResult };

export function ReviewScreen(): ReactNode {
  const target = useReviewTarget();
  const mirror = useApprovalMirror();
  const shell = useShellActions();
  const pending = useMemo(
    () =>
      mirror.ids.flatMap((id) => {
        const entry = mirror.byId[id];
        return entry === undefined ? [] : [entry];
      }),
    [mirror],
  );
  const onBack = (): void => {
    shell.updatePlace({ screen: "chat", scroll: 0 });
  };
  const current = target === null ? null : currentReviewOf(target, pending);
  if (current === null) return <ReviewView onBack={onBack} open={null} />;
  // 승인이 바뀌면(다음 라운드) 화면 초안과 본문 읽기를 새로 시작한다
  return (
    <OpenReview
      key={current.approvalId}
      approvalId={current.approvalId}
      review={current.review}
      onBack={onBack}
    />
  );
}

function OpenReview(props: {
  readonly approvalId: EventId;
  readonly review: ReviewSummary;
  readonly onBack: () => void;
}): ReactNode {
  const { approvalId, review } = props;
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const sendState = useApprovalSend(approvalId);
  const detail = useApprovalDetail(approvalId);
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
      busy,
    }) === null;

  const answerWith = (answer: ReviewAnswerJson): void => {
    detach(commands.respondApproval(approvalId, { decision: "answer", answer }), rethrow);
  };
  const denyWith = (): void => {
    detach(commands.respondApproval(approvalId, { decision: "deny" }), rethrow);
  };

  const handlers: ReviewHandlers = {
    retry: () => {
      setLoad({ kind: "loading" });
      detach(readBody(), rethrow);
    },
    fileSelect: (path) => {
      dispatch({ type: "fileSelected", path });
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
    composeOpen: (hunkId) => {
      dispatch({ type: "composeOpened", hunkId });
    },
    composeChange: (text) => {
      dispatch({ type: "composeChanged", text });
    },
    composeSave: (hunkId) => {
      dispatch({ type: "commentAdded", hunkId, text: state.composing?.text ?? "" });
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
    submit: () => {
      if (!submitOpen()) return;
      answerWith(reviewAnswerOf(hunkIds, state.draft));
    },
    approveAll: () => {
      answerWith(APPROVE_ALL_ANSWER);
    },
    deny: () => {
      denyWith();
    },
  };

  const view: ReviewOpenView = {
    head: { title: review.title, round: review.round },
    body,
    live,
    busy,
    state,
    failure: busy || sendState === undefined ? undefined : sendState,
    failureDetail: detail,
    handlers,
  };
  return <ReviewView onBack={props.onBack} open={view} />;
}
