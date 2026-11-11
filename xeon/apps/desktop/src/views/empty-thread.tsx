import type { ThreadId } from "@fresnel/contracts/conversation";
import { useState, type ReactNode } from "react";
import { useOpenThread } from "../state/engine/index.ts";
import { NewThreadArt } from "./illustrations/index.tsx";
import { NewThreadWhere } from "./new-thread-where.tsx";

// 빈 새 대화 화면(DP-70). 선 그림 하나가 있고, 작업 폴더가 없으면 그 아래에 "어디서 작업할까요" 고르기가 온다.
// 폴더가 이미 정해진 대화는 그림만 둔다(폴더·연결은 입력창 위 맥락 줄이 말한다, DP-71).

export function EmptyThread(): ReactNode {
  const thread = useOpenThread();
  if (thread === undefined) return <EmptyArt picker={false} threadId={null} />;
  return <EmptyArt picker={thread.workspace === null} threadId={thread.threadId} />;
}

/** `threadId`가 바뀌면 "폴더 없이 시작"으로 접은 상태를 새로 시작한다 */
function EmptyArt(props: {
  readonly picker: boolean;
  readonly threadId: ThreadId | null;
}): ReactNode {
  return <EmptyBody key={props.threadId ?? "none"} picker={props.picker} />;
}

function EmptyBody(props: { readonly picker: boolean }): ReactNode {
  const [skipped, setSkipped] = useState(false);
  const showPicker = props.picker && !skipped;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-auto px-3 py-6 text-text-tertiary">
      <NewThreadArt />
      {showPicker ? (
        <NewThreadWhere
          onNoFolder={() => {
            setSkipped(true);
          }}
        />
      ) : null}
    </div>
  );
}
