// 기록 스크롤이 바닥에 붙어 있는지 정한다. 순수 함수라 화면 밖에서 시험한다(virtual-list.tsx의 onScroll이 쓴다).
// 바닥에서 임계값 안쪽의 거리만 보면, 바닥에서 몇 픽셀만 위로 굴려도 "바닥"으로 남아 다음 그림에서 바닥으로 되돌아간다.
// 그래서 위치가 움직인 방향을 함께 본다. 위로 움직였으면 사용자가 올린 것이다.
// 내용이 줄어 브라우저가 위치를 끌어내린 것(clamp)은 사용자가 한 일이 아니다.

export type StickInput = {
  /** 직전 판정 결과 */
  readonly prevStuck: boolean;
  /** 직전에 잰 scrollTop. 아직 잰 적이 없으면 null이고 거리만 본다 */
  readonly prevTop: number | null;
  /** 직전에 잰 scrollHeight. 아직 잰 적이 없으면 null이고 거리만 본다 */
  readonly prevScrollHeight: number | null;
  readonly top: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** 바닥으로 칠 거리(px). 이보다 가까우면 바닥이다 */
  readonly threshold: number;
};

export function nextStuck(input: StickInput): boolean {
  const { prevStuck, prevTop, prevScrollHeight, top, scrollHeight, clientHeight, threshold } =
    input;
  const distance = scrollHeight - top - clientHeight;
  // 맨 아래에 닿아 있으면 언제나 바닥이다
  if (distance < 1) return true;
  // 비교할 직전 위치가 없으면 지금 거리만 본다
  if (prevTop === null || prevScrollHeight === null) return distance < threshold;
  // 사용자가 위로 올렸다. 내용이 줄어서 생긴 위치 이동은 여기서 빠진다
  if (top < prevTop && scrollHeight >= prevScrollHeight) return false;
  // 아래로 내려 임계값 안에 들어오면 다시 바닥에 붙는다
  if (top > prevTop) return distance < threshold;
  // 위치가 그대로면 직전 판정을 지킨다
  if (top === prevTop) return prevStuck;
  // 내용이 줄어 위치가 끌려 내려간 경우
  return distance < threshold;
}
