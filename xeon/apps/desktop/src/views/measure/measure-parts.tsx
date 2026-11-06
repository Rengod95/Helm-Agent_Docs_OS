// 성능 측정 화면의 공용 부품: 구역 머리(시안 `SectionTitle`과 같은 굵은 글 한 줄, 오른쪽에 고르기나 기준 글을 둔다).
import type { ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";

/**
 * 구역 머리. 굵기와 글자색으로만 나누고 선을 긋지 않는다(DP-03). 화면의 구역은 `level` 2, 구역 안의 소제목은 3이다.
 * 설명 글은 정보 아이콘 뒤에 둔다(DP-58). `actions`는 머리 오른쪽에 놓는다.
 */
export function SectionTitle(props: {
  readonly title: string;
  readonly level?: 2 | 3;
  readonly info?: string | undefined;
  readonly actions?: ReactNode;
}): ReactNode {
  const Heading = props.level === 3 ? "h3" : "h2";
  return (
    <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <Heading className="m-0 min-w-0 text-ui-sm font-semibold text-text-primary">
          {props.title}
        </Heading>
        {props.info !== undefined && <InfoTip text={props.info} />}
      </div>
      {props.actions}
    </div>
  );
}
