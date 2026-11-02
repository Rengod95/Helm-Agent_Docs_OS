// 페이지 머리·구역·간격(크래프트 선 격자 페이지용, 옛 디자인 언어). 가운데 내용의 제목은 이 부품을 거쳐 caustic SectionHeader로 그린다.
// 손으로 만든 h1/h2 + 설명 조합, 페이지 로컬 Section/H/Sec는 쓰지 않는다.
//   <PageHead title="확장" description="한 줄" action={<Button/>} />
//   <PageBody>
//     <PageSection title="켜진 확장" action={<Button variant="outline"/>}>…</PageSection>
//     <PageSection title="꺼진 확장">…</PageSection>
//   </PageBody>
// 크기는 caustic SectionHeader 단계(lg=페이지 제목, md=구역, sm=묶음)를 그대로 쓴다. 레일·링 그림자는 쓰지 않는다.
import { Alert, cn, IconButton, SectionHeader, type AlertProps } from "@caustic/react";
import { useId, type ReactNode } from "react";
import { L } from "./i18n";
import { PanelLeft } from "./icons";
import { useShell } from "./state";

/** 페이지 바깥 여백 24. */
export const PAGE_PAD = "p-6";
/** 선 격자 띠가 있는 페이지의 바깥 여백: 세로만 24, 가로 0. 띠(LineGridFrame)가 내용 영역 양 끝까지 닿고, 머리·표 밖 구역은 GRID_INSET으로 칸 글자와 줄을 맞춘다. */
export const PAGE_PAD_GRID = "py-6";
/** 페이지 머리와 첫 구역 사이 24. PageHead 아래(머리를 감싼 부모의 gap 또는 pb-6)에 쓴다. */
export const PAGE_HEAD_GAP = "gap-6";
/** 가운데 구역과 구역 사이 32. PageBody 기본값. */
export const SECTION_GAP = "gap-8";
/** 오른쪽 well 안 구역 사이 24. PageBody well. */
export const WELL_SECTION_GAP = "gap-6";
/** 구역 제목과 내용 사이 12. PageSection 안. */
export const HEAD_GAP = "gap-3";
/** 내용 요소(행·카드) 사이 8. */
export const ITEM_GAP = "gap-2";

export interface PageHeadProps {
  title: ReactNode;
  /** 제목 아래 한 줄(muted). 없으면 비운다. */
  description?: ReactNode | undefined;
  /** 오른쪽 동작 하나(Button, SegmentedControl 등). 여럿이면 감싸서 하나로. */
  action?: ReactNode | undefined;
  /** 제목 옆 연한 한 단어(버전·종류 등). 꼭 필요할 때만. */
  meta?: ReactNode | undefined;
  className?: string | undefined;
}

/** 페이지 제목 h1(text-title-1 24/32/600) + 설명 한 줄(text-body, muted) + 동작 하나. */
export function PageHead({ title, description, action, meta, className }: PageHeadProps) {
  return (
    <SectionHeader
      size="lg"
      headingLevel={1}
      title={
        meta === undefined ? (
          title
        ) : (
          <>
            {title}
            <span className="ms-2.5 text-body text-text-tertiary">{meta}</span>
          </>
        )
      }
      description={description}
      action={action}
      className={cn("items-center", className)}
    />
  );
}

export interface PageSectionProps {
  title: ReactNode;
  /** 제목 아래 한 줄. 사용법·범례 설명은 넣지 않는다. */
  description?: ReactNode | undefined;
  /** 오른쪽 동작 하나. 개수를 꼭 보일 때는 연한 숫자 하나. */
  action?: ReactNode | undefined;
  /** section = 가운데 구역 h2(text-title-2 18/26/600). group = well·카드·밀도 영역 h3(text-title-3 15/22 600). */
  level?: "section" | "group" | undefined;
  /** 긴 목록에서 머리를 위에 붙인다(바탕 bg-app). */
  stickyHead?: boolean | undefined;
  /** 내용이 선 격자 띠(LineGridFrame)라 구역에 가로 여백이 없을 때: 머리만 이 안쪽 여백(칸 글자와 같은 GRID_INSET 값)을 받는다. */
  headInset?: string | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

/** 구역: <section> + SectionHeader + 내용(제목과 내용 사이 12). 내용 요소 사이 간격은 children 쪽(ITEM_GAP)이 정한다. */
export function PageSection({
  title,
  description,
  action,
  level = "section",
  stickyHead = false,
  headInset,
  className,
  children,
}: PageSectionProps) {
  const id = useId();
  const group = level === "group";
  return (
    <section aria-labelledby={id} className={cn("grid min-w-0", HEAD_GAP, className)}>
      <SectionHeader
        size={group ? "sm" : "md"}
        headingLevel={group ? 3 : 2}
        title={<span id={id}>{title}</span>}
        description={description}
        action={action}
        className={cn("items-center", headInset, stickyHead && "sticky top-0 z-[5] bg-bg-app py-1")}
      />
      {children}
    </section>
  );
}

/** 구역 묶음: 구역 사이 32(가운데) 또는 24(well). */
export function PageBody({
  well = false,
  className,
  children,
}: {
  well?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn("grid min-w-0 content-start", well ? WELL_SECTION_GAP : SECTION_GAP, className)}
    >
      {children}
    </div>
  );
}

export interface StageHeadProps extends PageHeadProps {
  /** 머리 감싸개(<header>)의 className. 읽기 폭(READ_WIDTH 등)이나 좌우 여백을 준다. 아래 24(pb-6)는 StageHead가 준다. */
  headerClassName?: string | undefined;
}

/** 크래프트가 아닌 전체 페이지(받은 요청·제안 등)의 머리: 왼쪽 패널이 닫혀 있으면 사이드바 열기 + PageHead + 아래 24. */
export function StageHead({ headerClassName, className, ...head }: StageHeadProps) {
  const shell = useShell();
  return (
    <header className={cn("flex flex-none items-start gap-1 pt-2 pb-6", headerClassName)}>
      {!shell.startOpen && (
        <IconButton
          size="sm"
          variant="ghost"
          label={L("사이드바 열기")}
          aria-expanded={false}
          onClick={() => shell.setStartOpen(true)}
          className="-ms-1.5 mt-0.5"
        >
          <PanelLeft />
        </IconButton>
      )}
      <PageHead {...head} className={cn("min-w-0 flex-1", className)} />
    </header>
  );
}

/** 정보 상자: caustic Alert tone neutral · variant soft. 나머지 props는 Alert 그대로. */
export function SoftAlert({ className, ...props }: Omit<AlertProps, "tone" | "variant">) {
  return <Alert tone="neutral" variant="soft" className={className} {...props} />;
}
