// 용수철 이징: 이름표·점이 자리에 앉을 때 쓴다. 감쇠 진동의 해를 CSS linear() 값으로 풀어 --wb5-spring에 넣는다.
// 값이 없는 브라우저는 mockup.css의 cubic-bezier가 대신한다. 움직임 줄이기에서는 CSS가 시간을 거의 0으로 둔다.
const STIFFNESS = 300;
const DAMPING = 20;
const MASS = 1;
const POINTS = 32;
/** 앉는 데 걸리는 시간(초): 진폭이 0.3% 아래로 줄 때까지 */
const SETTLE = 0.62;

/** 단위 계단에 대한 부족 감쇠 용수철의 위치(0에서 시작해 1로 앉는다) */
export function springAt(t: number): number {
  const w0 = Math.sqrt(STIFFNESS / MASS);
  const zeta = DAMPING / (2 * Math.sqrt(STIFFNESS * MASS));
  if (zeta >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
}

export function installSpring(): void {
  if (typeof CSS === "undefined" || !CSS.supports("transition-timing-function", "linear(0, 1)"))
    return;
  const pts: string[] = [];
  for (let i = 0; i <= POINTS; i += 1) pts.push(springAt((i / POINTS) * SETTLE).toFixed(3));
  pts[POINTS] = "1";
  const root = document.documentElement.style;
  root.setProperty("--wb5-spring", `linear(${pts.join(", ")})`);
  root.setProperty("--wb5-spring-t", `${Math.round(SETTLE * 1000)}ms`);
}
