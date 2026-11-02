// 선 격자(Vercel 선 방식) 로컬 이식. foundation caustic에는 LineGrid와 line-cell 유틸리티가 없어 목업 안에 둔다(caustic는 건드리지 않는다).
// API는 m4/redesign이 쓰던 caustic LineGrid와 같다: LineGrid, LineGridBlock, LineGridCell, LineGridMetric, LineGridEmpty, LineGridMark.
// 칸 사이 간격 0, 칸마다 위·왼쪽 1px 선(line-cell), 바깥은 clip-path로 잘라 테두리 없이, 십자 표식은 잘리지 않는 둘째 층에.
// 빈 칸은 빗금(line-cell-hatch). 색·글자는 foundation(옛 언어) 토큰만 쓴다. CSS는 ./line-grid.css(shell.css가 가져온다).
import {
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type LineGridDot = "danger" | "warning" | "neutral";

const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter((p) => typeof p === "string" && p !== "").join(" ");

const lineGridVariants = (): string =>
  "relative grid min-w-0 grid-cols-(--line-grid-cols) grid-rows-(--line-grid-rows)";
const lineGridLayer = ({ layer }: { layer: "cells" | "marks" }): string =>
  cn(
    "col-span-full row-span-full grid min-w-0 grid-cols-subgrid grid-rows-subgrid",
    layer === "cells" ? "[clip-path:inset(1px_0_0_1px)]" : "pointer-events-none",
  );
const lineGridCell = ({
  density = "regular",
  kind = "data",
  empty = false,
  selected = false,
  interactive = false,
}: {
  density?: "regular" | "compact";
  kind?: "data" | "head";
  empty?: boolean;
  selected?: boolean;
  interactive?: boolean;
}): string =>
  cn(
    "line-cell relative min-h-12 min-w-0 py-3 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]",
    density === "regular" ? "px-4" : "px-3",
    kind === "data" ? "text-body text-text-primary" : "flex items-baseline gap-2",
    empty && "line-cell-hatch",
    selected && "bg-neutral-soft",
    interactive && "cursor-pointer",
    interactive && !selected && "hover:bg-neutral-hover",
  );
const lineGridMark = ({ x, y }: { x: "start" | "end"; y: "start" | "end" }): string =>
  cn(
    "absolute size-icon-sm -translate-x-1/2 -translate-y-1/2 text-grid-mark",
    x === "start" ? "left-0" : "left-full",
    y === "start" ? "top-0" : "top-full",
  );
const lineGridDot = ({ dot }: { dot: LineGridDot }): string =>
  cn(
    "size-1.5 flex-none rounded-full",
    dot === "danger" && "bg-danger-graphic",
    dot === "warning" && "bg-warning-graphic",
    dot === "neutral" && "bg-neutral-graphic",
  );
const lineGridItem = ({ muted = false }: { muted?: boolean }): string =>
  cn(
    "flex min-w-0 items-center gap-2 text-body",
    muted ? "text-text-tertiary" : "text-text-primary",
  );

export interface LineGridColumn {
  id: string;
  /** Header cell text, on the left. */
  label: ReactNode;
  /** One muted word on the right of the header cell. */
  hint?: ReactNode | undefined;
  /** Track size (a CSS length or track). Defaults to minmax(0, 1fr). */
  width?: string | undefined;
}

export interface LineGridRow {
  id: string;
  label: ReactNode;
  hint?: ReactNode | undefined;
  /** Group name. Where it changes, the boundary gets a cross mark on both outer edges. */
  group?: string | undefined;
}

export interface LineGridItem {
  id: string;
  label: ReactNode;
  /** 6px state dot; semantic tones only for states the person acts on. */
  dot?: LineGridDot | undefined;
  /** Muted text. */
  muted?: boolean | undefined;
  /** Struck through and muted, for an item about to leave. */
  struck?: boolean | undefined;
}

export interface LineGridCellData {
  items: LineGridItem[];
}

export interface LineGridSelection {
  row?: string | undefined;
  col?: string | undefined;
}

export interface LineGridProps extends Omit<ComponentProps<"div">, "onSelect" | "children"> {
  /** Accessible name of the grid. */
  label: string;
  columns: readonly LineGridColumn[];
  rows: readonly LineGridRow[];
  /** Cell content. Null or no items draws a hatched empty cell. */
  cell: (rowId: string, colId: string) => LineGridCellData | null;
  /** The selected cell (row + col), row (row only) or column (col only). */
  selected?: LineGridSelection | undefined;
  /** Focus lens: items it returns false for take muted text. */
  focus?: ((rowId: string, colId: string, itemId: string) => boolean) | undefined;
  /** A data cell was pressed or activated with Enter or Space. */
  onSelect?: ((rowId: string, colId: string) => void) | undefined;
  /** A row header was pressed; passing it puts row headers in the roving order. */
  onSelectRow?: ((rowId: string) => void) | undefined;
  /** A column header was pressed; passing it puts column headers in the roving order. */
  onSelectColumn?: ((colId: string) => void) | undefined;
  /** An item was pressed; passing it makes items buttons, and pressing one does not call onSelect. */
  onItemSelect?: ((rowId: string, colId: string, itemId: string) => void) | undefined;
  /** regular = cell inline padding 16; compact = 12 for many columns. */
  density?: "regular" | "compact" | undefined;
  /** Row ids that start a new group; defaults to where rows[].group changes. */
  groupBreaks?: readonly string[] | undefined;
  /** Top-left header cell content, usually empty. */
  corner?: ReactNode | undefined;
  /** Row header track (a CSS length). Default 11rem. */
  rowHeadWidth?: string | undefined;
}

export interface LineGridMarkProps extends ComponentProps<"svg"> {
  x?: "start" | "end" | undefined;
  y?: "start" | "end" | undefined;
}

/** A 14px cross where the grid's outer lines meet a rail. Decorative. */
export function LineGridMark({ x = "start", y = "start", className, ...props }: LineGridMarkProps) {
  return (
    <svg
      data-slot="line-grid-mark"
      viewBox="0 0 14 14"
      aria-hidden
      className={cn(lineGridMark({ x, y }), className)}
      {...props}
    >
      <path d="M7 0V14M0 7H14" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

/** Cell position; r = -1 is the column header row, c = -1 the row header column. */
interface Pos {
  r: number;
  c: number;
}
const cellKey = (p: Pos) => `${p.r}:${p.c}`;
const asVars = (vars: Record<string, string | number>) => vars as CSSProperties;
const withVars = (vars: Record<string, string | number>, style?: CSSProperties): CSSProperties =>
  Object.assign({}, asVars(vars), style);

function Head({ label, hint }: { label: ReactNode; hint?: ReactNode | undefined }) {
  return (
    <>
      <span
        data-slot="line-grid-head-label"
        className="min-w-0 truncate text-title-3 text-text-primary"
      >
        {label}
      </span>
      {hint !== undefined && (
        <span
          data-slot="line-grid-head-hint"
          className="ms-auto flex-none text-footnote text-text-tertiary"
        >
          {hint}
        </span>
      )}
    </>
  );
}

/** A matrix: rows × columns in a line cell grid, with roving keyboard focus. */
export function LineGrid({
  label,
  columns,
  rows,
  cell,
  selected,
  focus,
  onSelect,
  onSelectRow,
  onSelectColumn,
  onItemSelect,
  density = "regular",
  groupBreaks,
  corner,
  rowHeadWidth = "11rem",
  className,
  style,
  ref,
  ...props
}: LineGridProps) {
  const [active, setActive] = useState<Pos>({ r: 0, c: 0 });
  const root = useRef<HTMLDivElement>(null);
  const nCols = columns.length;
  const nRows = rows.length;
  const minR = onSelectColumn !== undefined ? -1 : 0;
  const minC = onSelectRow !== undefined ? -1 : 0;
  const breaks =
    groupBreaks ?? rows.filter((r, i) => i > 0 && r.group !== rows[i - 1]?.group).map((r) => r.id);

  const isSel = (rowId: string, colId: string | null) => {
    if (selected === undefined) return false;
    if (selected.row !== undefined && selected.col !== undefined)
      return selected.row === rowId && selected.col === colId;
    if (selected.row !== undefined) return selected.row === rowId;
    if (selected.col !== undefined) return selected.col === colId;
    return false;
  };
  const colSel = (colId: string) => selected?.row === undefined && selected?.col === colId;
  const rowSel = (rowId: string) => selected?.row === rowId && selected.col === undefined;

  const move = (r: number, c: number) => {
    const next = {
      r: Math.max(minR, Math.min(nRows - 1, r)),
      c: Math.max(minC, Math.min(nCols - 1, c)),
    };
    // The top-left corner cell has nothing to select: do not move there.
    if (next.r === -1 && next.c === -1) return;
    setActive(next);
    root.current?.querySelector<HTMLElement>(`[data-cell="${cellKey(next)}"]`)?.focus();
  };
  const activate = ({ r, c }: Pos) => {
    if (r === -1) {
      const col = columns[c];
      if (col !== undefined) onSelectColumn?.(col.id);
      return;
    }
    const row = rows[r];
    if (row === undefined) return;
    if (c === -1) {
      onSelectRow?.(row.id);
      return;
    }
    const col = columns[c];
    if (col !== undefined) onSelect?.(row.id, col.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const { r, c } = active;
    const onItem = e.target instanceof HTMLElement && e.target.dataset["item"] !== undefined;
    if (e.key === "ArrowRight") move(r, c + 1);
    else if (e.key === "ArrowLeft") move(r, c - 1);
    else if (e.key === "ArrowDown") move(r + 1, c);
    else if (e.key === "ArrowUp") move(r - 1, c);
    else if (e.key === "Home") move(e.ctrlKey ? minR : r, minC);
    else if (e.key === "End") move(e.ctrlKey ? nRows - 1 : r, nCols - 1);
    else if (e.key === "Enter" || e.key === " ") {
      // On an item button the button presses itself.
      if (onItem) return;
      activate(active);
    } else return;
    e.preventDefault();
  };
  const roving = (p: Pos) => ({
    "data-cell": cellKey(p),
    tabIndex: active.r === p.r && active.c === p.c ? 0 : -1,
  });

  // Marks layer: track 1 is the header, track i + 2 is rows[i]; column 1 is the row header, column j + 2 is columns[j].
  const lastCol = nCols + 1;
  const lastRow = nRows + 1;
  const anchor = (
    row: number,
    col: number,
    x: "start" | "end",
    y: "start" | "end",
    key: string,
  ) => (
    <div
      key={key}
      className="relative [grid-column:var(--line-grid-c)] [grid-row:var(--line-grid-r)]"
      style={asVars({ "--line-grid-r": row, "--line-grid-c": col })}
    >
      <LineGridMark x={x} y={y} />
    </div>
  );
  const assign = (el: HTMLDivElement | null) => {
    root.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  const tracks = withVars(
    {
      "--line-grid-cols": `${rowHeadWidth} ${columns.map((c) => c.width ?? "minmax(0, 1fr)").join(" ")}`,
      "--line-grid-rows": `repeat(${nRows + 1}, auto)`,
    },
    style,
  );

  return (
    <div
      ref={assign}
      data-slot="line-grid"
      className={cn(lineGridVariants(), className)}
      style={tracks}
      {...props}
    >
      <div
        data-slot="line-grid-cells"
        role="grid"
        aria-label={label}
        aria-rowcount={nRows + 1}
        aria-colcount={nCols + 1}
        className={lineGridLayer({ layer: "cells" })}
        onKeyDown={onKeyDown}
      >
        <div role="row" className="contents">
          <div
            data-slot="line-grid-head"
            role={corner !== undefined ? "columnheader" : "gridcell"}
            className={lineGridCell({ density, kind: "head" })}
          >
            {corner !== undefined && (
              <span className="text-footnote text-text-tertiary">{corner}</span>
            )}
          </div>
          {columns.map((col, c) => (
            <div
              key={col.id}
              data-slot="line-grid-head"
              role="columnheader"
              data-selected={colSel(col.id) ? "" : undefined}
              className={lineGridCell({
                density,
                kind: "head",
                selected: colSel(col.id),
                interactive: onSelectColumn !== undefined,
              })}
              {...(onSelectColumn !== undefined
                ? {
                    ...roving({ r: -1, c }),
                    "aria-selected": colSel(col.id),
                    onClick: () => {
                      setActive({ r: -1, c });
                      onSelectColumn(col.id);
                    },
                  }
                : {})}
            >
              <Head label={col.label} hint={col.hint} />
            </div>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={row.id} role="row" className="contents">
            <div
              data-slot="line-grid-head"
              role="rowheader"
              data-selected={rowSel(row.id) ? "" : undefined}
              className={lineGridCell({
                density,
                kind: "head",
                selected: rowSel(row.id),
                interactive: onSelectRow !== undefined,
              })}
              {...(onSelectRow !== undefined
                ? {
                    ...roving({ r, c: -1 }),
                    "aria-selected": rowSel(row.id),
                    onClick: () => {
                      setActive({ r, c: -1 });
                      onSelectRow(row.id);
                    },
                  }
                : {})}
            >
              <Head label={row.label} hint={row.hint} />
            </div>
            {columns.map((col, c) => {
              const items = cell(row.id, col.id)?.items ?? [];
              const sel = isSel(row.id, col.id);
              const here = active.r === r && active.c === c;
              return (
                <div
                  key={col.id}
                  data-slot="line-grid-cell"
                  role="gridcell"
                  {...roving({ r, c })}
                  aria-selected={sel}
                  data-empty={items.length === 0 ? "" : undefined}
                  data-selected={sel ? "" : undefined}
                  className={lineGridCell({
                    density,
                    empty: items.length === 0,
                    selected: sel,
                    interactive: onSelect !== undefined,
                  })}
                  onClick={() => {
                    setActive({ r, c });
                    onSelect?.(row.id, col.id);
                  }}
                >
                  {items.length > 0 && (
                    <ul className="m-0 grid list-none gap-1 p-0">
                      {items.map((it) => {
                        const muted =
                          it.muted === true ||
                          it.struck === true ||
                          (focus !== undefined && !focus(row.id, col.id, it.id));
                        const text = (
                          <>
                            {it.dot !== undefined && (
                              <span
                                data-slot="line-grid-dot"
                                aria-hidden
                                className={lineGridDot({ dot: it.dot })}
                              />
                            )}
                            <span
                              className={cn(
                                "min-w-0 truncate",
                                it.struck === true && "line-through",
                              )}
                            >
                              {it.label}
                            </span>
                          </>
                        );
                        return (
                          <li
                            key={it.id}
                            data-slot="line-grid-item"
                            className={lineGridItem({ muted })}
                          >
                            {onItemSelect !== undefined ? (
                              <button
                                type="button"
                                data-item=""
                                tabIndex={here ? 0 : -1}
                                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-xs text-start outline-none hover:underline focus-visible:shadow-focus"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActive({ r, c });
                                  onItemSelect(row.id, col.id, it.id);
                                }}
                              >
                                {text}
                              </button>
                            ) : (
                              text
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div data-slot="line-grid-marks" aria-hidden className={lineGridLayer({ layer: "marks" })}>
        {anchor(1, 1, "start", "start", "tl")}
        {anchor(1, lastCol, "end", "start", "tr")}
        {anchor(lastRow, 1, "start", "end", "bl")}
        {anchor(lastRow, lastCol, "end", "end", "br")}
        {rows.flatMap((row, r) =>
          breaks.includes(row.id)
            ? [
                anchor(r + 2, 1, "start", "start", `gs-${row.id}`),
                anchor(r + 2, lastCol, "end", "start", `ge-${row.id}`),
              ]
            : [],
        )}
      </div>
    </div>
  );
}

export interface LineGridBlockProps extends ComponentProps<"div"> {
  /** Equal columns, or a CSS track list. */
  columns?: number | string | undefined;
  /** Draw the four outer cross marks. Default true. */
  marks?: boolean | undefined;
}

/** Free cells on the same lines: metric groups, compare blocks, summary cells. */
export function LineGridBlock({
  columns = 3,
  marks = true,
  className,
  style,
  children,
  ...props
}: LineGridBlockProps) {
  const cols = typeof columns === "number" ? `repeat(${columns}, minmax(0, 1fr))` : columns;
  return (
    <div
      data-slot="line-grid-block"
      className={cn("relative min-w-0", className)}
      style={style}
      {...props}
    >
      <div
        data-slot="line-grid-cells"
        className="grid grid-cols-(--line-grid-cols) [clip-path:inset(1px_0_0_1px)]"
        style={asVars({ "--line-grid-cols": cols })}
      >
        {children}
      </div>
      {marks && (
        <>
          <LineGridMark x="start" y="start" />
          <LineGridMark x="end" y="start" />
          <LineGridMark x="start" y="end" />
          <LineGridMark x="end" y="end" />
        </>
      )}
    </div>
  );
}

export interface LineGridCellProps extends ComponentProps<"div"> {
  /** Header cell: no fill, title-3 text on the line. */
  head?: boolean | undefined;
  selected?: boolean | undefined;
  density?: "regular" | "compact" | undefined;
  /** Spans this many columns. */
  span?: number | undefined;
}

/** One free cell of a LineGridBlock. */
export function LineGridCell({
  head = false,
  selected = false,
  density = "regular",
  span,
  className,
  style,
  ...props
}: LineGridCellProps) {
  return (
    <div
      data-slot="line-grid-cell"
      data-selected={selected ? "" : undefined}
      className={cn(
        lineGridCell({ density, kind: head ? "head" : "data", selected }),
        span !== undefined && "[grid-column:span_var(--line-grid-span)]",
        className,
      )}
      style={span !== undefined ? withVars({ "--line-grid-span": span }, style) : style}
      {...props}
    />
  );
}

export interface LineGridMetricProps extends Omit<ComponentProps<"div">, "children"> {
  /** The value: figure 20/28/500, tabular. */
  value: ReactNode;
  /** What the value is, muted. */
  metricLabel: ReactNode;
  selected?: boolean | undefined;
}

/** A metric cell: the value above a muted label. */
export function LineGridMetric({
  value,
  metricLabel,
  selected = false,
  className,
  ...props
}: LineGridMetricProps) {
  return (
    <div
      data-slot="line-grid-metric"
      data-selected={selected ? "" : undefined}
      className={cn(lineGridCell({ selected }), "grid content-start gap-0.5", className)}
      {...props}
    >
      <span
        data-slot="line-grid-metric-value"
        className="text-figure text-text-primary tabular-nums"
      >
        {value}
      </span>
      <span data-slot="line-grid-metric-label" className="text-body text-text-tertiary">
        {metricLabel}
      </span>
    </div>
  );
}

export interface LineGridEmptyProps extends ComponentProps<"div"> {
  span?: number | undefined;
}

/** A hatched cell meaning "does not apply". It carries no text. */
export function LineGridEmpty({ span, className, style, ...props }: LineGridEmptyProps) {
  return (
    <div
      data-slot="line-grid-empty"
      aria-hidden
      className={cn(
        lineGridCell({ empty: true }),
        span !== undefined && "[grid-column:span_var(--line-grid-span)]",
        className,
      )}
      style={span !== undefined ? withVars({ "--line-grid-span": span }, style) : style}
      {...props}
    />
  );
}

/**
 * 선 격자 바깥 틀: 격자는 바깥 선을 그리지 않으므로(첫 행 위·첫 열 왼쪽은 clip으로 잘림) 이 감싸개가 1px 바깥 선을 긋는다.
 * 레일 없이도 표가 열려 보이지 않게 한다. 십자 표식은 격자(LineGrid, LineGridBlock)가 바깥 네 모서리에 그린다. 좁으면 가로로 스크롤한다.
 */
export function LineGridFrame({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="line-grid-frame" className={cn("relative min-w-0", className)} {...props}>
      <div className="-m-2 overflow-x-auto p-2">{children}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 border border-border-subtle"
      />
    </div>
  );
}
