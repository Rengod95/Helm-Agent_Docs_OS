import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { useThread } from "../state/engine/index.ts";
import { useShell } from "../state/shell/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useScheduleOrigin } from "./schedule-origin.ts";
import { scheduleOriginTextOf } from "./schedule-origin-model.ts";
import { ScreenHeader } from "./shell/screen-header.tsx";
import { ThreadRowMenu } from "./thread-row-menu.tsx";

// 대화 머리(시안 _chat-rt의 ChatHead): 고른 대화의 제목 한 줄과 ⋯ 메뉴(행 메뉴와 같은 메뉴, 명령과 대화 상자도 같다).
// 왼쪽 패널이 닫혀 있으면 맨 앞에 "시작 영역 열기" 단추를 둔다. 대화를 고르지 않았고 패널이 열려 있으면 아무것도 그리지 않는다.
// 머리는 대화 열이 아니라 내용 영역 전체 폭이다(`.shell-header`: 오른쪽 막대 밑까지, 좌우 여백은 머리가 가진다). 제목은 왼쪽, 높이는 사이드 패널 머리와 같은 `--shell-header-h`, 아래에 border-subtle 선.

export function ChatHeader(): ReactNode {
  const id = useSelectedThreadId();
  if (id === null) return <HeadRow title={null} menu={null} />;
  return <ChatHeaderOf id={id} />;
}

function ChatHeaderOf(props: { readonly id: ThreadId }): ReactNode {
  const thread = useThread(props.id);
  if (thread === undefined) return <HeadRow title={null} menu={null} />;
  const title = thread.title ?? t("desktop.threads.untitled");
  const origin = thread.origin;
  return (
    <HeadRow
      title={
        <>
          <h1 title={title} className="m-0 min-w-0 truncate font-medium text-text-secondary">
            {title}
          </h1>
          {/* 예약이 시작한 대화는 제목 뒤에 흐린 예약 줄을 한 줄로 붙인다 */}
          {origin?.kind === "schedule" ? (
            <ScheduleOriginLine
              key={props.id}
              threadId={props.id}
              scheduleId={origin.scheduleId}
              status={thread.status}
            />
          ) : null}
        </>
      }
      menu={<ThreadRowMenu id={props.id} title={title} status={thread.status} />}
    />
  );
}

/** 예약 줄. 제목과 순번을 아직 모르면 "예약"만 보인다. 대화가 바뀌면 key로 새로 읽는다 */
function ScheduleOriginLine(props: {
  readonly threadId: ThreadId;
  readonly scheduleId: string;
  readonly status: ThreadSummary["status"];
}): ReactNode {
  const origin = useScheduleOrigin(props.scheduleId, props.threadId, props.status);
  const text = scheduleOriginTextOf(origin.title, origin.ordinal);
  return (
    <span title={text} className="min-w-0 truncate text-ui-sm text-text-tertiary">
      {text}
    </span>
  );
}

/** 머리 한 줄. title이 null이면 대화가 없는 머리라서, 패널이 열려 있으면 그리지 않는다 */
function HeadRow(props: { readonly title: ReactNode; readonly menu: ReactNode }): ReactNode {
  const startOpen = useShell((s) => s.startOpen);
  return (
    // 대화 기록 스크롤 영역(VirtualList)이 안쪽 위 여백을 이미 가져서 머리에 공용 간격을 더하지 않는다
    <ScreenHeader
      hidden={startOpen && props.title === null}
      flush
      title={props.title}
      action={props.menu}
    />
  );
}
