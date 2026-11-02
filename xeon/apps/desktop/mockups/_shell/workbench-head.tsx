// 크래프트 화면 머리(§6.21). 대화 머리(p02-opus StageHead)와 같은 한 줄 h-10: (사이드바가 닫혔을 때만) 열기, 제목 h1, 제목 옆 메타, 오른쪽 동작.
// 둘째 줄(sub)은 요약과 "언제 기준인가"(throughSeq·시각)를 연한 글자로. 선이나 띠 없이 간격으로만 나눈다(DP-03, DP-05).
// "보기 기준 <이름>"은 왼쪽 패널의 기준 칸이 안 보일 때(패널 닫힘)만 머리 오른쪽에 둔다. 같은 값을 두 곳에 그리지 않는다(DP-23과 같은 이유).
// 누르면 패널이 열리고 기준 칸에 초점이 간다(§6.21). 고정이면 자물쇠 아이콘을 앞에 둔다.
import { IconButton } from "@caustic/react";
import type { ReactNode } from "react";
import { Lock, PanelLeft } from "./icons";
import { contextName } from "./start-panel";
import { useShell } from "./state";
import { L } from "./i18n";
import { BAR_INSET } from "./page";
import { T } from "./terms";

/** 크래프트 가운데 읽기 폭. 표가 있어 대화(46rem)보다 넓다. 좌우 여백은 한 번만(DP-07). */
export const WB_WIDTH = "mx-auto w-full max-w-[60rem] px-3";

export interface WorkbenchHeadProps {
  title: ReactNode;
  /** 제목 옆 연한 메타(층·종류·등급·버전 등). */
  meta?: ReactNode;
  /** 오른쪽 동작(버튼 둘까지 권장). */
  actions?: ReactNode;
  /** 둘째 줄 요약. */
  sub?: ReactNode;
  className?: string;
}

export function WorkbenchHead({
  title,
  meta,
  actions,
  sub,
  className = WB_WIDTH,
}: WorkbenchHeadProps) {
  const m = useShell();
  const c = m.context;
  const kindWord =
    c.kind === "all"
      ? ""
      : `${c.kind === "thread" ? T.contextThread : c.kind === "profile" ? T.contextProfile : T.contextTrial} `;
  const openPicker = () => {
    m.setStartOpen(true);
    window.setTimeout(
      () =>
        document.querySelector<HTMLElement>(`[aria-label="${T.context}"]`)?.focus({
          preventScroll: true,
        }),
      50,
    );
  };
  return (
    <header className={`${className} grid flex-none`}>
      <div className={`flex h-10 min-w-0 items-center gap-1 ${BAR_INSET}`}>
        {!m.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label={L("사이드바 열기")}
            aria-expanded={false}
            onClick={() => m.setStartOpen(true)}
            className="-ms-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">{title}</h1>
          {meta !== undefined && (
            <span className="min-w-0 truncate text-ui-sm text-text-tertiary">{meta}</span>
          )}
        </div>
        {!m.startOpen && (
          <button
            type="button"
            onClick={openPicker}
            aria-label={`${T.context} ${kindWord}${contextName(c)}${
              c.kind === "thread" && c.pinned ? `, ${T.pin}` : ""
            }. 누르면 ${T.context} 칸을 열어요`}
            className="inline-flex min-w-0 max-w-[45%] shrink items-center gap-1 rounded-sm text-ui-sm text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring"
          >
            {c.kind === "thread" && c.pinned && (
              <Lock aria-hidden emphasis="muted" className="size-icon-xs shrink-0" />
            )}
            <span className="truncate">
              {T.context} · {kindWord}
              {contextName(c)}
            </span>
          </button>
        )}
        {actions !== undefined && (
          <div className="flex flex-none items-center gap-1">{actions}</div>
        )}
      </div>
      {sub !== undefined && (
        <div className="-mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 pb-2 text-ui-dense text-text-tertiary">
          {sub}
        </div>
      )}
    </header>
  );
}
