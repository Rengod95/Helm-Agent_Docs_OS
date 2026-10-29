// caustic 빈틈: Message streaming은 aria-busy만 주고 "작성 중" 커서를 그리지 않는다(caustic 문서 예제도 앱이 직접 그림).
// 글은 caustic의 에이전트 진행 표식(shimmer 유틸리티)으로, 끝에 깜빡이는 커서를 붙인다. 커서는 text-secondary 막대이고
// prefers-reduced-motion이면 멈춘다. 에이전트가 쓰는 중일 때만 쓴다(FOUNDATION 정책 2: 빛은 에이전트).
export function StreamingText({ text, live }: { text: string; live: boolean }) {
  return (
    <>
      <span className={live ? "shimmer" : undefined}>{text}</span>
      {live && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1.1em] w-0.5 translate-y-[0.2em] rounded-full bg-text-secondary animate-[caret-blink_1.06s_steps(1,end)_infinite] motion-reduce:animate-none"
        />
      )}
    </>
  );
}
