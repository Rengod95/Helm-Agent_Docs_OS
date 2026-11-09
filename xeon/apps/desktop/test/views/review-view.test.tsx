import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { HunkView } from "@fresnel/contracts/wire";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import {
  INITIAL_REVIEW_STATE,
  addReviewComment,
  reviewFilesOf,
  reviewResultViewOf,
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
  deny: NOOP,
  retryWrite: NOOP,
  key: NOOP,
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
    head: { title: "캐시 만료 수정", round: 1, thread: null },
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
    observing: false,
    resolved: false,
    state: INITIAL_REVIEW_STATE,
    failure: undefined,
    failureDetail: undefined,
    handlers: HANDLERS,
    ...overrides,
  };
}

/** 머리의 펼치기 단추가 셸 저장소를 읽으므로, 화면은 셸 문맥 안에서 그린다(앱에서도 셸 안에 그린다) */
function inShell(node: ReactNode): ReactElement {
  return <ShellStoreContext value={createShellStore(1280)}>{node}</ShellStoreContext>;
}

function render(open: ReviewOpenView | null): string {
  return renderToString(inShell(<ReviewView onBack={NOOP} open={open} />));
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
    expect(disabledOf(html, t("desktop.review.deny"))).toBe(true);
    expect(disabledOf(html, t("desktop.review.hunk.approve"))).toBe(false);
  });

  test("observing: another window writes this conversation, so decisions and submit are locked and a retry is offered", () => {
    const html = render(view({ observing: true }));
    expect(html).toContain(t("desktop.review.observing"));
    expect(disabledOf(html, t("desktop.review.submit"))).toBe(true);
    expect(disabledOf(html, t("desktop.review.hunk.approve"))).toBe(true);
    expect(disabledOf(html, t("desktop.composer.retryWrite.button"))).toBe(false);
  });

  test("resolved elsewhere: the last diff stays on screen read-only, with a neutral sentence, and nothing can be answered", () => {
    const html = render(view({ resolved: true }));
    expect(html).toContain(t("desktop.review.resolved"));
    expect(html).toContain(CACHE.path);
    expect(disabledOf(html, t("desktop.review.submit"))).toBe(true);
    expect(disabledOf(html, t("desktop.review.deny"))).toBe(true);
    expect(disabledOf(html, t("desktop.review.hunk.approve"))).toBe(true);
  });

  test("the header names the conversation the review came from, next to the round", () => {
    const html = render(view({ head: { title: "캐시 만료 수정", round: 2, thread: "캐시 작업" } }));
    expect(html).toContain("캐시 작업");
    expect(html).toContain(t("desktop.approvals.review.round", { round: 2 }));
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
    // host가 모르는 승인은 화면에서도 같은 문장으로 알린다(지우기 단추는 카드에만 있다)
    const gone = render(view({ failure: "gone" }));
    expect(gone).toContain("이 승인은 더 이상 답할 수 없어요.");
    expect(gone).toContain(t("desktop.approvals.failure.gone"));
  });

  test("a binary file has no hunks to decide, and says so", () => {
    const binary = { path: "img/logo.png", change: "added" as const, binary: true, hunks: 0 };
    const files = reviewFilesOf([binary], [{ path: binary.path, hunks: [] }]);
    const html = render(view({ body: { kind: "ready", files } }));
    expect(html).toContain(t("desktop.review.file.binary"));
    expect(html).not.toContain(t("desktop.review.file.approve"));
  });
});

describe("the submit result table, the key hints, and the line comments", () => {
  test("the key hints sit behind the footer's info icon, so the footer shows no hint line of its own", () => {
    const html = render(view({}));
    expect(html).toContain(t("desktop.review.keys"));
    expect(html).toContain('aria-label="' + t("desktop.craft.infoTip.label") + '"');
  });

  test("a closed review with a result shows the rows, the delivery line, and a close button", () => {
    const result = reviewResultViewOf(
      [
        { path: "src/cache.ts", hunkIds: ["f0h2"], result: "reverted", method: "workspace_files" },
        {
          path: "docs/cache.md",
          hunkIds: ["f2h0"],
          result: "conflict",
          method: "none",
          detail: "새 줄이 맞지 않아요: 직접 고쳐 주세요",
        },
      ],
      { requestId: "rv-01J", when: "followUp", commentIds: [] },
    );
    const html = renderToString(inShell(<ReviewView onBack={NOOP} open={null} result={result} />));
    expect(html).toContain(t("desktop.review.result.title"));
    expect(html).toContain("src/cache.ts");
    expect(html).toContain("f0h2");
    expect(html).toContain("docs/cache.md");
    expect(html).toContain("f2h0");
    expect(html).toContain(t("desktop.review.result.reverted"));
    expect(html).toContain(t("desktop.review.result.method.workspaceFiles"));
    expect(html).toContain(t("desktop.review.result.conflict"));
    expect(html).toContain("새 줄이 맞지 않아요: 직접 고쳐 주세요");
    expect(html).toContain(
      t("desktop.review.result.delivery", { when: "followUp", requestId: "rv-01J" }),
    );
    expect(html).toContain(`>${t("desktop.review.result.close")}</button>`);
    expect(html).not.toContain(t("desktop.review.closed"));
  });

  test("a result with no reverted hunks and no delivery says so, in the table's place and the delivery line's", () => {
    const html = renderToString(
      inShell(<ReviewView onBack={NOOP} open={null} result={reviewResultViewOf(null, null)} />),
    );
    expect(html).toContain(t("desktop.review.result.empty"));
    expect(html).toContain(t("desktop.review.result.delivery.none"));
  });

  test("a line comment is offered on each line while editable, and not while a send is in flight", () => {
    const label = t("desktop.review.line.comment", { number: 11 });
    expect(render(view({}))).toContain(`aria-label="${label}"`);
    expect(render(view({ busy: true }))).not.toContain(label);
  });

  test("a comment opened on a line labels the composer with the line and takes focus", () => {
    const html = render(
      view({
        state: withState({
          focusedHunkId: "f0h0",
          composing: { hunkId: "f0h0", line: { side: "new", number: 11 }, text: "" },
        }),
      }),
    );
    expect(html).toContain(
      `aria-label="${t("desktop.review.comment.line.label", { number: 11 })}"`,
    );
    expect(html).toContain(
      `placeholder="${t("desktop.review.comment.line.placeholder", { number: 11 })}"`,
    );
    expect(html).toContain("autofocus");
  });

  test("a line comment sits right after its line, before the next hunk", () => {
    const draft = addReviewComment(INITIAL_REVIEW_STATE.draft, "f0h0", "ms 단위 주석 필요", {
      side: "new",
      number: 11,
    });
    const html = render(view({ state: withState({ draft }) }));
    // 파일 열의 의견 목록에도 같은 글이 있으므로, 줄 뒤에서부터 찾는다
    const line = html.indexOf("return atMs + ttlMs");
    const note = html.indexOf("ms 단위 주석 필요", line);
    const nextHunk = html.indexOf("@@ -40,2", line);
    expect(line).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(line);
    expect(note).toBeLessThan(nextHunk);
  });

  test("the focused hunk is marked once, so the keyboard cursor shows", () => {
    const html = render(view({ state: withState({ focusedHunkId: "f0h1" }) }));
    expect(html).toContain('data-hunk="f0h1"');
    expect(html.split('data-focused="true"').length - 1).toBe(1);
  });
});
