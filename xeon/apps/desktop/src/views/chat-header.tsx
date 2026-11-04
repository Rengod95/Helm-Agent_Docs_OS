import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import { useThread } from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { ThreadRowMenu } from "./thread-row-menu.tsx";

// 대화 머리(d01-chat-gaps). 고른 대화의 제목 한 줄과 행 메뉴와 같은 ⋯ 메뉴다. 메뉴의 명령과 대화 상자는 행과 같은 것을 쓴다.
// 대화를 고르지 않았거나 목록에 없으면 아무것도 그리지 않는다.

export function ChatHeader(): ReactNode {
  const id = useSelectedThreadId();
  if (id === null) return null;
  return <ChatHeaderOf id={id} />;
}

function ChatHeaderOf(props: { readonly id: ThreadId }): ReactNode {
  const thread = useThread(props.id);
  if (thread === undefined) return null;
  const title = thread.title ?? t("desktop.threads.untitled");
  return (
    <header className="chat-header">
      <h1>{title}</h1>
      <ThreadRowMenu id={props.id} title={title} status={thread.status} />
    </header>
  );
}
