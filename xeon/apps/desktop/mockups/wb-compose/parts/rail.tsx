// 가로 경계선: 머리와 캔버스 사이, 테스트 띠 아래. 레일(세로선)이 없는 옛 언어 목업이라 1px 선 하나와 양 끝 십자 표식만 긋는다.
// 선은 border-subtle 토큰, 표식은 선 격자(LineGridMark)의 것이다.
import { LineGridMark } from "../../_shell";

export function RailRule() {
  return (
    <div aria-hidden className="relative h-px flex-none bg-border-subtle">
      <LineGridMark x="start" />
      <LineGridMark x="end" />
    </div>
  );
}
