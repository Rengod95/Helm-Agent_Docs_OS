// 확장을 가리키는 작은 부품들(§6.21 "확장 행은 모두 같은 부품" [gap:V-16]): 상태 점과 글, 층 mono 열, 표 className.
// wb-opus/parts/ext-bits.tsx에서 옮겼다(옛 언어: 글은 text-ui-dense, 상태 글과 점은 ext-table의 statusOf 한 곳에서). 이름(ExtName)은 wb-opus 데이터에 기대므로 여기 없다.
// caustic 빈틈: 상태 점 + 글 한 쌍(StatusDot)이 없다. Badge dot은 알약 면을 같이 그려 표 안에서 무겁다. 토큰으로 만든다.
import type { ReactNode } from "react";
import type { Extension } from "../_shell";
import { statusOf } from "./ext-table";
import { StatusDot } from "./parts";

export { statusOf } from "./ext-table";
export { StatusDot } from "./parts";
/** @deprecated 구역 제목은 PageSection(../_shell)으로. 옛 호출이 컴파일되게 _wb-c/parts의 SectionTitle을 다시 내보낸다. */
export { SectionTitle } from "./parts";

export function ExtStatus({ e, pending }: { e: Extension; pending?: boolean }) {
  if (pending === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-ui-dense text-text-secondary">
        <StatusDot tone="neutral" />
        다음 단계 경계에 적용
      </span>
    );
  const s = statusOf(e);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ui-dense text-text-secondary">
      <StatusDot tone={s.tone} />
      {s.text}
    </span>
  );
}

/** DP-31: 층은 짧은 mono 열. */
export function LayerCell({ children }: { children: ReactNode }) {
  return <span className="font-mono text-mono-sm text-text-tertiary">{children}</span>;
}

/** caustic Table을 DP-26에 맞춘다: ghost, 행 사이 선 없음, 머리 아래 선 없음. Table에 "선 없는" 변형이 없어 className으로 덮는다. */
export const PLAIN_TABLE =
  "rounded-none [&_[data-slot=table-cell]]:font-normal [&_[data-slot=table-cell]]:text-ui-dense [&_[data-slot=table-row]]:border-b-0 [&_[data-slot=table-heading]]:shadow-none [&_[data-slot=table-heading]]:bg-transparent [&_[data-slot=table-heading]:first-child]:ps-0 [&_[data-slot=table-cell]:first-child]:ps-0 [&_[data-slot=table-heading]:last-child]:pe-0 [&_[data-slot=table-cell]:last-child]:pe-0 [&_table]:min-w-0";
