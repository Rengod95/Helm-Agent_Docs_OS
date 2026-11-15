import { Button } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ItemId, ThreadId } from "@fresnel/contracts/conversation";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playRowEnter, useScreenEnter } from "../lib/motion-presets.tsx";
import {
  useCompactionAnchors,
  useAwaitingFirstResponse,
  useConvoMarkers,
  useLeadSegments,
  useOpenThreadId,
  useOpenThreadRunning,
  useLastUserItemId,
  useStreamingIds,
  useTranscriptShapes,
  useTranscriptFailure,
  useTurnSummaries,
  useTranscriptStatus,
  useTranscriptTruncated,
  useTurnFailure,
  useUnsentUserItemId,
} from "../state/engine/index.ts";
import { MAX_SNAPSHOT_ITEMS } from "../state/engine/thread-reader.ts";
import { useCommands } from "./commands.ts";
import { CutMarker, TurnFailureRow } from "./turn-failure-row.tsx";
import { turnFailureOf } from "./turn-failure-model.ts";
import { EmptyThread } from "./empty-thread.tsx";
import { ResumeBand } from "./resume-band.tsx";
import { VirtualList } from "./virtual-list.tsx";
import { transcriptRowsOf, type TranscriptRow } from "./transcript-rows.ts";
import { TranscriptRowView } from "./item-view.tsx";
import {
  countsAsMessage,
  enteringKeysOf,
  lostUserRow,
  rowEnterOf,
  settledOf,
} from "./transcript-enter.ts";

// 목록 부품은 id 배열만 구독한다(FS-19). 델타는 id 배열 참조를 바꾸지 않으므로 이 부품은 다시 그려지지 않는다.

function Notice(props: { readonly children: ReactNode }): ReactNode {
  return <div className="notice">{props.children}</div>;
}

/** 대화를 읽지 못한 이유별 한 줄 */
const TRANSCRIPT_FAILURE_ID: Readonly<
  Record<"unavailable" | "failed" | "timeout" | "stale", MessageId>
> = {
  unavailable: "desktop.transcript.loadFailed.unavailable",
  failed: "desktop.transcript.loadFailed.failed",
  timeout: "desktop.transcript.loadFailed.timeout",
  stale: "desktop.transcript.loadFailed.stale",
};

/**
 * 새로 생긴 줄에만 들어옴을 건다(dzM2 시안 §2). 대화를 처음 그린 커밋의 줄과, 가상 목록이 다시 마운트한 줄은 돌지 않는다.
 * 알려진 키는 커밋 뒤(layout 효과)에 더한다. 행의 ref 콜백(자식)이 이 효과(부모)보다 먼저 불려 이번 커밋의 새 줄을 본다
 */
function useRowEnter(
  threadId: ThreadId,
  rows: readonly TranscriptRow[],
  live: readonly ItemId[],
): (row: TranscriptRow, el: HTMLElement) => void {
  // 이전 커밋의 줄과 진행 중 id에서 이번 들어옴을 정한다(React "이전 렌더의 정보 저장" 꼴: 바뀐 렌더에서 상태를 고쳐 바로 다시 그린다)
  const [book, setBook] = useState<RowBook | null>(null);
  let current = book;
  if (current === null || current.thread !== threadId || current.rows !== rows) {
    current = nextRowBook(book, threadId, rows, live);
    setBook(current);
  }
  const { entering } = current;
  // 들어옴은 키마다 한 번, 줄이 생긴 커밋 무렵에만 돈다. 화면 밖에 생겼다가 나중에 굴려 들어온 줄,
  // 위로 굴렸다 돌아와 다시 마운트된 줄은 들어옴 없이 바로 보인다(같은 `entering`이 다음 커밋까지 남아 있어도)
  const stamp = useRef<{ readonly set: ReadonlySet<string>; readonly at: number } | null>(null);
  const played = useRef<{ set: ReadonlySet<string>; keys: Set<string> }>({
    set: entering,
    keys: new Set(),
  });
  useLayoutEffect(() => {
    stamp.current = { set: entering, at: performance.now() };
  }, [entering]);
  return useCallback(
    (row: TranscriptRow, el: HTMLElement) => {
      if (!entering.has(row.key)) return;
      if (played.current.set !== entering) played.current = { set: entering, keys: new Set() };
      if (played.current.keys.has(row.key)) return;
      played.current.keys.add(row.key);
      const committed = stamp.current;
      if (committed?.set === entering && performance.now() - committed.at > ENTER_WINDOW_MS) return;
      const frame = el.firstElementChild;
      if (frame !== null) playRowEnter(frame, rowEnterOf(row.kind));
    },
    [entering],
  );
}

/** 줄이 생긴 커밋 뒤 이만큼 안에 마운트돼야 들어옴이 돈다(가상 목록이 잰 뒤 한 번 더 그리는 틈) */
const ENTER_WINDOW_MS = 300;

type RowBook = {
  readonly thread: ThreadId;
  readonly rows: readonly TranscriptRow[];
  readonly live: readonly ItemId[];
  /** 이번 줄 이전까지 이 대화에서 그린 적 있는 키. 처음 그림이면 null */
  readonly known: ReadonlySet<string> | null;
  readonly entering: ReadonlySet<string>;
};

