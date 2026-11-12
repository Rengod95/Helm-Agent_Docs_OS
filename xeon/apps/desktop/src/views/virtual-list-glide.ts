// 따라 내려가기의 감쇠 보간(DP-106 [결정: 2026-11-11 사용자]). 순수 함수라 화면 밖에서 시험한다(virtual-list.tsx가 쓴다).
// 바닥에 붙어 있을 때 내용이 늘면 순간 이동하지 않고, 프레임마다 남은 거리의 일정 비율을 줄여 부드럽게 가라앉는다(넘치지 않는다).

/** 60Hz 한 프레임(16.7ms)에 줄이는 남은 거리의 비율. 시간 상수는 약 67ms이고 200px은 약 0.25초에 반 픽셀 안으로 닿는다 */
export const GLIDE_RATE = 0.22;

const FRAME_MS = 1000 / 60;

/** 남은 거리가 이보다 작으면 목표에 닿은 것으로 본다 */
const SNAP_PX = 0.5;

/** 한 걸음. `dtMs`가 길어도(느린 프레임) 같은 시간에 같은 만큼 줄어든다. 목표를 넘지 않는다 */
export function glideStep(current: number, target: number, dtMs: number): number {
  const gap = target - current;
  if (Math.abs(gap) < SNAP_PX) return target;
  const k = 1 - Math.pow(1 - GLIDE_RATE, Math.max(0, dtMs) / FRAME_MS);
  const next = current + gap * Math.min(1, k);
  return Math.abs(target - next) < SNAP_PX ? target : next;
}

/** 보간할지, 바로 바닥으로 갈지. 움직임을 줄이거나, 거리가 없거나, 한 화면보다 멀면 바로 간다 */
export function shouldGlide(input: {
  readonly distance: number;
  readonly viewportHeight: number;
  readonly reduced: boolean;
}): boolean {
  return !input.reduced && input.distance >= 1 && input.distance <= input.viewportHeight;
}
