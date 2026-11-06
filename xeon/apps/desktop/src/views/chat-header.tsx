import { t } from "@fresnel/client/i18n";
import { IconButton } from "@caustic/react";
import { PanelLeft } from "@caustic/react/icons";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import { useThread } from "../state/engine/index.ts";
import { useShell, useShellActions } from "../state/shell/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { ThreadRowMenu } from "./thread-row-menu.tsx";

// 대화 머리(시안 _chat-rt의 ChatHead): 고른 대화의 제목 한 줄과 ⋯ 메뉴(행 메뉴와 같은 메뉴, 명령과 대화 상자도 같다).
// 왼쪽 패널이 닫혀 있으면 맨 앞에 "시작 영역 열기" 단추를 둔다. 대화를 고르지 않았고 패널이 열려 있으면 아무것도 그리지 않는다.
// 머리 폭은 시안대로 가운데 46rem이다.

export function ChatHeader(): ReactNode {
  const id = useSelectedThreadId();
  if (id === null) return <HeadRow title={null} menu={null} />;
  return <ChatHeaderOf id={id} />;
}

function ChatHeaderOf(props: { readonly id: ThreadId }): ReactNode {
  const thread = useThread(props.id);
  if (thread === undefined) return <HeadRow title={null} menu={null} />;
  const title = thread.title ?? t("desktop.threads.untitled");
  return (
    <HeadRow
      title={
        <h1 title={title} className="m-0 min-w-0 truncate text-text-primary">
          {title}
        </h1>
      }
      menu={<ThreadRowMenu id={props.id} title={title} status={thread.status} />}
    />
  );
}

/** 머리 한 줄. title이 null이면 대화가 없는 머리라서, 패널이 열려 있으면 그리지 않는다 */
function HeadRow(props: { readonly title: ReactNode; readonly menu: ReactNode }): ReactNode {
  const startOpen = useShell((s) => s.startOpen);
  const actions = useShellActions();
  if (startOpen && props.title === null) return null;
  return (
    <header className="mx-auto grid w-full max-w-184 flex-none grid-cols-[minmax(0,1fr)] px-3">
      <div className="flex h-10 min-w-0 items-center gap-1">
        {startOpen ? null : (
          <IconButton
            size="sm"
            variant="ghost"
            label={t("desktop.shell.start.expand")}
            aria-expanded={false}
            className="-ms-1.5"
            onClick={() => {
              actions.setStartOpen(true);
            }}
          >
            <PanelLeft />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{props.title}</div>
        {props.menu}
      </div>
    </header>
  );
}
