import { IconButton, Skeleton, Tooltip } from "@caustic/react";
import { Info } from "@caustic/react/icons";
import type { ReactNode } from "react";

// 설정 묶음 안의 공용 부품(P-11, P-12). 목업 `_settings/row.tsx`의 SettingSection 머리 줄과 같은 글 모양을 쓰고,
// 카드는 두지 않는다(바깥 설정 섹션이 카드다). 설명은 정보 아이콘 뒤에 둔다(목업의 Tooltip).

/** 묶음 머리: 글 제목 하나와 끝 동작. 목업 SettingSection의 머리 줄과 같다 */
export function PanelBlock(props: {
  readonly title: ReactNode;
  readonly end?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="grid gap-2">
      <div className="flex h-8 items-center gap-2">
        <h3 className="m-0 flex-1 text-ui-sm font-semibold text-text-secondary">{props.title}</h3>
        {props.end}
      </div>
      {props.children}
    </section>
  );
}

/** 설명 한 줄을 정보 아이콘 뒤에 둔다. 아이콘의 이름이 설명 글이라 스크린 리더가 그대로 읽는다 */
export function InfoTip(props: { readonly text: string }): ReactNode {
  return (
    <Tooltip content={props.text}>
      <IconButton size="xs" variant="ghost" label={props.text}>
        <Info />
      </IconButton>
    </Tooltip>
  );
}

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
