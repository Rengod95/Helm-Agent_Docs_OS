// 가로 경계선: 머리와 캔버스 사이, 테스트 띠 아래. 레일(세로선)이 없는 옛 언어 목업이라 1px 선 하나만 긋는다.
// 선은 border-subtle 토큰. 영역 양 끝까지 닿아 가장자리에 걸치는 십자 표식은 두지 않는다(선이 끝에서 곧게 끊긴다).
export function RailRule() {
  return <div aria-hidden className="h-px flex-none bg-border-subtle" />;
}
