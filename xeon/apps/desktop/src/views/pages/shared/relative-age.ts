// 시각을 상대 문장으로 바꾼다(spec §6.0: 시간 표시는 상대 시각이고 절대 시각은 `Tooltip`에 둔다).
// 문장은 메시지 id와 인자로 돌려주고, 그릴 때 `t()`로 만든다. 미래 시각이나 시계 어긋남은 "방금"으로 본다.

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
