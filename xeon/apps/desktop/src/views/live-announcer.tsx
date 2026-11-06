import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useApprovalMirror, useThreadRunning, useTurnFailure } from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import {
  approvalAnnouncement,
  newApprovalIds,
  turnAnnouncement,
  type Announcement,
} from "./announce-model.ts";

// 앱 수준 화면 낭독 안내 영역 하나(scD 1-2). 눈에는 안 보이고 `aria-live="polite"`다.
// 새 승인 요청과 턴 완료·실패를 한 줄씩 알린다. 상태 줄의 `role="status"`와는 별개다.

function textOf(announcement: Announcement): string {
  return announcement.params === undefined
    ? t(announcement.id)
    : t(announcement.id, announcement.params);
}

function TurnAnnouncer(props: {
  readonly threadId: ThreadId;
  readonly say: (text: string) => void;
}): ReactNode {
  const running = useThreadRunning(props.threadId);
  const failure = useTurnFailure(props.threadId);
  const was = useRef(running);
  const { say } = props;
  useEffect(() => {
    const before = was.current;
    was.current = running;
    const announcement = turnAnnouncement(before, running, failure);
    if (announcement !== null) say(textOf(announcement));
  }, [running, failure, say]);
  return null;
}

export function LiveAnnouncer(): ReactNode {
  const approvals = useApprovalMirror();
  const selected = useSelectedThreadId();
  const [message, setMessage] = useState({ text: "", count: 0 });
  const say = useCallback((text: string): void => {
    setMessage((prev) => ({ text, count: prev.count + 1 }));
  }, []);
  const seen = useRef(approvals.ids);
  useEffect(() => {
    const before = seen.current;
    seen.current = approvals.ids;
    const fresh = newApprovalIds(before, approvals.ids);
    const lines = fresh.flatMap((id) => {
      const approval = approvals.byId[id];
      return approval === undefined ? [] : [textOf(approvalAnnouncement(approval.request))];
    });
    if (lines.length > 0) say(lines.join(". "));
  }, [approvals, say]);
  // 같은 문장이 다시 오면 낭독기가 놓치지 않게 보이지 않는 글자를 번갈아 붙인다
  const text = message.count % 2 === 0 ? message.text : `${message.text}​`;
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-live-announcer="">
        {text}
      </div>
      {selected === null ? null : <TurnAnnouncer threadId={selected} say={say} />}
    </>
  );
}
