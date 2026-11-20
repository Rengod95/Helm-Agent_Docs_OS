import { assertNever } from "@fresnel/contracts";
import type { ItemId, ThreadId } from "@fresnel/contracts/conversation";
import { memo, type NamedExoticComponent, type ReactNode } from "react";
import { useOpenThreadId, useTranscriptShapes } from "../state/engine/index.ts";
import { CompactionDivider } from "./compaction-divider.tsx";
import { ActivityGroup } from "./convo/activity-group.tsx";
import { CardRow } from "./convo/cards.tsx";
import { CustomRow, ReplyRow, UserRow } from "./convo/message-rows.tsx";
import { ThinkingPending } from "./convo/thinking-block.tsx";
import { OrphanResultRow } from "./convo/tool-call-row.tsx";
import { DriveInputRow } from "./convo/drive-input-row.tsx";
import { LeadEnd, LeadHead, MarkerRow, TurnFoot } from "./convo/turn-rows.tsx";
import { transcriptRowsOf, type TranscriptRow } from "./transcript-rows.ts";

// 대화 목록의 한 줄(dzT2a 시안, L4 desktop-ux §16). 줄 모델(`transcript-rows.ts`)이 정한 줄 종류를 `views/convo/`의 부품으로 그린다.
// 틀(`RowFrame`)이 읽기 열(736px, 좌우 12px)과 줄 종류별 아래 여백을 정한다. Drive 구간 줄도 보통 줄과 같은 왼쪽 선에 선다(lcM6g: 레일 없음).
// 행 부품은 자기 id만 구독한다(FS-19). 목록 부품은 줄 배열만 바뀔 때 다시 그린다.

/** 줄 종류별 아래 여백(시안 1절): 같은 턴 안 블록 사이 8, 사용자 말 뒤 4(동작 줄 24가 그 위에 있다), 턴 발 줄 뒤 24 */
const ROW_PAD: Readonly<Record<TranscriptRow["kind"], string>> = {
  user: "pb-1",
  reply: "gap-2 pb-2",
  activity: "pb-1",
  card: "pb-3",
  result: "pb-1",
  custom: "pb-3",
  live: "pb-2",
  pending: "pb-2",
  compaction: "py-2",
  marker: "py-2",
  driveInput: "pb-3",
  leadHead: "pb-1",
  leadEnd: "pb-6",
  turnFoot: "pb-6",
};

function RowFrame(props: { readonly row: TranscriptRow; readonly children: ReactNode }): ReactNode {
  const { row } = props;
  return (
    <article
      className={`convo-row mx-auto grid w-full min-w-0 max-w-184 grid-cols-[minmax(0,1fr)] px-3 empty:hidden ${ROW_PAD[row.kind]}`}
      data-row-kind={row.kind}
    >
      {props.children}
    </article>
  );
}

function RowBody(props: {
  readonly threadId: ThreadId;
  readonly row: TranscriptRow;
  readonly unsentId: ItemId | null;
}): ReactNode {
  const { row, threadId } = props;
  switch (row.kind) {
    case "user":
      return (
        <UserRow
          threadId={threadId}
          id={row.id}
          prevId={row.prevId}
          unsent={row.id === props.unsentId}
        />
      );
    case "reply":
      return <ReplyRow id={row.id} blocks={row.blocks} />;
    case "live":
      return <ReplyRow id={row.id} blocks={null} />;
    case "pending":
      return <ThinkingPending />;
    case "activity":
      return <ActivityGroup threadId={threadId} entries={row.entries} />;
    case "card":
      return <CardRow threadId={threadId} itemId={row.itemId} call={row.call} />;
    case "result":
      return <OrphanResultRow id={row.id} />;
    case "custom":
      return <CustomRow id={row.id} />;
    case "compaction":
      return <CompactionDivider record={row.record} />;
    case "marker":
      return <MarkerRow marker={row.marker} />;
    case "driveInput":
      return <DriveInputRow input={row.input} />;
    case "leadHead":
      return <LeadHead threadId={threadId} leaseId={row.leaseId} />;
    case "leadEnd":
      return <LeadEnd threadId={threadId} leaseId={row.leaseId} />;
    case "turnFoot":
      return <TurnFoot threadId={threadId} turnId={row.turnId} replyId={row.replyId} />;
    default:
      return assertNever(row, "TranscriptRow");
  }
}

/** 목록의 한 줄. 가상 목록이 줄마다 부른다 */
export function TranscriptRowView(props: {
  readonly threadId: ThreadId;
  readonly row: TranscriptRow;
  readonly unsentId: ItemId | null;
}): ReactNode {
  return (
    <RowFrame row={props.row}>
      <RowBody threadId={props.threadId} row={props.row} unsentId={props.unsentId} />
    </RowFrame>
  );
}

/**
 * 확정 item 하나를 목록과 같은 줄들로 그린다(턴 발 줄은 빼고). 목록 밖에서 item 하나만 보일 때(시험, 미리보기) 쓴다.
 * item이 열린 대화의 확정 기록에 없거나 그리지 않는 item이면 아무것도 그리지 않는다.
 */
export const RecordedItem: NamedExoticComponent<{
  readonly id: ItemId;
  readonly unsent?: boolean;
}> = memo(function RecordedItem(props: {
  readonly id: ItemId;
  readonly unsent?: boolean;
}): ReactNode {
  const threadId = useOpenThreadId();
  const shape = useTranscriptShapes().find((s) => s.id === props.id);
  if (threadId === null || shape === undefined) return null;
  const rows = transcriptRowsOf({
    shapes: [shape],
    live: [],
    showLive: false,
    anchors: [],
    turns: [],
    markers: [],
    leads: [],
    running: true,
  });
  return (
    <>
      {rows.map((row) => (
        <TranscriptRowView
          key={row.key}
          threadId={threadId}
          row={row}
          unsentId={props.unsent === true ? props.id : null}
        />
      ))}
    </>
  );
});

/** 진행 중 item 하나의 줄(확정되면 같은 부품이 기록을 그린다) */
export const StreamingRow: NamedExoticComponent<{ readonly id: ItemId }> = memo(
  function StreamingRow(props: { readonly id: ItemId }): ReactNode {
    const threadId = useOpenThreadId();
    if (threadId === null) return null;
    const row: TranscriptRow = { kind: "live", key: props.id, id: props.id };
    return <TranscriptRowView threadId={threadId} row={row} unsentId={null} />;
  },
);
