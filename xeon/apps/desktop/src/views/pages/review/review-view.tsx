import { InboxArt } from "../../illustrations/index.tsx";
import { t } from "@fresnel/client/i18n";
import type { HunkView } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Checkbox,
  CodeDiffLine,
  codeDiffVariants,
  EmptyState,
  IconButton,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  ScrollArea,
  Select,
  SelectOption,
  Skeleton,
  Table,
  Textarea,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { ChevronLeft } from "@caustic/react/icons";
import { Fragment, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ApprovalFailure } from "../../../state/ui/index.ts";
import { APPROVAL_FAILURE_ID, REVIEW_CHANGE_ID } from "../../approval-form.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import {
  COMMENT_MAX,
  diffRowsOf,
  type DiffRow,
  type ReviewComment,
  type ReviewFile,
  foldedHunksOf,
  hunkDecisionOf,
  commentsOfHunk,
  hunkIdsOf,
  lineOfRow,
  reviewKeyContextOf,
  reviewKeyOf,
  submitBlockOf,
  submitOpenOf,
  tallyOf,
  type ReviewKeyAction,
  type ReviewKeyEvent,
  type ReviewLine,
  type ReviewResultView,
  type ReviewState,
  type ReviewTally,
  type SetDecision,
} from "../../review-model.ts";
import { decisionIdOf, methodIdOf, resultIdOf } from "./review-text.ts";

// 변경 검토 화면(P-04)의 그림. 상태와 동작은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 무대는 머리 한 줄, 가운데(파일 열 + diff 열, 스크롤은 diff 열 하나), 제출 줄로 나뉜다(mockups/p04-review와 같다).
// hunk 카드와 줄 의견 칸은 mockups/p04-review/parts/hunk-review.tsx를 옮긴 것이다. 줄 의견은 줄 바로 뒤에 놓는다.
// 키보드는 루트 `section`이 받는다. 판정은 `reviewKeyOf`가 하고, 그림은 집중한 hunk를 표시하고 화면이 보이도록 옮길 뿐이다.

/** 화면이 연 검토 요청의 머리 */
interface ReviewHead {
  readonly title: string;
  readonly round: number;
  /** 원인 대화의 이름. 대화 거울에 없으면 null */
  readonly thread: string | null;
}

/** hunk 본문 읽기의 상태 */
export type ReviewBodyLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly files: readonly ReviewFile[] };

/** 화면 동작. 속성 형태라 핸들러를 `onClick`에 그대로 넘긴다 */
export interface ReviewHandlers {
  readonly retry: () => void;
  readonly fileSelect: (path: string) => void;
  readonly fileExpand: (path: string) => void;
  readonly hunkDecide: (hunkId: string, decision: SetDecision) => void;
  readonly fileDecide: (hunkIds: readonly string[], decision: SetDecision) => void;
  /** 의견을 쓰기 시작한다. `line`이 null이면 hunk 전체 의견이다 */
  readonly composeOpen: (hunkId: string, line: ReviewLine | null) => void;
  readonly composeChange: (text: string) => void;
  readonly composeSave: (hunkId: string, line: ReviewLine | null) => void;
  readonly composeCancel: () => void;
  readonly commentRemove: (key: string) => void;
  readonly approveRemaining: (on: boolean) => void;
  readonly submit: () => void;
  readonly deny: () => void;
  /** 관찰을 끝내고 이 대화에 쓰기를 다시 시도한다 */
  readonly retryWrite: () => void;
  /** 키보드 판정의 결과. 제출은 화면이 답을 조립하고, 나머지는 초안 동작이다 */
  readonly key: (action: ReviewKeyAction) => void;
}

