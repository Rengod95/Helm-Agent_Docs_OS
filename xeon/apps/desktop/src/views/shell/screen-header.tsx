import { t } from "@fresnel/client/i18n";
import { IconButton } from "@caustic/react";
import { PanelLeft } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { useShell, useShellActions } from "../../state/shell/index.ts";

// 화면 머리 공용 부품. 대화 영역의 모든 화면(대화·제안·예약·연결·플러그인·받은 요청·시작 화면·설정)과
// 크래프트 목록 화면이 이 하나로 머리를 그린다.
// 자리: [펼치기(패널이 닫혔을 때만)] [앞 단추] 제목 [보조 줄] ··· [컨트롤] [주 동작]
// 높이는 `--shell-header-h`, 좌우 여백과 아래 구분선은 `.shell-header`가 가진다(오른쪽 막대 밑까지 뻗는다).
// 컨트롤 크기 단계는 하나다: Button md(32) · SegmentedControl sm(32) · Select md · IconButton md.
// 주 동작 단추는 solid가 아니라 `HEADER_PRIMARY_VARIANT`(outline)다 — segmented와 같은 톤.

/** 머리 안 컨트롤이 쓰는 크기. Button·IconButton·Select는 `md`, SegmentedControl은 `sm`(둘 다 32px) */
export const HEADER_CONTROL_SIZE = "md" as const;
export const HEADER_SEGMENTED_SIZE = "sm" as const;
/** Select(필드 높이 단계)는 `xs`가 control-md(32px)와 같다 */
export const HEADER_SELECT_SIZE = "xs" as const;
/** 머리 안 주 동작 단추의 variant */
export const HEADER_PRIMARY_VARIANT = "outline" as const;

/** 패널이 닫혀 있을 때만 그려지는 "시작 영역 열기" 단추. 머리 맨 왼쪽에 놓는다 */
export function PanelExpandButton(): ReactNode {
  const startOpen = useShell((s) => s.startOpen);
  const actions = useShellActions();
  if (startOpen) return null;
  return (
    <IconButton
      size={HEADER_CONTROL_SIZE}
      variant="ghost"
      label={t("desktop.shell.start.expand")}
      aria-expanded={false}
      className="-ms-1.5 flex-none"
      onClick={() => {
        actions.setStartOpen(true);
      }}
    >
      <PanelLeft />
    </IconButton>
  );
}

export interface ScreenHeaderProps {
  /** 제목. 문자열이면 h1(500 secondary)로 그린다 */
  readonly title: ReactNode;
  /** 제목 h1의 id(섹션 aria-labelledby용) */
  readonly titleId?: string;
  /** 설정 화면 제목: 문자열 h1에 `data-page-title`을 단다(type-scale.css가 20/28로 키운다) */
  readonly pageTitle?: boolean;
  /** 제목 앞 단추(뒤로 가기 등) */
  readonly lead?: ReactNode;
  /** 제목 바로 뒤의 흐린 보조 글(순번·대화 이름 등) */
  readonly meta?: ReactNode;
  /** 가운데~오른쪽 보조 컨트롤(segmented·select 등) */
  readonly controls?: ReactNode;
  /** 맨 오른쪽 주 동작 단추 */
  readonly action?: ReactNode;
  /** true면 머리를 그리지 않는다(패널이 열린 빈 대화 머리처럼) */
  readonly hidden?: boolean;
}

export function ScreenHeader(props: ScreenHeaderProps): ReactNode {
  if (props.hidden === true) return null;
  return (
    <header className="shell-header flex flex-none items-center gap-2">
      <PanelExpandButton />
      {props.lead}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {typeof props.title === "string" ? (
          <h1
            id={props.titleId}
            data-page-title={props.pageTitle === true ? "" : undefined}
            title={props.title}
            className="m-0 min-w-0 truncate font-medium text-text-secondary"
          >
            {props.title}
          </h1>
        ) : (
          props.title
        )}
        {props.meta}
      </div>
      {props.controls === undefined ? null : (
        <div className="flex min-w-0 flex-none items-center gap-2">{props.controls}</div>
      )}
      {props.action}
    </header>
  );
}