function nextRowBook(
  book: RowBook | null,
  thread: ThreadId,
  rows: readonly TranscriptRow[],
  live: readonly ItemId[],
): RowBook {
  const same = book !== null && book.thread === thread ? book : null;
  const known =
    same === null ? null : new Set([...(same.known ?? []), ...same.rows.map((row) => row.key)]);
  const entering = enteringKeysOf({ rows, known, settled: settledOf(same?.live ?? [], live) });
  return { thread, rows, live, known, entering };
}

/** 되감기로 사용자 말 줄이 사라질 때마다 1씩 는다. 목록 전체를 화면 전환으로 다시 들인다 */
function useHistoryEpoch(rows: readonly TranscriptRow[]): number {
  const [seen, setSeen] = useState({ rows, epoch: 0 });
  if (seen.rows === rows) return seen.epoch;
  const next = { rows, epoch: seen.epoch + (lostUserRow(seen.rows, rows) ? 1 : 0) };
  setSeen(next);
  return next.epoch;
}

/** 열린 대화의 줄 목록. 줄 모델(`transcript-rows.ts`)이 턴·묶음·표지·주도 구간을 엮는다 */
function ThreadRows(props: { readonly threadId: ThreadId }): ReactNode {
  const { threadId } = props;
  const status = useTranscriptStatus();
  const shapes = useTranscriptShapes();
  const live = useStreamingIds();
  const anchors = useCompactionAnchors(threadId);
  const turns = useTurnSummaries(threadId);
  const markers = useConvoMarkers(threadId);
  const leads = useLeadSegments(threadId);
  const running = useOpenThreadRunning();
  const awaiting = useAwaitingFirstResponse();
  const failure = useTurnFailure(threadId);
  const unsentId = useUnsentUserItemId();
  const lastUserId = useLastUserItemId();
  const truncated = useTranscriptTruncated();
  const rows = useMemo<readonly TranscriptRow[]>(
    () =>
      transcriptRowsOf({
        shapes,
        live,
        showLive: status === "ready",
        anchors,
        turns,
        markers,
        leads,
        running,
        awaiting,
      }),
    [anchors, awaiting, leads, live, markers, running, shapes, status, turns],
  );
  const onRowMount = useRowEnter(threadId, rows, live);
  const epoch = useHistoryEpoch(rows);
  const rewound = useScreenEnter<HTMLDivElement>(String(epoch));
  const failureNotice =
    failure === null ? null : <TurnFailureRow threadId={threadId} error={failure} />;
  // 앞부분 답이 온 뒤 끊긴 응답이면 마지막 답 바로 뒤에 끊김을 표시한다. 자동으로 다시 보내지는 않는다
  const cutNotice =
    failure !== null && turnFailureOf(failure).kind === "interrupted" ? <CutMarker /> : null;
  if (rows.length === 0) {
    return (
      <>
        <EmptyThread />
        {failureNotice}
        <ResumeBand />
      </>
    );
  }
  return (
    <>
      {truncated ? (
        <div className="truncated-note">
          {t("desktop.transcript.truncated", { count: MAX_SNAPSHOT_ITEMS })}
        </div>
      ) : null}
      <div ref={rewound} className="flex min-h-0 flex-1 flex-col">
        <VirtualList
          rows={rows}
          followTail
          ownTailKey={lastUserId}
          label={t("desktop.transcript.label")}
          countRow={countsAsMessage}
          onRowMount={onRowMount}
          renderRow={(row) => (
            <TranscriptRowView threadId={threadId} row={row} unsentId={unsentId} />
          )}
        />
      </div>
      {cutNotice}
      {failureNotice}
      <ResumeBand />
    </>
  );
}

export function Transcript(): ReactNode {
  const status = useTranscriptStatus();
  const failureReason = useTranscriptFailure();
  const threadId = useOpenThreadId();
  const commands = useCommands();
  // 대화를 바꾸면(갈라내기 포함) 줄 목록 전체가 화면 전환 한 번으로 들어온다. 줄 하나하나는 움직이지 않는다.
  // 읽는 동안(null)은 세지 않아, 읽기를 거쳐 바뀐 대화도 들어온다
  const box = useScreenEnter<HTMLDivElement>(
    status === "ready" && threadId !== null ? threadId : null,
  );
  if (threadId === null) return <Notice>{t("desktop.transcript.pickThread")}</Notice>;
  if (status === "loading") return <Notice>{t("desktop.transcript.loading")}</Notice>;
  if (status === "error") {
    return (
      <Notice>
        {t("desktop.transcript.loadFailed")}{" "}
        {failureReason === null ? null : `${t(TRANSCRIPT_FAILURE_ID[failureReason])} `}
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            commands.retryTranscript();
          }}
        >
          {t("desktop.transcript.reloadButton")}
        </Button>
      </Notice>
    );
  }
  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      <ThreadRows threadId={threadId} />
    </div>
  );
}
