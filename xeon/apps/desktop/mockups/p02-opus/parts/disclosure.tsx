// caustic 빈틈: 카드 안의 작은 접기 줄(승인 카드 "인자 (2)")에 맞는 부품이 없다. Accordion은 48px 머리라 카드 안에서 너무 크다.
// 네이티브 <details>를 caustic 토큰(ui-sm, text-secondary, 초점 고리 focus-ring)으로 꾸민다.
import type { ReactNode } from "react";
import { ChevronRight } from "../icons";

export function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group/disclosure">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-ui-sm text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-icon-sm transition-transform duration-quick group-open/disclosure:rotate-90"
        />
        {summary}
      </summary>
      <div className="pt-1.5 pl-[18px]">{children}</div>
    </details>
  );
}
