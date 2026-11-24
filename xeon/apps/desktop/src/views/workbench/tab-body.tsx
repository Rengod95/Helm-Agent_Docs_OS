// P-17 탭의 바깥 상태 그림: 읽는 중(`Skeleton`), 오프라인(한 줄), 오류(한 줄), 마지막 값(연결이 끊겼을 때 "마지막으로 읽은 값" 글 아래에 그대로).
// 값이 있을 때의 그림은 `render`가 그린다. 상태의 뜻은 `tabReadOf`(@fresnel/client/workbench)가 정한다.
import { t } from "@fresnel/client/i18n";
import type { TabRead } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import { Alert, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";

/** 보조 글(빈 문장, 상태 한 줄)의 자리 */
export const MUTED = "m-0 text-ui text-text-tertiary";

/**
 * 탭 안 표: 선 없는 ghost 표(wb-opus `PLAIN_TABLE`과 같은 덮개). Table에 선 없는 변형이 없어 className으로 덮는다.
 * 행 사이 선과 머리 바탕을 걷고, 바깥 칸의 안쪽 여백을 걷어 본문 왼쪽 선에 맞춘다.
 */
export const PLAIN_TABLE =
  "rounded-none [&_[data-slot=table-cell]]:font-normal [&_[data-slot=table-cell]]:text-ui [&_[data-slot=table-row]]:border-b-0 [&_[data-slot=table-heading]]:shadow-none [&_[data-slot=table-heading]]:bg-transparent [&_[data-slot=table-heading]:first-child]:ps-0 [&_[data-slot=table-cell]:first-child]:ps-0 [&_[data-slot=table-heading]:last-child]:pe-0 [&_[data-slot=table-cell]:last-child]:pe-0 [&_table]:min-w-0";

export function TabBody<T>(props: {
  readonly read: TabRead<T>;
  readonly render: (value: T) => ReactNode;
}): ReactNode {
  const { read } = props;
  switch (read.kind) {
    case "loading":
      return <Skeleton height={24} />;
    case "offline":
      return <p className={MUTED}>{t("desktop.workbench.detail.offline")}</p>;
    case "error":
      return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
    case "ready":
      return (
        <div className="grid gap-2">
          {read.stale && <p className={MUTED}>{t("desktop.workbench.detail.stale")}</p>}
          {props.render(read.value)}
        </div>
      );
    default:
      return assertNever(read, "TabRead");
  }
}

/**
 * 두 단(plugTab): 서로 이어진 구역을 한 탭 안에 나란히 둔다. 상세 칸이 48rem 미만이면(`@[48rem]/detail`) 한 단으로 접혀 왼쪽 단이 먼저 온다.
 * 두 단 사이와 구역 사이 간격은 토큰 눈금(`gap-8`, plugSize에서 글자를 키우며 `gap-6`에서 한 단계 올림)이다. 칸은 `@container/detail`인 상세 글(`ext-detail.tsx`)의 안에서만 나뉜다
 */
export function TwoColumns(props: {
  readonly start: ReactNode;
  readonly end: ReactNode;
}): ReactNode {
  return (
    <div className="grid gap-8 @[48rem]/detail:grid-cols-2 @[48rem]/detail:items-start">
      <div className="grid min-w-0 content-start gap-8">{props.start}</div>
      <div className="grid min-w-0 content-start gap-8">{props.end}</div>
    </div>
  );
}

/**
 * 단 머리(plugTab, plugSize): 상세의 구역 제목은 모두 제목 2(15/21, 600, 잉크)다. 권한과 화면과 설정 탭의 구역 제목(`addon-parts`의 h2)과 같고,
 * 본문(13)보다 위, 상세 머리의 이름(제목 겹침 17)보다 아래다. 오른쪽 끝 칸(`end`)은 단추 하나처럼 머리와 세로 가운데로 선다
 */
export function ColumnHead(props: { readonly title: string; readonly end?: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-control-sm items-center justify-between gap-2">
      <h3 className="m-0 text-title-2 text-text-primary">{props.title}</h3>
      {props.end}
    </div>
  );
}
