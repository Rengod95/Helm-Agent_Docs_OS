import type { ReactNode } from "react";
import type { StatusDot } from "../../status-cell.tsx";

// 상태 띠(DP-87 [결정: 2026-11-11 사용자]). 구역 맨 위에서 "지금 어떤 상태이고 무엇을 하면 되는지"를 한 덩어리로 보인다:
// 왼쪽 상태 점(8) + 제목(13/500) + 설명(13 tertiary), 오른쪽 끝 동작(sm 단추). 아래 `result`는 동작의 결과 한 줄이다.
// 알림 권한, 업데이트처럼 "상태 + 고치는 동작 + 시험 결과"가 한 묶음인 곳에서 같은 모양으로 쓴다. 카드(`SettingSection`) 안에 둔다.

const DOT: Readonly<Record<StatusDot, string>> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

export interface StatusBandProps {
  readonly tone: StatusDot;
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  /** 오른쪽 끝 동작. 같은 크기(sm) 단추만 */
  readonly actions?: ReactNode | undefined;
  /** 동작의 결과 한 줄. 없으면 그리지 않는다 */
  readonly result?: ReactNode | undefined;
  /** `data-*` 표지(시험·측정용) */
  readonly state?: string | undefined;
  readonly slot?: string | undefined;
}

export function StatusBand(props: StatusBandProps): ReactNode {
  return (
    <div
      data-slot={props.slot ?? "status-band"}
      data-state={props.state}
      className="grid min-w-0 gap-2 px-4 py-3"
    >
      <div className="flex min-w-0 items-center gap-6">
        <div role="status" className="flex min-w-0 flex-1 items-start gap-2.5">
          <span aria-hidden className={`mt-1.5 size-2 flex-none rounded-full ${DOT[props.tone]}`} />
          <div className="grid min-w-0 gap-0.5">
            <span className="text-ui font-medium text-text-primary">{props.title}</span>
            {props.description === undefined ? null : (
              <span className="text-ui text-text-tertiary">{props.description}</span>
            )}
          </div>
        </div>
        {props.actions === undefined ? null : (
          <div className="flex flex-none items-center gap-2">{props.actions}</div>
        )}
      </div>
      {props.result === undefined || props.result === null ? null : (
        <div className="ps-4.5 text-ui text-text-secondary">{props.result}</div>
      )}
    </div>
  );
}
