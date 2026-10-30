import type { RunSkipReason, ScheduleEntry, SchedulePolicy } from "./types.ts";

// L2.schedule.spec 4.4.4. 놓친 실행은 1회만 따라잡는다(`once`). 순수 함수: 시계를 인자로 받는다.

export interface DuePlan {
  /** 실행할 기한. 없으면 실행하지 않는다 */
  readonly fire: { readonly dueAt: number; readonly missed: boolean } | null;
  /** 실행하지 않고 건너뛴 기한 요약 */
  readonly skipped: {
    readonly count: number;
    readonly firstDueAt: number;
    readonly reason: RunSkipReason;
  } | null;
  /** 처리한 뒤의 다음 기한. 반복하지 않는 항목은 null */
  readonly nextDueAt: number | null;
}

/**
 * `nextDueAt`부터 `everyMs` 간격으로 쌓인 기한을 한 번에 계산한다(반복문 없이, 오래 꺼져 있어도 비용이 같다).
 * - 가장 늦은 기한이 제때(`lateGraceMs` 안)이면 그것만 실행하고 앞선 기한은 모두 건너뛴다.
 * - 가장 늦은 기한도 놓쳤으면 `maxCatchUpMs` 안일 때만 그 하나를 `missed`로 실행하고 나머지는 건너뛴다.
 * - 가장 늦은 기한이 `maxCatchUpMs`보다 오래됐으면 모두 건너뛴다(`too_old`).
 * `everyMs`가 null이면 기한은 `nextDueAt` 하나다.
 */
export function planDue(
  nextDueAt: number,
  everyMs: number | null,
  now: number,
  policy: Pick<SchedulePolicy, "lateGraceMs" | "maxCatchUpMs">,
): DuePlan {
  if (nextDueAt > now) return { fire: null, skipped: null, nextDueAt };
  const behind = everyMs === null ? 0 : Math.floor((now - nextDueAt) / everyMs);
  const latest = nextDueAt + behind * (everyMs ?? 0);
  const following = everyMs === null ? null : latest + everyMs;
  const age = now - latest;
  if (age > policy.maxCatchUpMs) {
    return {
      fire: null,
      skipped: { count: behind + 1, firstDueAt: nextDueAt, reason: "too_old" },
      nextDueAt: following,
    };
  }
  return {
    fire: { dueAt: latest, missed: age > policy.lateGraceMs },
    skipped: behind === 0 ? null : { count: behind, firstDueAt: nextDueAt, reason: "missed" },
    nextDueAt: following,
  };
}

/** 항목의 기한 간격(ms). 반복하지 않으면 null */
export function everyMsOf(entry: ScheduleEntry): number | null {
  return entry.trigger.kind === "interval" ? entry.trigger.everySeconds * 1000 : null;
}
