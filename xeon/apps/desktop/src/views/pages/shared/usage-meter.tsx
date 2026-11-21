import { Meter } from "@caustic/react";
import type { ReactNode } from "react";

// 사용량 막대(DP-88 [결정: 2026-11-11 사용자]). "얼마나 썼고 한도가 얼마인지"를 막대(caustic Meter sm) 한 줄과 오른쪽 숫자(12, tabular)로 보인다.
// 90% 이상은 warning, 한도에 닿거나 넘으면 danger(Meter의 `meterLevel`). 기억 한도, 예산처럼 한도가 있는 값은 이 부품 하나로 그린다.

export interface UsageMeterProps {
  readonly used: number;
  readonly limit: number;
  /** 막대의 접근성 이름 */
  readonly label: string;
  /** 오른쪽 숫자 글("312 / 1,375자"). 낭독기 값 글로도 쓴다 */
  readonly valueText: string;
}

export function UsageMeter(props: UsageMeterProps): ReactNode {
  const { used, limit } = props;
  return (
    <div data-slot="usage-meter" className="flex min-w-0 items-center gap-3">
      <Meter
        size="sm"
        value={used}
        max={Math.max(limit, 1)}
        high={limit * 0.9}
        label={props.label}
        valueText={props.valueText}
        className="min-w-0 flex-1"
      />
      <span
        className={`flex-none text-ui-sm ${used > limit ? "text-danger-text" : "text-text-tertiary"}`}
      >
        {props.valueText}
      </span>
    </div>
  );
}
