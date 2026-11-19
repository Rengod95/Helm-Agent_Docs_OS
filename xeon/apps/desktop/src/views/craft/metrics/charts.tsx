// 메트릭과 트레이스의 그림 부품. 새 차트 라이브러리를 받지 않고 SVG로 직접 그린다(의존 목록에 차트 라이브러리가 없다).
// 규칙(dataviz): 가는 표식, 칸 사이 2px 틈, 2개 이상 갈래면 범례, 글자는 글자 토큰(색은 표식만), 올리면 값이 뜬다,
// 모든 그림에 같은 내용의 표(`ChartTable`)가 있다. 색은 `viz.css`의 종류 색과 먹 단계뿐이다.
import { t } from "@fresnel/client/i18n";
import { Button } from "@caustic/react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

// ───────── 공용 ─────────

/** 폭들을 왼쪽부터 `gap` 간격으로 잇댄 자리(x, 폭) */
export function placeAlong(
  widths: readonly number[],
  gap: number,
): { readonly x: number; readonly w: number }[] {
  const out: { x: number; w: number }[] = [];
  let x = 0;
  for (const w of widths) {
    out.push({ x, w });
    x += w + gap;
  }
  return out;
}

/**
 * 요소의 폭(px). 처음에는 0이고 그리기 전에(layout effect) 잰다. 처음 값이 크면 그 SVG가 격자 칸을 밀어
 * 칸이 그 폭에 머무른다(칸 폭 → 잰 폭 → SVG 폭이 서로를 붙든다). 0에서 시작하면 칸 폭을 그대로 잰다
 */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      setWidth(el.clientWidth);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

/** 그림 한 갈래의 색과 이름 */
export interface Series {
  readonly id: string;
  readonly label: string;
  /** CSS 색(`var(--viz-…)`) */
  readonly color: string;
  /** 빗금(기록되지 않은 갈래) */
  readonly hatch?: boolean;
}

