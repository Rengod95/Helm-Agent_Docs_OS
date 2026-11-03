import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { HunkView } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  CodeDiff,
  CodeDiffComment,
  CodeDiffHunk,
  CodeDiffLine,
  EmptyState,
  List,
  ListRow,
  MessageCode,
  Skeleton,
  Table,
  Textarea,
  type CodeDiffDecision,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ApprovalFailure } from "../../../state/ui/index.ts";
import { APPROVAL_FAILURE_ID, REVIEW_CHANGE_ID } from "../../approval-form.ts";
import {
  COMMENT_MAX,
  diffRowsOf,
  type DiffRow,
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
  type HunkDecision,
  type ReviewComment,
  type ReviewKeyAction,
  type ReviewKeyEvent,
  type ReviewLine,
  type ReviewResultView,
  type ReviewState,
  type ReviewTally,
  type SetDecision,
  type SubmitBlock,
} from "../../review-model.ts";
import { decisionIdOf, methodIdOf, resultIdOf } from "./review-text.ts";

// 변경 검토 화면(P-04)의 그림. 상태와 동작은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// hunk와 파일의 승인·거절 단추는 caustic `CodeDiffHunk`·`CodeDiff`의 Accept·Reject 글자가 영어로 고정되어 있어 쓰지 않고, 같은 자리에 이 화면의 단추를 놓는다.
// 키보드는 루트 `section`이 받는다. 판정은 `reviewKeyOf`가 하고, 그림은 집중한 hunk를 표시하고 화면이 보이도록 옮길 뿐이다.

