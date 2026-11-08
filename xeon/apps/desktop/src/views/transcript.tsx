import { Button } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { useMemo, type ReactNode } from "react";
import {
  useCompactionAnchors,
  useAwaitingFirstResponse,
  useOpenThreadId,
  useLastUserItemId,
  useStreamingIds,
  useTranscriptItemIds,
  useTranscriptFailure,
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
import { RecordedItem, StreamingRow } from "./item-view.tsx";
import { ThinkingIndicator } from "./thinking-indicator.tsx";
import { CompactionDivider } from "./compaction-divider.tsx";
import { VirtualList } from "./virtual-list.tsx";
import { transcriptRowsOf, type TranscriptRow } from "./transcript-rows.ts";

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

export function Transcript(): ReactNode {
  const status = useTranscriptStatus();
  const failureReason = useTranscriptFailure();
  const threadId = useOpenThreadId();
  const ids = useTranscriptItemIds();
  const live = useStreamingIds();
  const awaiting = useAwaitingFirstResponse();
  const commands = useCommands();
  const failure = useTurnFailure(threadId);
  const unsentId = useUnsentUserItemId();
  const lastUserId = useLastUserItemId();
  const truncated = useTranscriptTruncated();
  const anchors = useCompactionAnchors(threadId);
  // 진행 중 item은 열린 thread의 것만 보인다. 요약 구분선은 자리 item 뒤에 선다(transcript-rows.ts)
  const rows = useMemo<readonly TranscriptRow[]>(
    () => transcriptRowsOf({ ids, live, showLive: status === "ready", anchors }),
    [anchors, ids, live, status],
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
  const failureNotice =
    failure === null ? null : <TurnFailureRow threadId={threadId} error={failure} />;
  // 앞부분 답이 온 뒤 끊긴 응답이면 마지막 답 바로 뒤에 끊김을 표시한다. 자동으로 다시 보내지는 않는다
  const cutNotice =
    failure !== null && turnFailureOf(failure).kind === "interrupted" ? <CutMarker /> : null;
  // 첫 응답을 기다리는 동안(마지막으로 그려지는 item이 내 말이고 진행 중인 글이 아직 없다) 큰 생각 표시를 보인다
  const waiting =
    awaiting && live.length === 0 ? (
      <div
        role="status"
        className="mx-auto flex w-full max-w-184 items-center gap-2 px-3 py-2 text-ui text-text-secondary"
      >
        <ThinkingIndicator active size={24} />
        {t("desktop.item.thinkingWait")}
      </div>
    ) : null;
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
      <VirtualList
        rows={rows}
        followTail
        ownTailKey={lastUserId}
        label={t("desktop.transcript.label")}
        renderRow={(row) =>
          row.kind === "compaction" ? (
            <CompactionDivider record={row.record} />
          ) : row.live ? (
            <StreamingRow id={row.id} />
          ) : (
            <RecordedItem id={row.id} unsent={row.id === unsentId} />
          )
        }
      />
      {waiting}
      {cutNotice}
      {failureNotice}
      <ResumeBand />
    </>
  );
}