export function Swatch(props: { readonly color: string; readonly hatch?: boolean }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-[3px] ${props.hatch === true ? "viz-hatch border border-border-default" : ""}`}
      style={props.hatch === true ? undefined : { background: props.color }}
    />
  );
}

/** 범례 한 줄. 갈래가 둘 이상일 때만 그린다 */
export function Legend(props: { readonly series: readonly Series[] }): ReactNode {
  if (props.series.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-sm text-text-secondary">
      {props.series.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <Swatch color={s.color} {...(s.hatch === true ? { hatch: true } : {})} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** 그림과 표를 바꾸는 단추. 같은 내용의 표가 화면 읽기의 대안이다 */
export function FigureToggle(props: {
  readonly table: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <Button size="xs" variant="ghost" aria-pressed={props.table} onClick={props.onToggle}>
      {props.table
        ? t("desktop.craft.metrics.chart.showChart")
        : t("desktop.craft.metrics.chart.showTable")}
    </Button>
  );
}

export interface TableColumn {
  readonly id: string;
  readonly label: string;
  readonly numeric?: boolean;
}

/** 그림과 같은 내용의 표 */
export function ChartTable(props: {
  readonly caption: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly { readonly id: string; readonly cells: readonly ReactNode[] }[];
}): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table className="viz-figure w-full border-collapse text-ui-sm">
        <caption className="sr-only">{props.caption}</caption>
        <thead>
          <tr className="border-b border-border-subtle text-text-tertiary">
            {props.columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={`h-7 px-2 font-normal ${c.numeric === true ? "text-right" : "text-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle last:border-b-0">
              {row.cells.map((cell, i) => (
                <td
                  key={props.columns[i]?.id ?? String(i)}
                  className={`h-7 px-2 text-text-secondary ${props.columns[i]?.numeric === true ? "text-right" : "text-left"} ${i === 0 ? "text-text-primary" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 올린 표식의 값. 그림 위 오른쪽 위에 뜬다(표식을 가리지 않는다) */
export function Readout(props: { readonly children: ReactNode }): ReactNode {
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 right-0 z-10 rounded-md border border-border-subtle bg-surface-raised px-2 py-1 text-ui-sm text-text-primary shadow-1"
    >
      {props.children}
    </div>
  );
}

// ───────── 이어 붙인 막대 하나 ─────────

export interface Segment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
  /** 올렸을 때의 값 글 */
  readonly valueText: string;
  readonly hatch?: boolean;
}

/**
 * 가로로 이어 붙인 막대 하나(전체 = 합). 칸 사이 2px 틈, 양 끝 4px 둥근 모서리.
 * `labels`가 참이면 칸 아래에 이름과 값을 직접 단다(좁은 칸은 이름을 뺀다).
 */
export function SegmentBar(props: {
  readonly segments: readonly Segment[];
  readonly height?: number;
  readonly label: string;
  readonly labels?: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hot, setHot] = useState<string | null>(null);
  const height = props.height ?? 20;
  const total = props.segments.reduce((s, x) => s + x.value, 0);
  const gap = 2;
  const usable = Math.max(0, width - gap * Math.max(0, props.segments.length - 1));
  const spots = placeAlong(
    props.segments.map((s) =>
      total === 0 ? 0 : Math.max(s.value > 0 ? 2 : 0, (s.value / total) * usable),
    ),
    gap,
  );
  const placed = props.segments.map((s, i) => ({
    seg: s,
    x: spots[i]?.x ?? 0,
    w: spots[i]?.w ?? 0,
  }));
  const hotSeg = placed.find((p) => p.seg.id === hot)?.seg ?? null;
  return (
    <div ref={ref} className="relative">
      {hotSeg === null ? null : (
        <Readout>
          <span className="text-text-secondary">{hotSeg.label}</span>{" "}
          <span className="viz-figure font-medium">{hotSeg.valueText}</span>
        </Readout>
      )}
      <svg
        role="img"
        aria-label={props.label}
        width={width}
        height={height}
        className="viz-hoverable block"
        {...(hot === null ? {} : { "data-viz-hot": "" })}
      >
        <defs>
          <pattern
            id="viz-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--viz-track)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--viz-grid)" strokeWidth="2" />
          </pattern>
        </defs>
        {total === 0 ? (
          <rect width={width} height={height} rx={4} fill="var(--viz-track)" />
        ) : (
          placed.map(({ seg: s, x, w }, i) => (
            <rect
              key={s.id}
              data-viz-mark=""
              {...(hot === s.id ? { "data-viz-hot": "" } : {})}
              x={x}
              y={0}
              width={w}
              height={height}
              rx={i === 0 || i === placed.length - 1 ? 4 : 1.5}
              fill={s.hatch === true ? "url(#viz-hatch)" : s.color}
              onPointerEnter={() => {
                setHot(s.id);
              }}
              onPointerLeave={() => {
                setHot(null);
              }}
            />
          ))
        )}
      </svg>
      {props.labels === true && total > 0 ? (
        <div className="relative mt-1.5 h-8 text-ui-sm" aria-hidden="true">
          {placed
            .filter((p) => p.w >= 56)
            .map(({ seg: s, x, w }) => (
              <div
                key={s.id}
                className="absolute top-0 overflow-hidden pr-1"
                style={{ left: x, width: w }}
              >
                <div className="truncate text-text-secondary">{s.label}</div>
                <div className="viz-figure truncate text-text-primary">{s.valueText}</div>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

// ───────── 줄마다 이어 붙인 막대(플러그인별) ─────────

export interface StackRow {
  readonly id: string;
  readonly label: ReactNode;
  /** 화면 읽기와 올린 값의 이름 */
  readonly name: string;
  readonly parts: readonly { readonly series: string; readonly value: number }[];
  readonly totalText: string;
}

/** 줄마다 가로 막대. 모든 줄이 같은 눈금(가장 긴 줄 = 막대 폭)이다 */
export function StackRows(props: {
  readonly series: readonly Series[];
  readonly rows: readonly StackRow[];
  readonly format: (value: number) => string;
  readonly label: string;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hot, setHot] = useState<{ row: string; series: string } | null>(null);
  const max = Math.max(1, ...props.rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0)));
  const colorOf = (id: string): string =>
    props.series.find((s) => s.id === id)?.color ?? "var(--viz-pass)";
  const labelOf = (id: string): string => props.series.find((s) => s.id === id)?.label ?? id;
  const hotRow = hot === null ? null : props.rows.find((r) => r.id === hot.row);
  const hotValue = hotRow?.parts.find((p) => p.series === hot?.series)?.value ?? null;
  return (
    <div className="relative" role="group" aria-label={props.label}>
      {hot === null || hotRow === undefined || hotRow === null || hotValue === null ? null : (
        <Readout>
          <span className="text-text-secondary">
            {hotRow.name} · {labelOf(hot.series)}
          </span>{" "}
          <span className="viz-figure font-medium">{props.format(hotValue)}</span>
        </Readout>
      )}
      <div className="grid grid-cols-[minmax(7rem,11rem)_1fr_4.5rem] items-center gap-x-3 gap-y-1">
        {props.rows.map((row, ri) => {
          let x = 0;
          return (
            <div key={row.id} className="contents">
              <div className="truncate text-ui text-text-primary">{row.label}</div>
              <div ref={ri === 0 ? ref : undefined} className="h-7 min-w-0">
                <svg
                  role="img"
                  aria-label={`${row.name} ${row.totalText}`}
                  width={width}
                  height={28}
                  className="viz-hoverable block"
                  {...(hot?.row === row.id ? { "data-viz-hot": "" } : {})}
                >
                  <rect x={0} y={11} width={width} height={6} rx={3} fill="var(--viz-track)" />
                  {row.parts
                    .filter((p) => p.value > 0)
                    .map((p, i, parts) => {
                      const w = Math.max(
                        2,
                        (p.value / max) * width - (i < parts.length - 1 ? 2 : 0),
                      );
                      const at = x;
                      x += w + 2;
                      return (
                        <rect
                          key={p.series}
                          data-viz-mark=""
                          {...(hot?.row === row.id && hot.series === p.series
                            ? { "data-viz-hot": "" }
                            : {})}
                          x={at}
                          y={8}
                          width={w}
                          height={12}
                          rx={i === 0 || i === parts.length - 1 ? 4 : 1.5}
                          fill={colorOf(p.series)}
                          onPointerEnter={() => {
                            setHot({ row: row.id, series: p.series });
                          }}
                          onPointerLeave={() => {
                            setHot(null);
                          }}
                        />
                      );
                    })}
                </svg>
              </div>
              <div className="viz-figure text-right text-ui text-text-secondary">
                {row.totalText}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────── 날별 기둥 ─────────

export interface ColumnPoint {
  readonly id: string;
  /** 눈금 글(짧게) */
  readonly tick: string;
  /** 올린 값의 머리(긴 날짜) */
  readonly title: string;
  readonly parts: readonly { readonly series: string; readonly value: number }[];
}

/**
 * 날마다 세로 기둥(갈래를 쌓는다). 축은 하나다. 값이 0인 날은 바닥 선만 남는다.
 * 기둥이 많으면 눈금 글을 건너뛴다.
 */
export function Columns(props: {
  readonly series: readonly Series[];
  readonly points: readonly ColumnPoint[];
  readonly height: number;
  readonly label: string;
  readonly format: (value: number) => string;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hot, setHot] = useState<string | null>(null);
  const axisW = 28;
  const plotW = Math.max(40, width - axisW);
  // 맨 위 눈금 글자가 잘리지 않게 위에 8px를 둔다
  const plotH = props.height - 26;
  const max = Math.max(1, ...props.points.map((p) => p.parts.reduce((s, x) => s + x.value, 0)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const n = Math.max(1, props.points.length);
  const slot = plotW / n;
  const bar = Math.max(3, Math.min(28, slot * 0.62));
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const colorOf = (id: string): string =>
    props.series.find((s) => s.id === id)?.color ?? "var(--viz-pass)";
  const hotPoint = props.points.find((p) => p.id === hot) ?? null;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return (
    <div ref={ref} className="relative">
      {hotPoint === null ? null : (
        <Readout>
          <div className="mb-0.5 text-text-tertiary">{hotPoint.title}</div>
          {hotPoint.parts.map((p) => (
            <div key={p.series} className="flex items-center gap-1.5">
              <Swatch color={colorOf(p.series)} />
              <span className="text-text-secondary">
                {props.series.find((s) => s.id === p.series)?.label ?? p.series}
              </span>
              <span className="viz-figure ml-auto pl-3 font-medium">{props.format(p.value)}</span>
            </div>
          ))}
        </Readout>
      )}
      <svg
        role="img"
        aria-label={props.label}
        width={width}
        height={props.height}
        className="viz-hoverable block"
        {...(hot === null ? {} : { "data-viz-hot": "" })}
      >
        <g transform="translate(0 8)">
          {ticks.map((v) => {
            const y = plotH - (v / top) * plotH + 0.5;
            return (
              <g key={v}>
                <line className="viz-gridline" x1={axisW} x2={width} y1={y} y2={y} />
                <text className="viz-axis viz-figure" x={axisW - 6} y={y + 3.5} textAnchor="end">
                  {props.format(v)}
                </text>
              </g>
            );
          })}
          {props.points.map((p, i) => {
            const cx = axisW + slot * i + slot / 2;
            let y = plotH;
            return (
              <g
                key={p.id}
                data-viz-mark=""
                {...(hot === p.id ? { "data-viz-hot": "" } : {})}
                onPointerEnter={() => {
                  setHot(p.id);
                }}
                onPointerLeave={() => {
                  setHot(null);
                }}
              >
                <rect x={cx - slot / 2} y={0} width={slot} height={plotH} fill="transparent" />
                {p.parts
                  .filter((part) => part.value > 0)
                  .map((part, pi, parts) => {
                    const h = Math.max(
                      2,
                      (part.value / top) * plotH - (pi < parts.length - 1 ? 2 : 0),
                    );
                    y -= h;
                    const rectY = y;
                    y -= 2;
                    const last = pi === parts.length - 1;
                    return (
                      <rect
                        key={part.series}
                        x={cx - bar / 2}
                        y={rectY}
                        width={bar}
                        height={h}
                        rx={last ? Math.min(4, bar / 2) : 1}
                        fill={colorOf(part.series)}
                      />
                    );
                  })}
                {i % every === 0 ? (
                  <text className="viz-axis" x={cx} y={plotH + 15} textAnchor="middle">
                    {p.tick}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/** 눈금 간격: 1·2·5 × 10^k 가운데 칸이 네 개쯤 되는 것 */
export function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return Math.max(1, m * pow);
  }
  return Math.max(1, 10 * pow);
}

// ───────── 두 값 나란히(버전 전후) ─────────

export interface PairRow {
  readonly id: string;
  readonly label: string;
  readonly a: number | null;
  readonly b: number | null;
  readonly aText: string;
  readonly bText: string;
}

/** 지표마다 앞 버전(옅은 먹)과 지금 버전(진한 먹) 막대 둘. 값이 없는 쪽은 빗금 칸과 글로 둔다 */
export function PairBars(props: {
  readonly rows: readonly PairRow[];
  readonly aLabel: string;
  readonly bLabel: string;
  readonly label: string;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  return (
    <div role="group" aria-label={props.label} className="grid gap-2">
      <Legend
        series={[
          { id: "a", label: props.aLabel, color: "var(--viz-pass)" },
          { id: "b", label: props.bLabel, color: "var(--viz-asked)" },
        ]}
      />
      <div className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-x-3 gap-y-2">
        {props.rows.map((row, ri) => {
          const max = Math.max(row.a ?? 0, row.b ?? 0, 1e-9);
          return (
            <div key={row.id} className="contents">
              <div className="text-ui text-text-secondary">{row.label}</div>
              <div ref={ri === 0 ? ref : undefined} className="grid min-w-0 gap-1">
                {(["a", "b"] as const).map((side) => {
                  const v = side === "a" ? row.a : row.b;
                  const text = side === "a" ? row.aText : row.bText;
                  const w = v === null ? 0 : Math.max(2, (v / max) * (width - 72));
                  return (
                    <div key={side} className="flex items-center gap-2">
                      {v === null ? (
                        <span className="viz-hatch h-2 w-10 rounded-[3px]" aria-hidden="true" />
                      ) : (
                        <svg width={w} height={8} aria-hidden="true" className="block shrink-0">
                          <rect
                            width={w}
                            height={8}
                            rx={3}
                            fill={side === "a" ? "var(--viz-pass)" : "var(--viz-asked)"}
                          />
                        </svg>
                      )}
                      <span className="viz-figure text-ui-sm text-text-secondary">{text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
