import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { HunkView } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  INITIAL_REVIEW_STATE,
  addReviewComment,
  reviewFilesOf,
  toggleHunkDecision,
  type ReviewState,
} from "../../src/views/review-model.ts";
import {
  ReviewView,
  type ReviewHandlers,
  type ReviewOpenView,
} from "../../src/views/pages/review/review-view.tsx";

// 변경 검토 화면(P-04)의 서버 렌더. 닫힘(이미 처리됨), 읽는 중, 읽지 못함, 바뀐 내용 없음, 오프라인 잠금, 긴 파일 접기,
// 대기 hunk가 남은 제출 잠금과 "남은 것 모두 승인"의 풀림을 그린다. 클릭은 DOM이 없어 시험하지 못한다.
// 문장은 `t()`로 비교하고, 단추의 잠김은 글이 정확히 같은 단추의 여는 태그 `disabled` 속성으로 본다.

const NOOP = (): void => {};
const HANDLERS: ReviewHandlers = {
  retry: NOOP,
  fileSelect: NOOP,
  fileExpand: NOOP,
  hunkDecide: NOOP,
  fileDecide: NOOP,
  composeOpen: NOOP,
  composeChange: NOOP,
  composeSave: NOOP,
  composeCancel: NOOP,
  commentRemove: NOOP,
  approveRemaining: NOOP,
  submit: NOOP,
  approveAll: NOOP,
  deny: NOOP,
};

function hunk(id: string, header: string): HunkView {
  return {
    hunkId: id,
    header,
    oldStart: 10,
    newStart: 10,
    lines: [
      { kind: "context", text: "const ttl = 5" },
      { kind: "del", text: "return at + ttl < now" },
      { kind: "add", text: "return atMs + ttlMs < now" },
    ],
  };
}

const CACHE_HUNKS = [
  hunk("f0h0", "@@ -10,3 +10,3 @@ isExpired"),
  hunk("f0h1", "@@ -40,2 +40,2 @@ set"),
];
const NOTE_HUNK = [hunk("f1h0", "@@ -1,1 +1,1 @@")];
const CACHE = { path: "src/cache.ts", change: "modified" as const, binary: false, hunks: 2 };
const NOTE = { path: "docs/cache.md", change: "modified" as const, binary: false, hunks: 1 };

function view(overrides: Partial<ReviewOpenView>): ReviewOpenView {
  return {
    head: { title: "캐시 만료 수정", round: 1 },
    body: {
      kind: "ready",
      files: reviewFilesOf(
        [CACHE, NOTE],
        [
          { path: CACHE.path, hunks: CACHE_HUNKS },
          { path: NOTE.path, hunks: NOTE_HUNK },
        ],
      ),
    },
    live: true,
    busy: false,
    state: INITIAL_REVIEW_STATE,
    failure: undefined,
    failureDetail: undefined,
    handlers: HANDLERS,
    ...overrides,
  };
}

function render(open: ReviewOpenView | null): string {
  return renderToString(<ReviewView onBack={NOOP} open={open} />);
}

/** 글이 정확히 `label`인 단추의 여는 태그가 disabled인지. 그런 단추가 없으면 undefined */
function disabledOf(html: string, label: string): boolean | undefined {
  const chunk = html
    .split("<button")
    .slice(1)
    .find((candidate) => candidate.includes(`>${label}</button>`));
  if (chunk === undefined) return undefined;
  return chunk.slice(0, chunk.indexOf(">")).includes(' disabled=""');
}

function withState(state: Partial<ReviewState>): ReviewState {
  return { ...INITIAL_REVIEW_STATE, ...state };
}

