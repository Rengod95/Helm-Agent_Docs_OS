import { Button } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ItemId } from "@fresnel/contracts/conversation";
import { useMemo, type ReactNode } from "react";
import {
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
import { TurnFailureRow } from "./turn-failure-row.tsx";
import { EmptyThread } from "./empty-thread.tsx";
import { ResumeBand } from "./resume-band.tsx";
import { RecordedItem, StreamingRow } from "./item-view.tsx";
import { VirtualList, type VirtualRow } from "./virtual-list.tsx";

// 목록 부품은 id 배열만 구독한다(FS-19). 델타는 id 배열 참조를 바꾸지 않으므로 이 부품은 다시 그려지지 않는다.

type Row = VirtualRow & { readonly id: ItemId; readonly live: boolean };

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
  const commands = useCommands();
  const failure = useTurnFailure(threadId);
  const unsentId = useUnsentUserItemId();
  const lastUserId = useLastUserItemId();
  const truncated = useTranscriptTruncated();
  // 진행 중 item은 열린 thread의 것만 보인다
  const rows = useMemo<readonly Row[]>(
    () => [
      ...ids.map((id): Row => ({ key: id, id, live: false })),
      ...(status === "ready" ? live.map((id): Row => ({ key: `live:${id}`, id, live: true })) : []),
    ],
    [ids, live, status],
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
          row.live ? (
            <StreamingRow id={row.id} />
          ) : (
            <RecordedItem id={row.id} unsent={row.id === unsentId} />
          )
        }
      />
      {failureNotice}
      <ResumeBand />
    </>
  );
}