/** 연 검토 요청의 화면 값. 없으면(`open`이 null) 이미 처리된 요청이다 */
export interface ReviewOpenView {
  readonly head: ReviewHead;
  readonly body: ReviewBodyLoad;
  readonly live: boolean;
  /** 응답을 보내는 중 */
  readonly busy: boolean;
  /** 이 검토의 대화를 관찰만 하고 있어 쓸 수 없다(다른 창이 쓰고 있다) */
  readonly observing: boolean;
  /** 승인이 다른 곳에서 답해져 대기열에서 빠졌다. 본문은 읽기 전용으로 남는다 */
  readonly resolved: boolean;
  readonly state: ReviewState;
  /** 응답이 적용되지 않았을 때의 실패 표시. 보내는 중이면 undefined */
  readonly failure: ApprovalFailure | undefined;
  readonly failureDetail: string | undefined;
  readonly handlers: ReviewHandlers;
}

export interface ReviewViewProps {
  readonly onBack: () => void;
  readonly open: ReviewOpenView | null;
  /** 제출 결과 표. 검토가 닫혔고 이 리뷰의 결과가 있을 때만 준다 */
  readonly result?: ReviewResultView | null;
}

/** 변경 종류의 한 글자와 색(P-04 파일 열). 이름은 `REVIEW_CHANGE_ID`가 읽는 글로 따로 붙인다 */
const CHANGE_LETTER: Readonly<Record<ReviewFile["change"], string>> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};
const CHANGE_TONE: Readonly<Record<ReviewFile["change"], string>> = {
  added: "text-success-text",
  modified: "text-warning-text",
  deleted: "text-danger-text",
  renamed: "text-text-secondary",
};

