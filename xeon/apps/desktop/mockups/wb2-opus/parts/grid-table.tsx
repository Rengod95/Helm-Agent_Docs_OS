// [caustic 간극] Table에 "행 하나 고르기(활성화)"가 없다. caustic Table은 체크 상자 다중 선택만 있고 행 사이 선(divider-line)이
// 늘 그려져 DP-26(행 사이 선 없음)과 맞지 않는다. 그래서 같은 토큰으로 ghost 표를 직접 그린다:
// 머리 tertiary 글자, 행 높이 32px(xs), 행 사이 선 없음, 숫자 열 오른쪽 맞춤 + tabular 숫자, 고른 행은 caustic 현재 항목과 같은
// raised 면(bg-control-raised + control-edge 안쪽 선). 고르는 행은 Enter·Space·클릭으로 고르고, 화살표 위아래로 옮긴다.
// caustic에 Table `selectionMode="single"` + `onRowActivate` + `dividers={false}`를 제안한다.
import type { KeyboardEvent, ReactNode } from "react";

export interface GridColumn<R> {
  key: string;
  header: ReactNode;
  align?: "start" | "end";
  /** CSS 폭(예 "6rem"). 없으면 남은 폭. */
  width?: string;
  /** 좁은 폭(700px 아래)에서 숨긴다. */
  hideCompact?: boolean;
  cell: (row: R) => ReactNode;
}

export function GridTable<R extends { id: string }>({
  label,
  columns,
  rows,
  selectedId,
  onSelect,
  rowLabel,
}: {
  label: string;
  columns: GridColumn<R>[];
  rows: R[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  rowLabel?: (row: R) => string;
}) {
  const selectable = onSelect !== undefined;
  const move = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (!selectable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const tr = e.currentTarget;
    const next = (
      e.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling
    ) as HTMLElement | null;
    next?.focus();
  };
  return (
    <table
      aria-label={label}
      className="w-full table-fixed border-separate border-spacing-0 font-ui"
    >
      <colgroup>
        {columns.map((c) => (
          <col
            key={c.key}
            className={c.hideCompact ? "max-[700px]:hidden" : undefined}
            style={c.width ? { width: c.width } : undefined}
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={[
                "h-7 truncate px-2 text-ui-xs font-normal text-text-tertiary",
                c.align === "end" ? "text-end" : "text-start",
                c.hideCompact ? "max-[700px]:hidden" : "",
              ].join(" ")}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const on = selectable && selectedId === r.id;
          return (
            <tr
              key={r.id}
              {...(selectable
                ? {
                    tabIndex: 0,
                    "aria-selected": on,
                    "aria-label": rowLabel?.(r),
                    onClick: () => onSelect(r.id),
                    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => move(e, r.id),
                  }
                : {})}
              className={[
                "group outline-none",
                selectable
                  ? "cursor-pointer focus-visible:[&>td]:shadow-[inset_0_2px_0_var(--cs-color-focus-ring),inset_0_-2px_0_var(--cs-color-focus-ring)]"
                  : "",
                on
                  ? "[&>td]:bg-control-raised [&>td]:shadow-[inset_0_1px_0_var(--cs-color-control-edge),inset_0_-1px_0_var(--cs-color-control-edge)] [&>td:first-child]:shadow-[inset_1px_1px_0_var(--cs-color-control-edge),inset_0_-1px_0_var(--cs-color-control-edge)] [&>td:last-child]:shadow-[inset_-1px_1px_0_var(--cs-color-control-edge),inset_0_-1px_0_var(--cs-color-control-edge)]"
                  : selectable
                    ? "hover:[&>td]:bg-neutral-hover"
                    : "",
              ].join(" ")}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={[
                    "h-8 truncate px-2 text-ui-dense text-text-primary first:rounded-s-md last:rounded-e-md",
                    c.align === "end" ? "text-end tabular-nums" : "text-start",
                    c.hideCompact ? "max-[700px]:hidden" : "",
                  ].join(" ")}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
