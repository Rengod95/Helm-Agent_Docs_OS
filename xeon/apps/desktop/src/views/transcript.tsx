import type { ItemId } from "@xeon/contracts/conversation";
import { useMemo, type ReactNode } from "react";
import {
  useOpenThreadId,
  useStreamingIds,
  useTranscriptItemIds,
  useTranscriptStatus,
  useTurnFailure,
} from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { RecordedItem, StreamingRow } from "./item-view.tsx";
import { VirtualList, type VirtualRow } from "./virtual-list.tsx";

// 목록 부품은 id 배열만 구독한다(FS-19). 델타는 id 배열 참조를 바꾸지 않으므로 이 부품은 다시 그려지지 않는다.

type Row = VirtualRow & { readonly id: ItemId; readonly live: boolean };

function Notice(props: { readonly children: ReactNode }): ReactNode {
  return <div className="notice">{props.children}</div>;
}

export function Transcript(): ReactNode {
  const status = useTranscriptStatus();
  const threadId = useOpenThreadId();
  const ids = useTranscriptItemIds();
  const live = useStreamingIds();
  const commands = useCommands();
  const failure = useTurnFailure(threadId);
  // 진행 중 item은 열린 thread의 것만 보인다
  const rows = useMemo<readonly Row[]>(
    () => [
      ...ids.map((id): Row => ({ key: id, id, live: false })),
      ...(status === "ready" ? live.map((id): Row => ({ key: `live:${id}`, id, live: true })) : []),
    ],
    [ids, live, status],
  );
  if (threadId === null) return <Notice>왼쪽에서 대화를 고르거나 새로 만드세요.</Notice>;
  if (status === "loading") return <Notice>대화를 읽는 중…</Notice>;
  if (status === "error") {
    return (
      <Notice>
        대화를 읽지 못했습니다.{" "}
        <button
          type="button"
          onClick={() => {
            commands.retryTranscript();
          }}
        >
          다시 읽기
        </button>
      </Notice>
    );
  }
  const failureNotice =
    failure === null ? null : (
      <div className="error" role="alert">
        응답을 만들지 못했습니다: {failure}
      </div>
    );
  if (rows.length === 0) {
    return (
      <>
        <Notice>아직 메시지가 없습니다.</Notice>
        {failureNotice}
      </>
    );
  }
  return (
    <>
      <VirtualList
        rows={rows}
        followTail
        renderRow={(row) =>
          row.live ? <StreamingRow id={row.id} /> : <RecordedItem id={row.id} />
        }
      />
      {failureNotice}
    </>
  );
}