describe("review screen states", () => {
  test("closed: the approval is gone, so the screen says it was already handled and offers no answer", () => {
    const html = render(null);
    expect(html).toContain(t("desktop.review.closed"));
    expect(html).toContain(t("desktop.review.closed.hint"));
    expect(disabledOf(html, t("desktop.review.submit"))).toBeUndefined();
  });

  test("loading: the body is read, so a skeleton status shows and no diff is drawn", () => {
    const html = render(view({ body: { kind: "loading" } }));
    expect(html).toContain(t("desktop.review.loading"));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('data-slot="code-diff"');
    expect(disabledOf(html, t("desktop.review.submit"))).toBe(true);
  });

  test("failed: the body could not be read, and retry is offered only while connected", () => {
    const html = render(view({ body: { kind: "failed" } }));
    expect(html).toContain(t("desktop.review.load.failed"));
    expect(disabledOf(html, t("desktop.review.retry"))).toBe(false);
    const offline = render(view({ body: { kind: "failed" }, live: false }));
    expect(disabledOf(offline, t("desktop.review.retry"))).toBe(true);
  });

  test("no changes: a review with no files says so instead of drawing a list", () => {
    const html = render(view({ body: { kind: "ready", files: [] } }));
    expect(html).toContain(t("desktop.review.empty"));
    expect(html).not.toContain(t("desktop.approvals.review.files.label"));
  });

  test("offline: decisions stay on screen, and the answers that need the engine are locked", () => {
    const html = render(view({ live: false }));
    expect(html).toContain(t("desktop.review.offline"));
    expect(disabledOf(html, t("desktop.review.submit"))).toBe(true);
    expect(disabledOf(html, t("desktop.approvals.review.approveAll.button"))).toBe(true);
    expect(disabledOf(html, t("desktop.review.deny"))).toBe(true);
    expect(disabledOf(html, t("desktop.review.hunk.approve"))).toBe(false);
  });

  test("pending hunks block submit until the rest is approved, and the blocked reason says how many", () => {
    const blocked = render(view({}));
    expect(blocked).toContain(t("desktop.review.submit.pending", { count: 3 }));
    expect(disabledOf(blocked, t("desktop.review.submit"))).toBe(true);
    const released = render(
      view({
        state: withState({ draft: { ...INITIAL_REVIEW_STATE.draft, approveRemaining: true } }),
      }),
    );
    expect(released).not.toContain(t("desktop.review.submit.pending", { count: 3 }));
    expect(disabledOf(released, t("desktop.review.submit"))).toBe(false);
  });

  test("the summary counts each decision, and a decided hunk shows its word", () => {
    const draft = addReviewComment(
      toggleHunkDecision(
        toggleHunkDecision(INITIAL_REVIEW_STATE.draft, "f0h0", "approved"),
        "f0h1",
        "rejected",
      ),
      "f0h1",
      "ms 단위 주석 필요",
    );
    const html = render(view({ state: withState({ draft }) }));
    expect(html).toContain(t("desktop.review.summary", { approved: 1, rejected: 1, pending: 1 }));
    expect(html).toContain(t("desktop.review.hunk.decision.approved"));
    expect(html).toContain(t("desktop.review.hunk.decision.rejected"));
    expect(html).toContain("ms 단위 주석 필요");
  });

  test("a file with more than 30 hunks folds the rest until it is expanded", () => {
    const many = Array.from({ length: 32 }, (_, index) =>
      hunk(`f0h${String(index)}`, `@@ -${String(index)},1 +${String(index)},1 @@`),
    );
    const files = reviewFilesOf(
      [{ ...CACHE, hunks: many.length }],
      [{ path: CACHE.path, hunks: many }],
    );
    const folded = render(view({ body: { kind: "ready", files } }));
    expect(folded).toContain(t("desktop.review.hunk.fold", { count: 2 }));
    const expanded = render(
      view({ body: { kind: "ready", files }, state: withState({ expanded: [CACHE.path] }) }),
    );
    expect(expanded).not.toContain(t("desktop.review.hunk.fold", { count: 2 }));
  });

  test("the send in flight locks the answers and shows the sending status", () => {
    const html = render(view({ busy: true }));
    expect(html).toContain(t("desktop.approvals.sendingStatus"));
    expect(disabledOf(html, t("desktop.review.deny"))).toBe(true);
  });

  test("a failed answer shows the same sentence the card shows", () => {
    const html = render(view({ failure: "closed" }));
    expect(html).toContain(t("desktop.approvals.failure.closed"));
  });

  test("a binary file has no hunks to decide, and says so", () => {
    const binary = { path: "img/logo.png", change: "added" as const, binary: true, hunks: 0 };
    const files = reviewFilesOf([binary], [{ path: binary.path, hunks: [] }]);
    const html = render(view({ body: { kind: "ready", files } }));
    expect(html).toContain(t("desktop.review.file.binary"));
    expect(html).not.toContain(t("desktop.review.file.approve"));
  });
});