export function ReviewView(props: ReviewViewProps): ReactNode {
  const { open } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const focusedHunkId = open?.state.focusedHunkId ?? null;
  const locked = open !== null && lockedOf(open);
  const keys =
    open === null || open.body.kind !== "ready"
      ? null
      : reviewKeyContextOf(open.body.files, open.state, {
          editable: !locked,
          submitOpen: submitOpenOf(hunkIdsOf(open.body.files), open.state.draft, {
            live: open.live,
            busy: locked,
          }),
        });
  // 화면이 열리면 키가 바로 먹도록 루트에 초점을 준다
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  // 집중한 hunk가 바뀌면 그 hunk가 보이도록 옮긴다
  useEffect(() => {
    if (focusedHunkId === null) return;
    rootRef.current
      ?.querySelector(`[data-hunk="${CSS.escape(focusedHunkId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusedHunkId]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (open === null || keys === null) return;
    const action = reviewKeyOf(keyEventOf(event), keys);
    if (action === null) return;
    event.preventDefault();
    // 처리한 키는 셸의 창 수준 바로 가기(Esc 포함)로 넘기지 않는다
    event.stopPropagation();
    open.handlers.key(action);
  };
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col px-1.5 outline-none"
    >
      {/* 머리 한 줄: 받은 요청으로 돌아가기 · 제목 · 라운드 · 원인 대화 */}
      <header className="flex h-10 flex-none items-center gap-1">
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.review.back")}
          onClick={props.onBack}
        >
          <ChevronLeft />
        </IconButton>
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 id={headingId} className="m-0 shrink-0 text-text-primary">
            {open === null ? t("desktop.review.title") : open.head.title}
          </h1>
          {open === null ? null : (
            <span className="shrink-0 text-ui-sm tabular-nums text-text-secondary">
              {t("desktop.approvals.review.round", { round: open.head.round })}
            </span>
          )}
          {open === null || open.head.thread === null ? null : (
            <span className="truncate text-ui-sm text-text-tertiary">{open.head.thread}</span>
          )}
        </div>
      </header>
      {open === null ? (
        props.result === undefined || props.result === null ? (
          <EmptyState
            size="sm"
            title={t("desktop.review.closed")}
            description={t("desktop.review.closed.hint")}
          />
        ) : (
          <ScrollArea label={t("desktop.review.result.title")} className="min-h-0 flex-1">
            <ResultBox result={props.result} onClose={props.onBack} />
          </ScrollArea>
        )
      ) : (
        <OpenReview view={open} />
      )}
    </section>
  );
}

/** 화면을 잠그는 이유가 하나라도 있는가: 보내는 중, 관찰만 하는 대화, 다른 곳에서 이미 답함. 잠기면 결정·의견·제출이 멈춘다 */
function lockedOf(view: ReviewOpenView): boolean {
  return view.busy || view.observing || view.resolved;
}

/** 키보드 이벤트에서 판정에 필요한 값만 옮긴다. keyCode는 WebKit이 IME 조합 중 Enter에 싣는 값이라 읽는다(composer와 같다) */
function keyEventOf(event: KeyboardEvent<HTMLElement>): ReviewKeyEvent {
  return {
    key: event.key,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    isComposing: event.nativeEvent.isComposing,
    // oxlint-disable-next-line typescript/no-deprecated -- keyCode는 폐기 표시지만 WebKit이 IME 처리 중 Enter keydown에 실어 보내는 값(229)이라 읽는다 (review.macos-checklist M-11)
    keyCode: event.keyCode,
    editing: event.target instanceof HTMLTextAreaElement,
  };
}

/** 제출 결과 표: 되돌림 결과를 hunk마다 한 줄로 보이고, 에이전트 전달을 한 줄로 보인다. [닫기]는 화면을 떠난다 */
function ResultBox(props: {
  readonly result: ReviewResultView;
  readonly onClose: () => void;
}): ReactNode {
  const { result } = props;
  const headingId = useId();
  const columns: TableColumn[] = [
    { key: "file", header: t("desktop.review.result.col.file") },
    { key: "hunk", header: t("desktop.review.result.col.hunk") },
    { key: "result", header: t("desktop.review.result.col.result") },
    { key: "method", header: t("desktop.review.result.col.method") },
    { key: "detail", header: t("desktop.review.result.col.detail") },
  ];
  const rows: TableRow[] = result.rows.map((row, index) => ({
    id: String(index),
    file: row.path,
    hunk: row.hunkId ?? "",
    result: t(resultIdOf(row.result)),
    method: t(methodIdOf(row.method)),
    detail: row.detail ?? "",
  }));
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4"
    >
      <header className="flex items-center gap-2">
        <h2 id={headingId} className="min-w-0 flex-1 text-ui-strong text-text-primary">
          {t("desktop.review.result.title")}
        </h2>
        <Button size="xs" variant="outline" onClick={props.onClose}>
          {t("desktop.review.result.close")}
        </Button>
      </header>
      {rows.length === 0 ? (
        <span className="text-caption text-text-secondary">{t("desktop.review.result.empty")}</span>
      ) : (
        <Table columns={columns} rows={rows} dividers={false} />
      )}
      <span className="text-caption text-text-secondary">
        {result.delivery === null
          ? t("desktop.review.result.delivery.none")
          : t("desktop.review.result.delivery", {
              when: result.delivery.when,
              requestId: result.delivery.requestId,
            })}
      </span>
    </section>
  );
}

function OpenReview(props: { readonly view: ReviewOpenView }): ReactNode {
  const { view } = props;
  const ready = view.body.kind === "ready";
  const files = view.body.kind === "ready" ? view.body.files : [];
  // 파일이 없으면 본문 자리가 빈 상태이고 제출 줄은 없다(P-04 S7)
  const empty = ready && files.length === 0;
  return (
    <>
      {view.live ? null : (
        <Alert
          tone="warning"
          layout="inline"
          action={<InfoTip text={t("desktop.review.offline.keep")} />}
        >
          {t("desktop.review.offline")}
        </Alert>
      )}
      {view.resolved ? (
        <Alert tone="neutral" layout="inline">
          {t("desktop.review.resolved")}
        </Alert>
      ) : null}
      {view.observing ? (
        <Alert
          tone="neutral"
          layout="inline"
          action={
            <Button size="xs" variant="outline" onClick={view.handlers.retryWrite}>
              {t("desktop.composer.retryWrite.button")}
            </Button>
          }
        >
          {t("desktop.review.observing")}
        </Alert>
      ) : null}
      <BodyPane view={view} />
      {view.failure === undefined ? null : (
        <Alert tone="danger" layout="inline">
          {t(APPROVAL_FAILURE_ID[view.failure])}
          {view.failureDetail === undefined ? null : ` (${view.failureDetail})`}
        </Alert>
      )}
      {empty ? null : <Footer view={view} ready={ready} files={files} />}
    </>
  );
}

function BodyPane(props: { readonly view: ReviewOpenView }): ReactNode {
  const { view } = props;
  if (view.body.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="grid content-start gap-2">
        <span className="sr-only">{t("desktop.review.loading")}</span>
        <Skeleton width="40%" height={16} />
        <Skeleton height={140} radius="xl" />
        <Skeleton height={96} radius="xl" />
      </div>
    );
  }
  if (view.body.kind === "failed") {
    return (
      <Alert
        tone="danger"
        action={
          <Button size="xs" variant="outline" disabled={!view.live} onClick={view.handlers.retry}>
            {t("desktop.review.retry")}
          </Button>
        }
      >
        {t("desktop.review.load.failed")}
      </Alert>
    );
  }
  const files = view.body.files;
  if (files.length === 0) {
    return (
      <EmptyState
        media={<InboxArt />}
        surface="none"
        title={t("desktop.review.empty")}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!view.live || view.busy}
            onClick={view.handlers.deny}
          >
            {t("desktop.review.deny")}
          </Button>
        }
      />
    );
  }
  const selected = files.find((file) => file.path === view.state.selectedPath) ?? files[0];
  // 넓은 폭은 파일 열과 diff 열을 나란히 두고, 좁은 폭은 파일 고르기 칸(Select)을 diff 열 머리에 둔다
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <FileList files={files} view={view} selectedPath={selected?.path ?? null} />
      <ScrollArea label={t("desktop.review.diff.label")} className="min-h-0 min-w-0 flex-1">
        <div className="grid gap-3 pe-1.5 pb-3">
          {selected === undefined ? null : (
            <>
              <Select
                size="xs"
                aria-label={t("desktop.approvals.review.files.label")}
                value={selected.path}
                onValueChange={(value) => {
                  view.handlers.fileSelect(value);
                }}
                className="w-full compact:hidden"
              >
                {files.map((file) => {
                  const tally = tallyOf(hunkIdsOf([file]), view.state.draft);
                  return (
                    <SelectOption key={file.path} value={file.path}>
                      {`${CHANGE_LETTER[file.change]} ${file.path} · ${countOf(file, tally)}`}
                    </SelectOption>
                  );
                })}
              </Select>
              <FilePane file={selected} view={view} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** 파일 열의 칸 글: 결정한 hunk 수와 전체. hunk가 없는 파일(이진 등)은 칸을 비운다 */
function countOf(file: ReviewFile, tally: ReviewTally): string {
  if (file.hunks.length === 0) return "";
  return `${String(tally.approved + tally.rejected)}/${String(tally.total)}`;
}

function FileList(props: {
  readonly files: readonly ReviewFile[];
  readonly view: ReviewOpenView;
  readonly selectedPath: string | null;
}): ReactNode {
  const { files, view, selectedPath } = props;
  const label = t("desktop.approvals.review.files.label");
  const comments = view.state.draft.comments;
  // 의견이 붙은 hunk가 든 파일을 찾아 그 파일로 옮긴다
  const fileOfHunk = (hunkId: string): string | undefined =>
    files.find((file) => file.hunks.some((hunk) => hunk.hunkId === hunkId))?.path;
  return (
    <ScrollArea label={label} className="hidden w-60 flex-none compact:block">
      <ListNavigation
        aria-label={label}
        kind="sessions"
        size="sm"
        as="div"
        className="w-60 pb-2 [&_[data-slot=list-navigation-group]]:grid-cols-1 [&_[data-slot=list-navigation-label]]:min-w-0 [&_[data-slot=list-navigation-label]]:truncate"
      >
        <ListNavigationGroup heading={label}>
          {files.map((file) => {
            const tally = tallyOf(hunkIdsOf([file]), view.state.draft);
            const count = countOf(file, tally);
            return (
              <ListNavigationItem
                key={file.path}
                current={file.path === selectedPath}
                leading={
                  <span
                    aria-label={t(REVIEW_CHANGE_ID[file.change])}
                    className={`w-3 text-center font-mono text-mono-sm ${CHANGE_TONE[file.change]}`}
                  >
                    {CHANGE_LETTER[file.change]}
                  </span>
                }
                count={count === "" ? undefined : count}
                onSelect={() => {
                  view.handlers.fileSelect(file.path);
                }}
                className="[&_[data-slot=list-navigation-label]]:font-mono [&_[data-slot=list-navigation-label]]:text-mono-sm"
              >
                {file.path}
              </ListNavigationItem>
            );
          })}
        </ListNavigationGroup>
        {comments.length === 0 ? null : (
          <ListNavigationGroup heading={t("desktop.review.comments.heading")}>
            {comments.map((comment) => (
              <ListNavigationItem
                key={comment.key}
                onSelect={() => {
                  const path = fileOfHunk(comment.hunkId);
                  if (path !== undefined) view.handlers.fileSelect(path);
                }}
              >
                {comment.body}
              </ListNavigationItem>
            ))}
          </ListNavigationGroup>
        )}
      </ListNavigation>
    </ScrollArea>
  );
}

function FilePane(props: { readonly file: ReviewFile; readonly view: ReviewOpenView }): ReactNode {
  const { file, view } = props;
  const { handlers, state } = view;
  const editable = !lockedOf(view);
  const hunkIds = hunkIdsOf([file]);
  const tally = tallyOf(hunkIds, state.draft);
  const expanded = state.expanded.includes(file.path);
  const folded = foldedHunksOf(file.hunks, expanded);
  const allApproved = tally.total > 0 && tally.approved === tally.total;
  const allRejected = tally.total > 0 && tally.rejected === tally.total;
  const added = countLines(file, "add");
  const removed = countLines(file, "del");
  return (
    <section aria-label={file.path} className="flex min-w-0 flex-col gap-3">
      {/* 파일 머리: 경로, +/−, 파일 단위 거절·승인 */}
      <div className="flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 className="m-0 min-w-0 truncate font-mono text-mono-md font-medium text-text-primary">
          {file.path}
        </h2>
        {added > 0 && <span className="font-mono text-mono-sm text-diff-add-text">+{added}</span>}
        {removed > 0 && (
          <span className="font-mono text-mono-sm text-diff-remove-text">−{removed}</span>
        )}
        <span aria-hidden className="flex-1" />
        {file.binary || hunkIds.length === 0 ? null : (
          <>
            <Button
              size="xs"
              variant={allRejected ? "soft" : "ghost"}
              aria-pressed={allRejected}
              disabled={!editable}
              onClick={() => {
                handlers.fileDecide(hunkIds, "rejected");
              }}
            >
              {t("desktop.review.file.reject")}
            </Button>
            <Button
              size="xs"
              variant={allApproved ? "soft" : "outline"}
              aria-pressed={allApproved}
              disabled={!editable}
              onClick={() => {
                handlers.fileDecide(hunkIds, "approved");
              }}
            >
              {t("desktop.review.file.approve")}
            </Button>
          </>
        )}
      </div>
      {file.binary ? (
        <div className="flex items-center gap-2.5 rounded-xl px-3 py-3 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
          <span className="flex-1 text-ui-sm text-text-secondary">
            {t("desktop.review.file.binary")}
          </span>
        </div>
      ) : (
        folded.shown.map((hunk) => (
          <HunkBlock
            key={hunk.hunkId}
            hunk={hunk}
            view={view}
            focused={hunk.hunkId === state.focusedHunkId}
          />
        ))
      )}
      {folded.hidden === 0 ? null : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            handlers.fileExpand(file.path);
          }}
        >
          {t("desktop.review.hunk.fold", { count: folded.hidden })}
        </Button>
      )}
    </section>
  );
}

function countLines(file: ReviewFile, kind: "add" | "del"): number {
  return file.hunks.reduce(
    (sum, hunk) => sum + hunk.lines.filter((line) => line.kind === kind).length,
    0,
  );
}

/** 줄 하나의 자리 이름. 줄 의견이 어느 줄에 붙는지 맞추는 데 쓴다 */
function lineKeyOf(line: ReviewLine): string {
  return `${line.side}:${String(line.number)}`;
}

/** 줄의 의견 단추 속성. 잠긴 동안에는 단추 자체를 그리지 않는다(`onComment`이 없으면 caustic이 단추를 그리지 않는다) */
function lineCommentOf(
  hunkId: string,
  row: DiffRow,
  handlers: ReviewHandlers,
): { readonly onComment: () => void; readonly commentLabel: string } {
  const line: ReviewLine = lineOfRow(row);
  return {
    onComment: () => {
      handlers.composeOpen(hunkId, line);
    },
    commentLabel: t("desktop.review.line.comment", { number: row.number }),
  };
}

/** 줄 묶음 하나. 줄 의견이 붙는 줄 뒤에서 나뉜다(`after`가 그 줄, null이면 묶음의 끝) */
interface Segment {
  readonly rows: readonly DiffRow[];
  readonly after: ReviewLine | null;
}

/** 쓰고 있는 의견(`ReviewState`의 composing) */
type Composing = NonNullable<ReviewState["composing"]>;

/** 줄 뒤에 붙는 것: 그 줄의 저장된 의견들과 쓰고 있는 칸 */
function LineNotes(props: {
  readonly after: ReviewLine;
  readonly comments: readonly ReviewComment[];
  readonly composing: Composing | null;
  readonly editable: boolean;
  readonly handlers: ReviewHandlers;
}): ReactNode {
  const { after, comments, composing, editable, handlers } = props;
  const key = lineKeyOf(after);
  const here = comments.filter(
    (comment) => comment.line !== null && lineKeyOf(comment.line) === key,
  );
  const composingHere =
    composing !== null && composing.line !== null && lineKeyOf(composing.line) === key;
  return (
    <>
      {here.map((comment) => (
        <CommentBox
          key={comment.key}
          comment={comment}
          editable={editable}
          onRemove={handlers.commentRemove}
        />
      ))}
      {composing === null || !composingHere ? null : (
        <Composer
          hunkId={composing.hunkId}
          line={composing.line}
          text={composing.text}
          editable={editable}
          handlers={handlers}
        />
      )}
    </>
  );
}

/** hunk 카드 하나: 머리(헤더 줄, 승인·거절·의견 단추), 줄, 줄 의견과 쓰는 칸. 집중한 hunk는 테두리로 표시한다 */
function HunkBlock(props: {
  readonly hunk: HunkView;
  readonly view: ReviewOpenView;
  readonly focused: boolean;
}): ReactNode {
  const { hunk, view, focused } = props;
  const { handlers, state } = view;
  const editable = !lockedOf(view);
  const decision = hunkDecisionOf(state.draft, hunk.hunkId);
  const comments = commentsOfHunk(state.draft, hunk.hunkId);
  const composing =
    state.composing !== null && state.composing.hunkId === hunk.hunkId ? state.composing : null;
  const rows = diffRowsOf(hunk);
  // 줄 번호가 hunk 안에 있는 의견만 그 줄 뒤에 붙인다. 없는 줄의 의견은 hunk의 끝에 둔다
  const rowKeys = new Set(rows.map((row) => lineKeyOf(lineOfRow(row))));
  const placed = (line: ReviewLine | null): line is ReviewLine =>
    line !== null && rowKeys.has(lineKeyOf(line));
  const anchors = new Set<string>();
  for (const comment of comments) if (placed(comment.line)) anchors.add(lineKeyOf(comment.line));
  if (composing !== null && placed(composing.line)) anchors.add(lineKeyOf(composing.line));
  const segments: Segment[] = [];
  let current: DiffRow[] = [];
  for (const row of rows) {
    current.push(row);
    const line = lineOfRow(row);
    if (anchors.has(lineKeyOf(line))) {
      segments.push({ rows: current, after: line });
      current = [];
    }
  }
  segments.push({ rows: current, after: null });
  const word = t(decisionIdOf(decision));
  return (
    <article
      data-hunk={hunk.hunkId}
      data-focused={focused || undefined}
      aria-label={`${hunk.header}, ${word}`}
      className={codeDiffVariants({
        variant: "outline",
        size: "md",
        className: focused ? "rounded-xl ring-1 ring-inset ring-border-default" : "rounded-xl",
      })}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-surface-raised py-1 ps-3 pe-1.5 font-ui">
        <h3 className="m-0 min-w-0 flex-1 truncate font-mono text-mono-sm font-normal text-text-secondary">
          {hunk.header}
        </h3>
        <span className="flex items-center gap-0.5">
          <Button
            size="xs"
            variant={decision === "approved" ? "soft" : "ghost"}
            aria-pressed={decision === "approved"}
            disabled={!editable}
            onClick={() => {
              handlers.hunkDecide(hunk.hunkId, "approved");
            }}
          >
            {t("desktop.review.hunk.approve")}
          </Button>
          <Button
            size="xs"
            variant={decision === "rejected" ? "soft" : "ghost"}
            aria-pressed={decision === "rejected"}
            disabled={!editable}
            onClick={() => {
              handlers.hunkDecide(hunk.hunkId, "rejected");
            }}
          >
            {t("desktop.review.hunk.reject")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!editable}
            onClick={() => {
              handlers.composeOpen(hunk.hunkId, null);
            }}
          >
            {t("desktop.review.hunk.comment")}
          </Button>
        </span>
      </div>
      {segments.map((segment) => (
        <Fragment key={segment.after === null ? "end" : lineKeyOf(segment.after)}>
          <Lines
            rows={segment.rows}
            hunkId={hunk.hunkId}
            dim={decision === "rejected"}
            editable={editable}
            handlers={handlers}
          />
          {segment.after === null ? null : (
            <LineNotes
              after={segment.after}
              comments={comments}
              composing={composing}
              editable={editable}
              handlers={handlers}
            />
          )}
        </Fragment>
      ))}
      {comments
        .filter((comment) => !placed(comment.line))
        .map((comment) => (
          <CommentBox
            key={comment.key}
            comment={comment}
            editable={editable}
            onRemove={handlers.commentRemove}
          />
        ))}
      {composing !== null && !placed(composing.line) ? (
        <Composer
          hunkId={hunk.hunkId}
          line={composing.line}
          text={composing.text}
          editable={editable}
          handlers={handlers}
        />
      ) : null}
    </article>
  );
}

/** 줄 묶음 하나. 줄 번호 열과 기호 열은 caustic `CodeDiffLine`이 그린다. 줄 몸통이 `pre`라 의견 칸은 밖에 둔다 */
function Lines(props: {
  readonly rows: readonly DiffRow[];
  readonly hunkId: string;
  readonly dim: boolean;
  readonly editable: boolean;
  readonly handlers: ReviewHandlers;
}): ReactNode {
  const { rows, hunkId, dim, editable, handlers } = props;
  if (rows.length === 0) return null;
  return (
    <pre className={`m-0 overflow-x-auto py-1 ${dim ? "opacity-55" : ""}`}>
      {rows.map((row, index) => (
        <CodeDiffLine
          key={`${String(row.number)}:${String(index)}`}
          kind={row.kind}
          number={row.number}
          {...(editable ? lineCommentOf(hunkId, row, handlers) : {})}
        >
          {row.text}
        </CodeDiffLine>
      ))}
    </pre>
  );
}

/** 저장된 의견 한 개: 글과 지우기. 줄 의견은 그 줄 바로 뒤에 놓여 줄 머리가 따로 없다 */
function CommentBox(props: {
  readonly comment: ReviewComment;
  readonly editable: boolean;
  readonly onRemove: (key: string) => void;
}): ReactNode {
  const { comment } = props;
  // 줄 번호 열(34px) + 기호 열(16px)만큼 들여 의견이 그 줄에 붙어 보이게 한다
  return (
    <div className="ms-12.5 me-3 my-1.5 grid gap-1.5 font-ui">
      <div className="flex min-w-0 items-start gap-2 rounded-lg bg-neutral-track px-2.5 py-1.5">
        <p className="m-0 min-w-0 flex-1 whitespace-pre-wrap text-ui-sm text-text-primary">
          {comment.body}
        </p>
        <Button
          size="xs"
          variant="ghost"
          disabled={!props.editable}
          onClick={() => {
            props.onRemove(comment.key);
          }}
        >
          {t("desktop.review.comment.remove")}
        </Button>
      </div>
    </div>
  );
}

/** 의견 쓰는 칸. 열리면 바로 쓸 수 있게 초점을 받는다. 줄 의견이면 그 줄 뒤에, hunk 의견이면 hunk 끝에 놓인다 */
function Composer(props: {
  readonly hunkId: string;
  readonly line: ReviewLine | null;
  readonly text: string;
  readonly editable: boolean;
  readonly handlers: ReviewHandlers;
}): ReactNode {
  const { hunkId, line, text, handlers } = props;
  const label =
    line === null
      ? t("desktop.review.comment.label")
      : t("desktop.review.comment.line.label", { number: line.number });
  const placeholder =
    line === null
      ? t("desktop.review.comment.placeholder")
      : t("desktop.review.comment.line.placeholder", { number: line.number });
  return (
    <div className="ms-12.5 me-3 my-1.5 grid gap-1.5 font-ui">
      <Textarea
        size="sm"
        rows={2}
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        maxLength={COMMENT_MAX}
        value={text}
        disabled={!props.editable}
        onChange={(event) => {
          handlers.composeChange(event.target.value);
        }}
      />
      <div className="flex justify-end gap-1">
        <Button
          size="xs"
          variant="ghost"
          disabled={!props.editable}
          onClick={handlers.composeCancel}
        >
          {t("desktop.review.comment.cancel")}
        </Button>
        <Button
          size="xs"
          variant="solid"
          disabled={!props.editable || text.trim() === ""}
          onClick={() => {
            handlers.composeSave(hunkId, line);
          }}
        >
          {t("desktop.review.comment.save")}
        </Button>
      </div>
    </div>
  );
}

/** 제출 줄: 집계, 막힌 이유, 남은 것 모두 승인, 검토 닫기(거부), 제출. 선이나 상자 없이 간격으로만 나눈다 */
function Footer(props: {
  readonly view: ReviewOpenView;
  readonly ready: boolean;
  readonly files: readonly ReviewFile[];
}): ReactNode {
  const { view, ready } = props;
  const hunkIds = hunkIdsOf(props.files);
  const tally = tallyOf(hunkIds, view.state.draft);
  const block = ready
    ? submitBlockOf({
        tally,
        approveRemaining: view.state.draft.approveRemaining,
        live: view.live,
        busy: lockedOf(view),
      })
    : null;
  const editable = !lockedOf(view);
  const actionsOpen = view.live && editable;
  return (
    <footer className="flex min-h-11 flex-none flex-wrap items-center gap-x-3 gap-y-1 py-1">
      {ready ? (
        <span className="text-ui-sm tabular-nums text-text-primary">
          {t("desktop.review.summary", {
            approved: tally.approved,
            rejected: tally.rejected,
            pending: tally.pending,
          })}
        </span>
      ) : null}
      {block === "pending" ? (
        <span className="text-ui-sm text-text-tertiary">
          {t("desktop.review.submit.pending", { count: tally.pending })}
        </span>
      ) : null}
      <InfoTip text={t("desktop.review.keys")} />
      <span aria-hidden className="flex-1" />
      <label className="flex items-center gap-2 text-ui-sm text-text-primary">
        <Checkbox
          size="sm"
          checked={view.state.draft.approveRemaining}
          disabled={!editable}
          onCheckedChange={(next) => {
            view.handlers.approveRemaining(next === true);
          }}
        />
        {t("desktop.review.approveRemaining")}
      </label>
      <Button size="sm" variant="ghost" disabled={!actionsOpen} onClick={view.handlers.deny}>
        {t("desktop.review.deny")}
      </Button>
      <Button
        size="sm"
        variant="solid"
        loading={view.busy}
        disabled={!ready || block !== null}
        onClick={view.handlers.submit}
      >
        {t("desktop.review.submit")}
      </Button>
      {view.busy ? (
        <span className="sr-only" role="status">
          {t("desktop.approvals.sendingStatus")}
        </span>
      ) : null}
    </footer>
  );
}
