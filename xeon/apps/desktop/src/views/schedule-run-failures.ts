// 대화 없이 실패한 예약 실행의 알림을 상태줄 진행 중 묶음에 싣는 훅. 연결이 살아 있으면 알림 목록의 `threadless`를 읽고,
// 대화 없는 `notify.delivered`를 더한다. 지운 경계(대화 없는 알림 band)가 바뀌면 다시 그려서 지운 실패는 바로 빠진다.
// 판단은 `schedule-run-failures-model.ts`가 하고, 이 파일은 명령과 구독과 경계 구독만 맡는다.

import { useEffect, useState, useSyncExternalStore } from "react";
import { detach, rethrow } from "@fresnel/contracts";
import type { Notice } from "@fresnel/contracts/capabilities";
import { useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { clearedNotices } from "./notices-model.ts";
import { mergeScheduleFailures, scheduleFailuresShownOf } from "./schedule-run-failures-model.ts";

/** 상태줄 진행 중 묶음에 보일 대화 없는 예약 실패 알림(최신이 먼저, 지운 것은 뺀다) */
export function useScheduleRunFailures(): readonly Notice[] {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const cleared = useSyncExternalStore(
    clearedNotices.subscribe,
    clearedNotices.readThreadless,
    clearedNotices.readThreadless,
  );

  useEffect(() => {
    if (phase !== "live") return undefined;
    const read = async (): Promise<void> => {
      const listed = await commands.notices.list();
      if (!listed.ok) return;
      const threadless = listed.value.threadless ?? [];
      setNotices((now) => mergeScheduleFailures(now, threadless));
    };
    detach(read(), rethrow);
    return commands.notices.onDelivered((delivered) => {
      if (delivered.threadId !== null) return;
      setNotices((now) => mergeScheduleFailures(now, [delivered.notice]));
    });
  }, [commands, phase]);

  return scheduleFailuresShownOf(notices, cleared);
}
