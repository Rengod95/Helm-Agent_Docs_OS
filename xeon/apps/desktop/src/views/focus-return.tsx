import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useRef, type ReactNode } from "react";
import { useApprovalIds, useThreadRunning } from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import {
  focusAfterApprovalChange,
  focusAfterTurnEnd,
  focusIsLost,
} from "./approval-focus-model.ts";
import { useCommands } from "./commands.ts";

// 키보드 초점 돌려주기(scD 1-1). 승인 카드에 답하면 카드가 사라지며 초점이 BODY로 떨어진다.
// 다음 대기 카드가 있으면 그 카드로, 없으면 입력창으로 보낸다. 턴이 끝났을 때 초점이 BODY면 입력창으로 보낸다.
// 사용자가 다른 곳에 초점을 둔 경우(BODY가 아님)는 건드리지 않는다.

/** 승인 카드의 초점 자리(카드 머리 root, tabIndex -1)로 초점을 준다. 카드가 화면에 없으면 아무 일도 없다 */
export function focusApprovalCard(id: EventId): void {
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="approval-card-item"]'),
  );
  const card = cards.find((element) => element.dataset.approvalId === id);
  card?.querySelector<HTMLElement>("[data-approval-kind]")?.focus();
}

function TurnEndFocus(props: { readonly threadId: ThreadId }): ReactNode {
  const commands = useCommands();
  const running = useThreadRunning(props.threadId);
  const was = useRef(running);
  useEffect(() => {
    const before = was.current;
    was.current = running;
    if (focusAfterTurnEnd(before, running, focusIsLost(document.activeElement))) {
      commands.requestComposer(null);
    }
  }, [running, commands]);
  return null;
}

export function FocusReturn(): ReactNode {
  const commands = useCommands();
  const ids = useApprovalIds();
  const selected = useSelectedThreadId();
  const prev = useRef(ids);
  useEffect(() => {
    const before = prev.current;
    prev.current = ids;
    const target = focusAfterApprovalChange(before, ids, focusIsLost(document.activeElement));
    if (target === null) return;
    if (target.kind === "card") focusApprovalCard(target.id);
    else if (selected !== null) commands.requestComposer(null);
  }, [ids, selected, commands]);
  return selected === null ? null : <TurnEndFocus threadId={selected} />;
}
