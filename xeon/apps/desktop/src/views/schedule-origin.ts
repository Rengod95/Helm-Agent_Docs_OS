import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { useEffect, useState } from "react";
import { useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { listParamsOf, type RunRecord } from "./pages/schedules/schedule-model.ts";

// 예약이 시작한 대화의 머리 정보(제목과 순번). 목록과 실행 기록은 요청 결과라 거울에 넣지 않고 화면처럼 읽는다(FS-03).

/**
 * `schedule.runs`가 한 번에 주는 실행 수의 상한. 인자를 생략하면 호스트가 가장 새 20개만 준다(cap-schedule의 기본값).
 * 이보다 적게 왔을 때만 전체 기록을 본 것이라 순번을 안다. 꽉 찼으면 더 오래된 실행이 잘렸을 수 있다
 */
export const SCHEDULE_RUNS_WINDOW = 20;

/**
 * 이 대화가 그 예약의 몇 번째 실행인가(1부터). 대화 id가 있는 실행만 세고 시작 시각 오름차순으로 번호를 매긴다.
 * 대화가 기록에 없거나, 기록이 잘렸을 수 있으면(`SCHEDULE_RUNS_WINDOW`) null이다
 */
export function runOrdinalOf(runs: readonly RunRecord[], threadId: string): number | null {
  if (runs.length >= SCHEDULE_RUNS_WINDOW) return null;
  const started = runs
    .filter((run) => run.threadId !== null)
    .toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const index = started.findIndex((run) => run.threadId === threadId);
  return index < 0 ? null : index + 1;
}

/** 대화 머리에 보일 예약 정보. 모르는 값은 null이다 */
interface ScheduleOrigin {
  /** 예약 제목. 목록을 못 읽었거나 예약이 없으면 null */
  readonly title: string | null;
  /** 이 대화가 그 예약의 몇 번째 실행인가. 모르면 null */
  readonly ordinal: number | null;
}

const UNKNOWN: ScheduleOrigin = { title: null, ordinal: null };

/**
 * 예약이 시작한 대화의 머리 정보를 읽는다. 제목은 `schedule.list`(모두)에서, 순번은 `schedule.runs`에서 구한다.
 * 연결이 살아 있을 때 읽고, 대화 상태가 바뀌면 다시 읽는다(실행이 시작하거나 끝나면 실행 기록에 대화가 들어온다).
 * 목록을 못 읽었거나 예약이 없으면 둘 다 null이다.
 */
export function useScheduleOrigin(
  scheduleId: string,
  threadId: ThreadId,
  status: ThreadSummary["status"],
): ScheduleOrigin {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [origin, setOrigin] = useState<ScheduleOrigin>(UNKNOWN);
  useEffect(() => {
    if (!live) return undefined;
    // 이 효과가 끝났으면(연결이 끊기거나 대화 상태가 또 바뀌었으면) 늦게 온 응답은 버린다
    let current = true;
    const read = async (): Promise<void> => {
      const listed = await commands.schedule.list(listParamsOf("all"));
      const schedule = listed.ok
        ? listed.value.items.find((item) => item.entry.id === scheduleId)
        : undefined;
      if (schedule === undefined) {
        if (current) setOrigin(UNKNOWN);
        return;
      }
      const runs = await commands.schedule.runs(scheduleId);
      if (current) {
        setOrigin({
          title: schedule.entry.title,
          ordinal: runs.ok ? runOrdinalOf(runs.value.runs, threadId) : null,
        });
      }
    };
    detach(read(), rethrow);
    return () => {
      current = false;
    };
  }, [commands, live, scheduleId, threadId, status]);
  return origin;
}
