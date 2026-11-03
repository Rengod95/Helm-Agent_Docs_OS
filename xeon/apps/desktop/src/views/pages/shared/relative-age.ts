// 시각을 상대 문장으로 바꾼다(spec §6.0: 시간 표시는 상대 시각이고 절대 시각은 `Tooltip`에 둔다).
// 문장은 메시지 id와 인자로 돌려주고, 그릴 때 `t()`로 만든다. 지난 시각과 시계 어긋남은 "방금"으로 본다.
// 앞으로의 시각(다음 실행)은 `dueAgeOf`가 본다: "곧", "N분 뒤", "14:20", "내일 09:00", 그 밖은 절대 시각이다.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type RelativeAge = {
  readonly id:
    | "desktop.common.age.justNow"
    | "desktop.common.age.minutes"
    | "desktop.common.age.hours"
    | "desktop.common.age.days";
  readonly args: { readonly count?: number };
};

export function relativeAgeOf(atMs: number, nowMs: number): RelativeAge {
  const elapsed = nowMs - atMs;
  if (elapsed < MINUTE) return { id: "desktop.common.age.justNow", args: {} };
  if (elapsed < HOUR) {
    return { id: "desktop.common.age.minutes", args: { count: Math.floor(elapsed / MINUTE) } };
  }
  if (elapsed < DAY) {
    return { id: "desktop.common.age.hours", args: { count: Math.floor(elapsed / HOUR) } };
  }
  return { id: "desktop.common.age.days", args: { count: Math.floor(elapsed / DAY) } };
}

export type DueAge = {
  readonly id:
    | "desktop.common.due.soon"
    | "desktop.common.due.inMinutes"
    | "desktop.common.due.at"
    | "desktop.common.due.tomorrow";
  readonly args: { readonly count?: number; readonly time?: string };
};

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

/** 지역 시각의 "HH:mm". 로케일과 무관하게 같은 글자를 쓴다 */
function clockOf(at: Date): string {
  return `${padTwo(at.getHours())}:${padTwo(at.getMinutes())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 다음 실행 시각을 앞으로의 상대 문장으로 바꾼다. 지났거나 1분 안이면 "곧", 1시간 안이면 "N분 뒤",
 * 같은 날이면 "HH:mm", 다음 날이면 "내일 HH:mm"이다. 그 밖은 `absolute`(화면이 만든 절대 시각)를 쓴다.
 */
export function dueAgeOf(dueMs: number, nowMs: number, absolute: string): DueAge {
  const ahead = dueMs - nowMs;
  if (ahead < MINUTE) return { id: "desktop.common.due.soon", args: {} };
  if (ahead < HOUR) {
    return { id: "desktop.common.due.inMinutes", args: { count: Math.floor(ahead / MINUTE) } };
  }
  const due = new Date(dueMs);
  const now = new Date(nowMs);
  if (sameDay(due, now)) return { id: "desktop.common.due.at", args: { time: clockOf(due) } };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(due, tomorrow)) {
    return { id: "desktop.common.due.tomorrow", args: { time: clockOf(due) } };
  }
  return { id: "desktop.common.due.at", args: { time: absolute } };
}
