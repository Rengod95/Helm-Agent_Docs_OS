// 크래프트 화면 머리는 공용 셸의 WorkbenchHead(§6.21: 한 줄 + "언제 기준인가" 둘째 줄, 맥락은 왼쪽 패널이 닫혔을 때만 머리에).
// 여기서는 구역 이름(SectionTitle)만 더한다.
import type { ReactNode } from "react";
import { WB_WIDTH, WorkbenchHead } from "../../_shell";

export { WB_WIDTH };

export function ScreenHead({
  title,
  asOf,
  actions,
}: {
  title: string;
  asOf?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <WorkbenchHead
      title={title}
      {...(asOf !== undefined ? { sub: asOf } : {})}
      {...(actions !== undefined ? { actions } : {})}
    />
  );
}

/** 표 위 구역 이름(h2). 굵기와 글자색 단계로만 구분하고 선을 긋지 않는다(DP-03). */
export function SectionTitle({
  children,
  meta,
  id,
}: {
  children: ReactNode;
  meta?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 px-2 pb-1">
      <h2 id={id} className="m-0 text-ui-sm font-semibold text-text-primary">
        {children}
      </h2>
      {meta !== undefined && (
        <span className="min-w-0 truncate text-ui-xs text-text-tertiary tabular-nums">{meta}</span>
      )}
    </div>
  );
}
