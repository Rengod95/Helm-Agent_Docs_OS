import { Skeleton } from "@caustic/react";
import type { ReactNode } from "react";

// 설정 묶음 안의 공용 부품(P-11, P-12). 카드는 `settings/settings-section.tsx`의 SettingSection 하나이고(옛 PanelBlock은
// `body="plain"`으로 합쳤다), 정보 아이콘은 `craft/info-tip.tsx` 하나다.

/** 목록을 읽는 중의 자리(목업 SkeletonRows): 행 네 개의 모양만 그린다. 읽는 중 글은 이름으로만 남는다 */
export function ListSkeleton(props: { readonly label: string }): ReactNode {
  return (
    <div role="status" aria-busy="true" aria-label={props.label} className="grid gap-2 py-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton width={22} height={22} radius="md" />
          <Skeleton height={12} width={`${String(40 - i * 5)}%`} />
          <Skeleton height={12} width="4rem" />
        </div>
      ))}
    </div>
  );
}
