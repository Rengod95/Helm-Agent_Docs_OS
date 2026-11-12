import { CircleAlert, TriangleAlert } from "@caustic/react/icons";
import type { ReactNode } from "react";

// 오류·안내 상태 한 벌(L4.desktop-ux DP-102 [결정: 2026-11-11 사용자]). 문장과 단추를 한 줄에 이어 붙이지 않는다.
// - `ProblemState`: 화면이나 구역 자리를 차지하는 오류(대화를 읽지 못함 등). 가운데 360px 열에 아이콘 20, 제목 15/600, 원인 13 secondary,
//   단추 줄(주 동작 outline sm + 보조 ghost sm). 위:아래 여백 2:3.
// - `ProblemLine`: 다른 것 위아래에 끼는 한 줄(신뢰 상태를 못 읽음, 보내기 실패 등). 아이콘 14(위험·경고 색) + 13 secondary 문장,
//   끝에 작은 단추 하나(있을 때만). 진행을 막지 않는 안내라 카드나 강한 배경을 쓰지 않는다.

export type ProblemTone = "danger" | "warning";

const ICON_TONE: Readonly<Record<ProblemTone, string>> = {
  danger: "text-danger-text",
  warning: "text-warning-text",
};

export function ProblemState(props: {
  readonly title: string;
  /** 원인과 고치는 법(한두 문장). 없으면 생략한다 */
  readonly cause?: string | null | undefined;
  /** 단추 줄. 주 동작이 앞이다 */
  readonly actions?: ReactNode;
  readonly tone?: ProblemTone | undefined;
}): ReactNode {
  const tone = props.tone ?? "danger";
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div
        role="alert"
        data-problem-state=""
        className="m-auto flex w-full max-w-90 flex-col items-center gap-2 px-3 pt-8 pb-12 text-center"
      >
        {tone === "danger" ? (
          <CircleAlert aria-hidden className={`size-5 ${ICON_TONE[tone]}`} />
        ) : (
          <TriangleAlert aria-hidden className={`size-5 ${ICON_TONE[tone]}`} />
        )}
        <h2 className="m-0 mt-1 text-title-3 text-text-primary">{props.title}</h2>
        {props.cause === null || props.cause === undefined ? null : (
          <p className="m-0 text-ui text-text-secondary">{props.cause}</p>
        )}
        {props.actions === undefined ? null : (
          <div className="mt-2 flex items-center justify-center gap-2">{props.actions}</div>
        )}
      </div>
    </div>
  );
}

export function ProblemLine(props: {
  readonly children: ReactNode;
  readonly tone?: ProblemTone | undefined;
  /** 끝에 붙는 작은 단추(xs). 없으면 문장만 */
  readonly action?: ReactNode;
  /** 알림 방식. 오류는 alert, 진행 안내는 status */
  readonly role?: "alert" | "status" | "note" | undefined;
  readonly className?: string | undefined;
}): ReactNode {
  const tone = props.tone ?? "danger";
  return (
    <div
      role={props.role ?? "alert"}
      data-problem-line={tone}
      className={`flex min-h-7 min-w-0 items-center gap-2 px-1 text-ui text-text-secondary ${props.className ?? ""}`}
    >
      {tone === "danger" ? (
        <CircleAlert aria-hidden className={`size-3.5 shrink-0 ${ICON_TONE[tone]}`} />
      ) : (
        <TriangleAlert aria-hidden className={`size-3.5 shrink-0 ${ICON_TONE[tone]}`} />
      )}
      <span className="min-w-0 flex-1">{props.children}</span>
      {props.action === undefined ? null : <span className="shrink-0">{props.action}</span>}
    </div>
  );
}
