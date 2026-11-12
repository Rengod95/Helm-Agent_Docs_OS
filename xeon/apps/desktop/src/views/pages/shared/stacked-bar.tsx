import type { ReactNode } from "react";

// 누적 막대와 범례(DP-88 [결정: 2026-11-11 사용자]). 전체를 몇 갈래로 나눈 양(저장 공간의 대화·첨부·로그 등)을 한 줄 막대(높이 8,
// 칸 사이 2px 틈)와 그 아래 범례 표(점 8 · 이름 13 · 값 12 tabular 오른쪽)로 보인다. 0인 갈래는 막대에서 빠지고 범례에는 남는다.
// 색은 차례로 다섯 칸(ink, info, agent, warning, neutral)이다. 다섯을 넘는 갈래는 neutral을 다시 쓴다.

const FILLS: readonly string[] = [
  "bg-accent-solid",
  "bg-info-solid",
  "bg-agent-solid",
  "bg-warning-solid",
  "bg-neutral-solid",
];

function fillOf(index: number): string {
  return FILLS[Math.min(index, FILLS.length - 1)] ?? "bg-neutral-solid";
}

export interface StackedPart {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** 범례 오른쪽 값 글 */
  readonly valueText: string;
  /** 범례 줄 아래에 붙는 것(하위 목록). 없으면 그리지 않는다 */
  readonly detail?: ReactNode | undefined;
}

export function StackedBar(props: {
  readonly parts: readonly StackedPart[];
  /** 막대의 접근성 이름(갈래별 값은 범례가 읽힌다) */
  readonly label: string;
}): ReactNode {
  const total = props.parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div data-slot="stacked-bar" className="grid min-w-0 gap-3">
      <div
        role="img"
        aria-label={props.label}
        className="flex h-2 min-w-0 gap-0.5 overflow-hidden rounded-xs bg-bg-inset"
      >
        {total === 0
          ? null
          : props.parts.map((part, index) =>
              part.value === 0 ? null : (
                <span
                  key={part.key}
                  data-part={part.key}
                  className={`h-full min-w-0.5 ${fillOf(index)}`}
                  style={{ flexGrow: part.value, flexBasis: 0 }}
                />
              ),
            )}
      </div>
      <ul className="m-0 grid list-none gap-0 p-0">
        {props.parts.map((part, index) => (
          <li key={part.key} data-legend={part.key} className="grid min-w-0 gap-1 py-1">
            <div className="flex min-h-6 min-w-0 items-center gap-2">
              <span aria-hidden className={`size-2 flex-none rounded-full ${fillOf(index)}`} />
              <span className="min-w-0 flex-1 truncate text-ui text-text-secondary">
                {part.label}
              </span>
              <span className="flex-none text-ui-sm text-text-primary tabular-nums">
                {part.valueText}
              </span>
            </div>
            {part.detail === undefined || part.detail === null ? null : (
              <div className="ps-4">{part.detail}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
