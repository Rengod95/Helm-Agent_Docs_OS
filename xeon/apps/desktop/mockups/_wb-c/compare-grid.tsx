// 비교표 = 선 격자 LineGridBlock(_shell/line-grid.tsx, 옛 언어 이식) 위의 얇은 감싸개: 머리 열 하나 + 비교할 열들.
// 테스트끼리, 버전끼리, 범위별 값, 슬롯 × 화면 방식처럼 "행은 같고 열이 대상"인 표에 쓴다. 해당 없는 칸(null)은 빗금.
// LineGridBlock은 role을 주지 않아 표 role을 여기서 붙인다(행은 display: contents라 칸이 격자의 직접 자식처럼 놓인다).
import type { ReactNode } from "react";
import { LineGridBlock, LineGridCell, LineGridEmpty } from "../_shell";

export interface CompareColumn {
  id: string;
  head: ReactNode;
  /** 머리 오른쪽 연한 한 단어. */
  note?: ReactNode;
}
export interface CompareRow {
  id: string;
  head: ReactNode;
}

export function CompareGrid({
  label,
  corner,
  columns,
  rows,
  cell,
  selected,
  rowHeadWidth = "9rem",
  minWidth,
  marks = true,
  className,
}: {
  label: string;
  corner?: ReactNode;
  columns: CompareColumn[];
  rows: CompareRow[];
  /** 칸 내용. null이면 "해당 없음" 빗금. */
  cell: (rowId: string, colId: string) => ReactNode;
  /** 이기는 칸·지금 열처럼 강조할 칸(soft 채움). */
  selected?: (rowId: string, colId: string) => boolean;
  rowHeadWidth?: string;
  /** 좁은 폭에서 가로로 스크롤할 최소 폭. 스크롤 영역이 + 표식을 자르므로 이때는 표식을 뺀다. */
  minWidth?: number;
  /** 바깥 + 표식. 상세 안 작은 표나 왼쪽 여백 없는 스크롤 열에서는 끈다. */
  marks?: boolean;
  className?: string;
}) {
  const grid = (
    <LineGridBlock
      role="table"
      aria-label={label}
      marks={marks && minWidth === undefined}
      columns={`${rowHeadWidth} repeat(${columns.length}, minmax(0, 1fr))`}
      {...(minWidth !== undefined ? { style: { minWidth } } : {})}
      {...(minWidth === undefined && className !== undefined ? { className } : {})}
    >
      <div role="row" className="contents">
        <LineGridCell head role="columnheader">
          {corner !== undefined && <span className="text-body text-text-tertiary">{corner}</span>}
        </LineGridCell>
        {columns.map((c) => (
          <LineGridCell key={c.id} head role="columnheader" className="justify-between">
            <span className="min-w-0 break-keep text-title-3 text-text-primary">{c.head}</span>
            {c.note !== undefined && (
              <span className="flex-none text-ui-xs text-text-tertiary">{c.note}</span>
            )}
          </LineGridCell>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.id} role="row" className="contents">
          <LineGridCell head role="rowheader">
            <span className="min-w-0 text-ui-dense text-text-secondary">{r.head}</span>
          </LineGridCell>
          {columns.map((c) => {
            const v = cell(r.id, c.id);
            return v === null ? (
              <LineGridEmpty key={c.id} role="cell" aria-hidden={false} aria-label="해당 없음" />
            ) : (
              <LineGridCell key={c.id} role="cell" selected={selected?.(r.id, c.id) === true}>
                {v}
              </LineGridCell>
            );
          })}
        </div>
      ))}
    </LineGridBlock>
  );
  return minWidth === undefined ? (
    grid
  ) : (
    <div className={`overflow-x-auto ${className ?? ""}`}>{grid}</div>
  );
}
