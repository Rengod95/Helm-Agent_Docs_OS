import { detach, rethrow } from "@fresnel/contracts";
import type { RunView, ScheduleListItem } from "@fresnel/contracts/capabilities";
import { useEffect, useState } from "react";
import { useLinkPhase, useThreadSummaries } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { listParamsOf, scheduleRunSignatureOf } from "./schedule-model.ts";

// 예약 내비 배지(P-07): 마지막 실행이 실패한 예약 수. 목록은 요청 결과라 거울에 넣지 않으므로 화면과 같이 `schedule.list`를 읽는다.
// 연결이 살아 있을 때 읽고, 예약 실행이 시작하거나 끝나면(`scheduleRunSignatureOf`가 바뀌면) 다시 읽는다.
// 연결이 끊기면 마지막 수를 두고, 목록을 못 읽으면 0이다(제안 배지와 같은 규칙).

/** 마지막 실행이 실패했는가. 화면의 실패 표식과 같은 규칙이다(`lastRunStatusOf`): 실패 상태이거나, 끝난 실행의 결과가 실패다 */
function isFailedRun(run: RunView): boolean {
  return run.status === "failed" || (run.status === "finished" && run.outcome === "failed");
}

/** 마지막 실행이 실패한 예약 수. 실행 기록이 없는 예약은 세지 않는다 */
export function failedScheduleCountOf(items: readonly ScheduleListItem[]): number {
  return items.filter((item) => item.lastRun !== null && isFailedRun(item.lastRun)).length;
}

/** 실패한 마지막 실행 수. 거르기는 모두다(끈 예약도 실패한 마지막 실행이 있으면 센다) */
export function useFailedScheduleCount(): number {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const runSignature = scheduleRunSignatureOf(useThreadSummaries());
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!live) return undefined;
    // 이 효과가 끝났으면(연결이 끊기거나 실행 상태가 또 바뀌었으면) 늦게 온 응답은 버린다
    let current = true;
    const read = async (): Promise<void> => {
      const listed = await commands.schedule.list(listParamsOf("all"));
      if (current) setCount(listed.ok ? failedScheduleCountOf(listed.value.items) : 0);
    };
    detach(read(), rethrow);
    return () => {
      current = false;
    };
  }, [commands, live, runSignature]);
  return count;
}
