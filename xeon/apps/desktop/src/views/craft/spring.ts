// 용수철 이징: 이름표와 점이 자리에 앉을 때 쓴다. 감쇠 진동의 해를 CSS `linear()` 값으로 풀어 쓴다.
// 값을 지원하지 않는 곳은 호출하는 쪽이 `transition-timing-function`의 기본 곡선으로 대신한다.
const STIFFNESS = 300;
const DAMPING = 20;
const MASS = 1;
const POINTS = 32;
/** 앉는 데 걸리는 시간(초): 진폭이 0.3% 아래로 줄 때까지 */
const SETTLE = 0.62;

/** 앉는 시간(밀리초). CSS 지속 시간으로 쓴다 */
export const SPRING_MS: number = Math.round(SETTLE * 1000);

/** 단위 계단에 대한 부족 감쇠 용수철의 위치(0에서 시작해 1로 앉는다) */
export function springAt(t: number): number {
  const w0 = Math.sqrt(STIFFNESS / MASS);
  const zeta = DAMPING / (2 * Math.sqrt(STIFFNESS * MASS));
  if (zeta >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
}

/** 용수철 곡선의 CSS `linear()` 값. 끝점은 정확히 1이다 */
export function springLinear(): string {
  const pts: string[] = [];
  for (let i = 0; i <= POINTS; i += 1) pts.push(springAt((i / POINTS) * SETTLE).toFixed(3));
  pts[POINTS] = "1";
  return `linear(${pts.join(", ")})`;
}