/** 화면이 연 검토 요청의 머리 */
interface ReviewHead {
  readonly title: string;
  readonly round: number;
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
  readonly approveAll: () => void;
  readonly deny: () => void;
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

const CAUSTIC_DECISION: Readonly<Record<HunkDecision, CodeDiffDecision>> = {
  pending: "pending",
  approved: "accepted",
  rejected: "rejected",
};

export function ReviewView(props: ReviewViewProps): ReactNode {
  const { open } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const focusedHunkId = open?.state.focusedHunkId ?? null;
  const keys =
    open === null || open.body.kind !== "ready"
      ? null
      : reviewKeyContextOf(open.body.files, open.state, {
          editable: !open.busy,
          submitOpen: submitOpenOf(hunkIdsOf(open.body.files), open.state.draft, {
            live: open.live,
            busy: open.busy,
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
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 outline-none"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={props.onBack}>
          {t("desktop.review.back")}
        </Button>
        <h1 id={headingId} className="min-w-0 flex-1 text-ui-strong text-text-primary">
          {open === null ? t("desktop.review.title") : open.head.title}
        </h1>
        {open === null ? null : (
          <Badge>{t("desktop.approvals.review.round", { round: open.head.round })}</Badge>
        )}
      </header>
      {open === null ? (
        props.result === undefined || props.result === null ? (
          <EmptyState
            size="sm"
            title={t("desktop.review.closed")}
            description={t("desktop.review.closed.hint")}
          />
        ) : (
          <ResultBox result={props.result} onClose={props.onBack} />
        )
      ) : (
        <OpenReview view={open} />
      )}
    </section>
  );
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
  return (
    <>
      {view.live ? null : (
        <Alert tone="warning" layout="inline">
          {t("desktop.review.offline")}
        </Alert>
      )}
      <BodyPane view={view} />
      {view.failure === undefined ? null : (
        <Alert tone="danger" layout="inline">
          {t(APPROVAL_FAILURE_ID[view.failure])}
          {view.failureDetail === undefined ? null : ` (${view.failureDetail})`}
        </Alert>
      )}
      <Footer view={view} ready={ready} files={files} />
    </>
  );
}

function BodyPane(props: { readonly view: ReviewOpenView }): ReactNode {
  const { view } = props;
  if (view.body.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="grid content-start gap-2">
        <span className="sr-only">{t("desktop.review.loading")}</span>
        {[0, 1, 2].map((line) => (
          <Skeleton key={line} height={44} />
        ))}
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
    return <EmptyState size="sm" title={t("desktop.review.empty")} />;
  }
  const selected = files.find((file) => file.path === view.state.selectedPath) ?? files[0];
  return (
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
      <FileList files={files} view={view} selectedPath={selected?.path ?? null} />
      {selected === undefined ? null : <FilePane file={selected} view={view} />}
    </div>
  );
}

function FileList(props: {
  readonly files: readonly ReviewFile[];
  readonly view: ReviewOpenView;
  readonly selectedPath: string | null;
}): ReactNode {
  const { files, view } = props;
  return (
    <List aria-label={t("desktop.approvals.review.files.label")}>
      {files.map((file) => {
        const tally = tallyOf(hunkIdsOf([file]), view.state.draft);
        const decided = tally.approved + tally.rejected;
        return (
          <ListRow
            key={file.path}
            title={file.path}
            description={[
              t(REVIEW_CHANGE_ID[file.change]),
              file.binary
                ? t("desktop.approvals.review.binary")
                : t("desktop.approvals.review.hunks", { count: file.hunks.length }),
            ].join(" · ")}
            end={<Badge>{`${String(decided)}/${String(tally.total)}`}</Badge>}
            aria-current={file.path === props.selectedPath ? "true" : undefined}
            onClick={() => {
              view.handlers.fileSelect(file.path);
            }}
          />
        );
      })}
    </List>
  );
}

function FilePane(props: { readonly file: ReviewFile; readonly view: ReviewOpenView }): ReactNode {
  const { file, view } = props;
  const { handlers, state } = view;
  const editable = !view.busy;
  const hunkIds = hunkIdsOf([file]);
  const tally = tallyOf(hunkIds, state.draft);
  const expanded = state.expanded.includes(file.path);
  const folded = foldedHunksOf(file.hunks, expanded);
  const composing = state.composing;
  const composingHunk =
    composing === null ? undefined : file.hunks.find((hunk) => hunk.hunkId === composing.hunkId);
  const allApproved = tally.total > 0 && tally.approved === tally.total;
  const allRejected = tally.total > 0 && tally.rejected === tally.total;
  return (
    <section aria-label={file.path} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {file.binary ? <MessageCode>{file.path}</MessageCode> : null}
        <span className="text-caption text-text-secondary">
          {t("desktop.review.summary", {
            approved: tally.approved,
            rejected: tally.rejected,
            pending: tally.pending,
          })}
        </span>
        <span aria-hidden className="flex-1" />
        {file.binary || hunkIds.length === 0 ? null : (
          <>
            <Button
              size="xs"
              variant={allApproved ? "solid" : "outline"}
              aria-pressed={allApproved}
              disabled={!editable}
              onClick={() => {
                handlers.fileDecide(hunkIds, "approved");
              }}
            >
              {t("desktop.review.file.approve")}
            </Button>
            <Button
              size="xs"
              variant={allRejected ? "solid" : "outline"}
              aria-pressed={allRejected}
              disabled={!editable}
              onClick={() => {
                handlers.fileDecide(hunkIds, "rejected");
              }}
            >
              {t("desktop.review.file.reject")}
            </Button>
          </>
        )}
      </div>
      {file.binary ? (
        <Alert tone="info" layout="inline">
          {t("desktop.review.file.binary")}
        </Alert>
      ) : (
        <CodeDiff
          aria-label={file.path}
          filename={file.path}
          added={countLines(file, "add")}
          removed={countLines(file, "del")}
          actions={false}
        >
          {folded.shown.map((hunk) => (
            <HunkBlock
              key={hunk.hunkId}
              hunk={hunk}
              view={view}
              focused={hunk.hunkId === state.focusedHunkId}
            />
          ))}
        </CodeDiff>
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
      {composingHunk === undefined || composing === null ? null : (
        <Composer
          key={
            composing.line === null
              ? composing.hunkId
              : `${composing.hunkId}:${composing.line.side}:${String(composing.line.number)}`
          }
          hunkId={composingHunk.hunkId}
          line={composing.line}
          text={composing.text}
          editable={editable}
          handlers={handlers}
        />
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

/** 한 hunk: 머리(헤더 줄, 결정 글자, 승인·거절·의견 단추), 줄, 의견 줄. 집중한 hunk는 테두리로 표시한다 */
function HunkBlock(props: {
  readonly hunk: HunkView;
  readonly view: ReviewOpenView;
  readonly focused: boolean;
}): ReactNode {
  const { hunk, view } = props;
  const { handlers, state } = view;
  const editable = !view.busy;
  const decision = hunkDecisionOf(state.draft, hunk.hunkId);
  const comments = commentsOfHunk(state.draft, hunk.hunkId);
  const rows = diffRowsOf(hunk);
  return (
    <CodeDiffHunk
      data-hunk={hunk.hunkId}
      data-focused={props.focused || undefined}
      className={props.focused ? "ring-1 ring-inset ring-border-default" : undefined}
      header={
        <span className="flex flex-wrap items-center gap-2">
          <span>{hunk.header}</span>
          <Badge>{t(decisionIdOf(decision))}</Badge>
          <Button
            size="xs"
            variant={decision === "approved" ? "solid" : "outline"}
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
            variant={decision === "rejected" ? "solid" : "outline"}
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
      }
      decision={CAUSTIC_DECISION[decision]}
      actions={false}
    >
      {rows.map((row, index) => (
        <CodeDiffLine
          key={`${String(row.number)}:${String(index)}`}
          kind={row.kind}
          number={row.number}
          {...(editable ? lineCommentOf(hunk.hunkId, row, handlers) : {})}
        >
          {row.text}
        </CodeDiffLine>
      ))}
      {comments.map((comment) => (
        <CommentLine
          key={comment.key}
          comment={comment}
          editable={editable}
          onRemove={handlers.commentRemove}
        />
      ))}
    </CodeDiffHunk>
  );
}

function CommentLine(props: {
  readonly comment: ReviewComment;
  readonly editable: boolean;
  readonly onRemove: (key: string) => void;
}): ReactNode {
  const { line, body } = props.comment;
  // 줄 머리와 글을 한 글 조각으로 그린다(조각이 둘이면 서버 렌더가 사이에 주석 표식을 넣는다)
  const text =
    line === null ? body : `${t("desktop.review.comment.line", { number: line.number })} ${body}`;
  return (
    <CodeDiffComment author={t("desktop.review.comment.author")}>
      {text}{" "}
      <Button
        size="xs"
        variant="ghost"
        disabled={!props.editable}
        onClick={() => {
          props.onRemove(props.comment.key);
        }}
      >
        {t("desktop.review.comment.remove")}
      </Button>
    </CodeDiffComment>
  );
}

/** 의견 입력 칸. `pre` 밖에 둔다(줄 상자는 글만 받는다). 열리면 바로 쓸 수 있게 초점을 받는다 */
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
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={label}
        placeholder={placeholder}
        autoFocus
        rows={3}
        maxLength={COMMENT_MAX}
        value={text}
        disabled={!props.editable}
        onChange={(event) => {
          handlers.composeChange(event.target.value);
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!props.editable || text.trim() === ""}
          onClick={() => {
            handlers.composeSave(hunkId, line);
          }}
        >
          {t("desktop.review.comment.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!props.editable}
          onClick={handlers.composeCancel}
        >
          {t("desktop.review.comment.cancel")}
        </Button>
      </div>
    </div>
  );
}

function submitBlockTextOf(block: SubmitBlock, tally: ReviewTally): ReactNode {
  switch (block) {
    case "offline":
      return t("desktop.offline.hint");
    case "pending":
      return t("desktop.review.submit.pending", { count: tally.pending });
    case "busy":
      return null;
    default:
      return assertNever(block, "SubmitBlock");
  }
}

/** 제출 줄: 집계, 막힌 이유, 남은 것 모두 승인, 모두 승인, 거부(검토 닫기), 제출 */
function Footer(props: {
  readonly view: ReviewOpenView;
  readonly ready: boolean;
  readonly files: readonly ReviewFile[];
}): ReactNode {
  const { view, ready } = props;
  const labelId = useId();
  const hunkIds = hunkIdsOf(props.files);
  const tally = tallyOf(hunkIds, view.state.draft);
  const block = ready
    ? submitBlockOf({
        tally,
        approveRemaining: view.state.draft.approveRemaining,
        live: view.live,
        busy: view.busy,
      })
    : null;
  const blockText = block === null ? null : submitBlockTextOf(block, tally);
  const actionsOpen = view.live && !view.busy;
  return (
    <footer className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
      {ready ? (
        <span className="text-caption text-text-secondary">
          {t("desktop.review.summary", {
            approved: tally.approved,
            rejected: tally.rejected,
            pending: tally.pending,
          })}
        </span>
      ) : null}
      <span className="text-caption text-text-tertiary">{t("desktop.review.keys")}</span>
      {blockText === null ? null : (
        <span className="text-caption text-text-secondary">{blockText}</span>
      )}
      <span aria-hidden className="flex-1" />
      <Checkbox
        aria-labelledby={labelId}
        checked={view.state.draft.approveRemaining}
        disabled={view.busy}
        onCheckedChange={(next) => {
          view.handlers.approveRemaining(next === true);
        }}
      />
      <span id={labelId} className="text-ui-sm text-text-secondary">
        {t("desktop.review.approveRemaining")}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={!actionsOpen}
        onClick={view.handlers.approveAll}
      >
        {t("desktop.approvals.review.approveAll.button")}
      </Button>
      <Button size="sm" variant="ghost" disabled={!actionsOpen} onClick={view.handlers.deny}>
        {t("desktop.review.deny")}
      </Button>
      <Button
        size="sm"
        loading={view.busy}
        disabled={!ready || block !== null}
        onClick={view.handlers.submit}
      >
        {t("desktop.review.submit")}
      </Button>
      {view.busy ? <span className="dim">{t("desktop.approvals.sendingStatus")}</span> : null}
    </footer>
  );
}
