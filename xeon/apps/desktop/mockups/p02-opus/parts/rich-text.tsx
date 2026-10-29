// caustic 빈틈 C-06(Markdown 렌더): caustic에는 Markdown 렌더러가 없다. 목업은 백틱 인라인 코드만 <code>로 바꾼다.
// 스타일은 caustic 토큰(mono 글꼴, neutral-well 바탕, xs 모서리)만 쓴다. MessageCode는 일부러 쓰지 않는다(브리프 지시).
import type { ReactNode } from "react";

export function RichText({ text }: { text: string }): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code
        key={i}
        className="rounded-xs bg-neutral-well px-1 py-px font-mono text-mono-sm text-text-primary not-italic"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
