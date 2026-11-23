// 메트릭과 트레이스의 그림 부품. 새 차트 라이브러리를 받지 않고 SVG로 직접 그린다(의존 목록에 차트 라이브러리가 없다).
// 규칙(dataviz): 가는 표식, 칸 사이 2px 틈, 2개 이상 갈래면 범례, 글자는 글자 토큰(색은 표식만), 올리면 값이 뜬다,
// 모든 그림에 같은 내용의 표(`ChartTable`)가 있다. 색은 `viz.css`의 종류 색과 먹 단계뿐이다.
import { t } from "@fresnel/client/i18n";
import { Button } from "@caustic/react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { LINE_GLYPH } from "../../illustrations/line-glyph.ts";

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
  /** 칸의 결. `solid`(기본)는 꽉 찬 색, `dense`·`sparse`는 점 결이다(Hook 결정의 갈래) */
  readonly texture?: Texture;
  /** 범례의 색 칸 대신 쓰는 그림(Hook 결정의 점 구슬) */
  readonly mark?: ReactNode;
}

export type Texture = "solid" | "dense" | "sparse";

/** 점 결의 칸 간격(px)과 점 반지름. 촘촘한 결은 물음, 성긴 결은 고침이다 */
const TEXTURE_STEP: Readonly<Record<Exclude<Texture, "solid">, number>> = { dense: 3, sparse: 5 };

/** 한 SVG 안의 점 결 정의. `prefix`는 그 SVG의 고유 id(같은 화면의 그림끼리 겹치지 않게) */
function TextureDefs(props: {
  readonly prefix: string;
  readonly series: readonly Series[];
}): ReactNode {
  return (
    <defs>
      {props.series
        .filter((s) => s.texture === "dense" || s.texture === "sparse")
        .map((s) => {
          const step = s.texture === "dense" ? TEXTURE_STEP.dense : TEXTURE_STEP.sparse;
          return (
            <pattern
              key={s.id}
              id={`${props.prefix}-${s.id}`}
              width={step}
              height={step}
              patternUnits="userSpaceOnUse"
            >
              <rect
                width={step}
                height={step}
                style={{ fill: `color-mix(in oklab, ${s.color} 32%, transparent)` }}
              />
              <circle
                cx={step / 2}
                cy={step / 2}
                r={step === TEXTURE_STEP.dense ? 1.05 : 1.3}
                fill={s.color}
              />
            </pattern>
          );
        })}
    </defs>
  );
}

/** 갈래의 칠: 결이 있으면 그 결의 무늬, 아니면 색 */
function fillOf(prefix: string, series: Series | undefined): string {
  if (series === undefined) return "var(--viz-pass)";
  if (series.texture === "dense" || series.texture === "sparse") {
    return `url(#${prefix}-${series.id})`;
  }
  return series.color;
}

export function Swatch(props: {
  readonly color: string;
  readonly hatch?: boolean;
  readonly texture?: Texture;
}): ReactNode {
  if (props.texture === "dense" || props.texture === "sparse") {
    const step = props.texture === "dense" ? 3 : 5;
    return (
      <span
        aria-hidden="true"
        className="inline-block size-2.5 shrink-0 rounded-[3px]"
        style={{
          backgroundColor: `color-mix(in oklab, ${props.color} 32%, transparent)`,
          backgroundImage: `radial-gradient(${props.color} 1px, transparent 1.2px)`,
          backgroundSize: `${String(step)}px ${String(step)}px`,
          backgroundPosition: "center",
        }}
      />
    );
  }
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
          {s.mark ?? (
            <Swatch
              color={s.color}
              {...(s.hatch === true ? { hatch: true } : {})}
              {...(s.texture === undefined ? {} : { texture: s.texture })}
            />
          )}
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
  /** 고른 칸. 다른 칸은 물러난다 */
  readonly picked?: string | null;
  /** 칸을 누르면 부른다(같은 일을 하는 단추가 그림 밖에도 있어야 한다: 키보드) */
  readonly onPick?: (id: string) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hovered, setHot] = useState<string | null>(null);
  const hot = hovered ?? props.picked ?? null;
  const pick = props.onPick;
  const height = props.height ?? 20;
  // 띠 양끝의 반경은 높이에 비례한다(32 → 7, 24 → 5, 20 → 4). 판(rounded-2xl)과 같은 부드러움으로 보이게(m6X3). SVG라 squircle은 없다
  const endRadius = Math.max(4, Math.round(height * 0.22));
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
          <rect width={width} height={height} rx={endRadius} fill="var(--viz-track)" />
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
              rx={i === 0 || i === placed.length - 1 ? endRadius : 1.5}
              fill={s.hatch === true ? "url(#viz-hatch)" : s.color}
              {...(pick === undefined || s.id.startsWith("__")
                ? {}
                : {
                    className: "cursor-pointer",
                    onClick: () => {
                      pick(s.id);
                    },
                  })}
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
                <div className="truncate text-text-primary">{s.valueText}</div>
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
  /** 고른 줄. 다른 줄은 물러난다 */
  readonly picked?: string | null;
  /** 줄 이름을 단추로 만든다(누르면 그 줄을 고른다) */
  readonly onPick?: (id: string) => void;
  /** 줄 이름 단추의 화면 읽기 이름 */
  readonly pickLabel?: (name: string) => string;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hot, setHot] = useState<{ row: string; series: string } | null>(null);
  const picked = props.picked ?? null;
  const pick = props.onPick;
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
          <span className="inline-flex items-baseline gap-2">
            <span className="text-text-secondary">{hotRow.name}</span>{" "}
            <span className="text-text-secondary">{labelOf(hot.series)}</span>{" "}
            <span className="viz-figure font-medium">{props.format(hotValue)}</span>
          </span>
        </Readout>
      )}
      <div className="grid grid-cols-[minmax(7rem,11rem)_1fr_4.5rem] items-center gap-x-3 gap-y-1">
        {props.rows.map((row, ri) => {
          let x = 0;
          return (
            <div
              key={row.id}
              className={`contents ${picked !== null && picked !== row.id ? "[&>*]:opacity-45" : ""}`}
            >
              {pick === undefined ? (
                <div className="truncate text-ui text-text-primary">{row.label}</div>
              ) : (
                <button
                  type="button"
                  aria-pressed={picked === row.id}
                  aria-label={props.pickLabel?.(row.name) ?? row.name}
                  className={`-mx-1.5 flex h-7 min-w-0 items-center rounded-md border-0 bg-transparent px-1.5 py-0 text-left text-ui hover:bg-neutral-hover outline-none focus-visible:focus-ring ${picked === row.id ? "font-medium text-text-primary" : "text-text-primary"}`}
                  onClick={() => {
                    pick(row.id);
                  }}
                >
                  <span className="min-w-0 truncate">{row.label}</span>
                </button>
              )}
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
  /** 값을 낼 수 없는 날(표본 부족). 0 기둥 대신 빗금 칸을 세운다 */
  readonly missing?: string;
  /** 올린 값 아래에 덧붙이는 한 줄(값의 출처 등) */
  readonly note?: string;
}

/**
 * 날마다 세로 기둥(갈래를 쌓는다). 축은 하나다. 값이 0인 날은 바닥 선만 남는다.
 * 기둥이 많으면 눈금 글을 건너뛴다. `onPick`이 있으면 기둥이 단추가 된다(키보드: 탭과 Enter·Space).
 */
export function Columns(props: {
  readonly series: readonly Series[];
  readonly points: readonly ColumnPoint[];
  readonly height: number;
  readonly label: string;
  readonly format: (value: number) => string;
  readonly picked?: string | null;
  readonly onPick?: (id: string) => void;
  /** 기둥 단추의 이름(화면 읽기). 날짜 뒤에 붙는다 */
  readonly pickLabel?: string;
  /** 왼쪽 눈금 글 칸의 너비(px). 눈금 글이 길면 넓히고, 위아래로 놓인 차트끼리 같은 값을 주어 기둥 줄을 맞춘다 */
  readonly axisWidth?: number;
  /** 눈금 글. 없으면 `format`이다 */
  readonly tickFormat?: (value: number) => string;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const prefix = `viz${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [hot, setHot] = useState<string | null>(null);
  const axisW = props.axisWidth ?? 28;
  const tickText = props.tickFormat ?? props.format;
  const plotW = Math.max(40, width - axisW);
  // 맨 위 눈금 글자가 잘리지 않게 위에 8px를 둔다
  const plotH = props.height - 26;
  const max = Math.max(1, ...props.points.map((p) => p.parts.reduce((s, x) => s + x.value, 0)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const n = Math.max(1, props.points.length);
  const slot = plotW / n;
  const bar = Math.max(3, Math.min(32, slot * 0.62));
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const seriesOf = (id: string): Series | undefined => props.series.find((s) => s.id === id);
  const hotPoint = props.points.find((p) => p.id === hot) ?? null;
  const picked = props.picked ?? null;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const pick = props.onPick;
  return (
    <div ref={ref} className="relative">
      {hotPoint === null ? null : (
        <Readout>
          <div className="mb-0.5 text-text-tertiary">{hotPoint.title}</div>
          {hotPoint.missing === undefined ? (
            hotPoint.parts.map((p) => {
              const s = seriesOf(p.series);
              return (
                <div key={p.series} className="flex items-center gap-1.5">
                  {s?.mark ?? (
                    <Swatch
                      color={s?.color ?? "var(--viz-pass)"}
                      {...(s?.texture === undefined ? {} : { texture: s.texture })}
                    />
                  )}
                  <span className="text-text-secondary">{s?.label ?? p.series}</span>
                  <span className="viz-figure ml-auto pl-3 font-medium">
                    {props.format(p.value)}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="text-text-secondary">{hotPoint.missing}</div>
          )}
          {hotPoint.note === undefined ? null : (
            <div className="mt-0.5 text-text-tertiary">{hotPoint.note}</div>
          )}
        </Readout>
      )}
      <svg
        role={pick === undefined ? "img" : "group"}
        aria-label={props.label}
        width={width}
        height={props.height}
        className="viz-hoverable block"
        {...(hot === null && picked === null ? {} : { "data-viz-hot": "" })}
      >
        <TextureDefs prefix={prefix} series={props.series} />
        <g transform="translate(0 8)">
          {ticks.map((v) => {
            const y = plotH - (v / top) * plotH + 0.5;
            return (
              <g key={v}>
                <line className="viz-gridline" x1={axisW} x2={width} y1={y} y2={y} />
                <text className="viz-axis viz-figure" x={axisW - 6} y={y + 3.5} textAnchor="end">
                  {tickText(v)}
                </text>
              </g>
            );
          })}
          {props.points.map((p, i) => {
            const cx = axisW + slot * i + slot / 2;
            let y = plotH;
            const lit = hot === p.id || picked === p.id;
            const body = (
              <>
                <rect
                  x={cx - slot / 2}
                  y={0}
                  width={slot}
                  height={plotH}
                  rx={6}
                  fill={picked === p.id ? "var(--viz-track)" : "transparent"}
                />
                {p.missing === undefined ? (
                  p.parts
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
                          fill={fillOf(prefix, seriesOf(part.series))}
                        />
                      );
                    })
                ) : (
                  <rect
                    x={cx - bar / 2}
                    y={plotH - 10}
                    width={bar}
                    height={10}
                    rx={2}
                    fill="url(#viz-hatch-col)"
                    stroke="var(--viz-grid)"
                  />
                )}
                {i % every === 0 || picked === p.id ? (
                  <text
                    className="viz-axis"
                    x={cx}
                    y={plotH + 15}
                    textAnchor="middle"
                    style={picked === p.id ? { fill: "var(--cs-color-text-primary)" } : undefined}
                  >
                    {p.tick}
                  </text>
                ) : null}
              </>
            );
            const common = {
              "data-viz-mark": "",
              ...(lit ? { "data-viz-hot": "" } : {}),
              onPointerEnter: () => {
                setHot(p.id);
              },
              onPointerLeave: () => {
                setHot(null);
              },
            };
            if (pick === undefined) {
              return (
                <g key={p.id} {...common}>
                  {body}
                </g>
              );
            }
            return (
              <g
                key={p.id}
                {...common}
                role="button"
                tabIndex={0}
                aria-pressed={picked === p.id}
                aria-label={`${p.title} ${props.pickLabel ?? ""}`.trim()}
                className="viz-pick cursor-pointer outline-none"
                onFocus={() => {
                  setHot(p.id);
                }}
                onBlur={() => {
                  setHot(null);
                }}
                onClick={() => {
                  pick(p.id);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  pick(p.id);
                }}
              >
                {body}
              </g>
            );
          })}
        </g>
        <defs>
          <pattern
            id="viz-hatch-col"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--viz-grid)" strokeWidth="2" />
          </pattern>
        </defs>
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
    <div role="group" aria-label={props.label} className="grid grid-cols-1 gap-2">
      <Legend
        series={[
          { id: "a", label: props.aLabel, color: "var(--viz-pass)" },
          { id: "b", label: props.bLabel, color: "var(--viz-ink-2)" },
        ]}
      />
      <div className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-x-3 gap-y-2">
        {props.rows.map((row, ri) => {
          const max = Math.max(row.a ?? 0, row.b ?? 0, 1e-9);
          return (
            <div key={row.id} className="contents">
              <div className="text-ui text-text-secondary">{row.label}</div>
              <div ref={ri === 0 ? ref : undefined} className="grid grid-cols-1 min-w-0 gap-1">
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
                            fill={side === "a" ? "var(--viz-pass)" : "var(--viz-ink-2)"}
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

// ───────── 머리 숫자의 작은 그림 ─────────
// 축 없는 작은 그림(AGE-36 넷째 판). 값은 올리면 읽힌다: 그림은 고른 칸(`hot`)을 알리고, 칸 위의 숫자 자리가 그 값과 날로 바뀐다(`kpi.tsx`).
// 표식은 아래 큰 그림들과 한 식구다: 턴은 중립 먹, 막음·물음은 Hook 결정의 색과 결(꽉 찬 먹·촘촘한 점), 컨텍스트는 먹의 선.

/** 위 모서리만 둥근 기둥(바닥에 붙은 쪽은 각지게) */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(2, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** 칸 고르기: 포인터의 x를 칸 번호로 */
function slotAt(clientX: number, el: SVGSVGElement, n: number): number {
  const box = el.getBoundingClientRect();
  const at = Math.floor(((clientX - box.left) / Math.max(1, box.width)) * n);
  return Math.max(0, Math.min(n - 1, at));
}

/** 작은 기둥의 가장 큰 너비(px). 날이 적어 칸이 넓어도 기둥은 가늘게 두고 칸 가운데에 선다(선 그림의 점과 같은 x) */
const MINI_BAR_MAX = 20;

/**
 * 날마다 작은 기둥. 값이 0인 날은 바닥 선만, 값을 낼 수 없는 날(null)은 낮은 빗금 칸이다. 기둥 사이 틈은 2px(날이 많으면 1px).
 * 올린 날의 기둥만 남고 나머지는 물러난다
 */
export function MiniColumns(props: {
  readonly series: Series;
  /** 날마다 한 칸(`id`는 날) */
  readonly points: readonly { readonly id: string; readonly value: number | null }[];
  readonly height: number;
  readonly label: string;
  readonly hot: number | null;
  readonly onHot: (index: number | null) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const prefix = `viz${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const n = Math.max(1, props.points.length);
  const slot = width / n;
  const gap = n > 20 ? 1 : 2;
  const bar = Math.max(1, Math.min(MINI_BAR_MAX, slot - gap));
  const max = Math.max(1, ...props.points.map((p) => p.value ?? 0));
  const h = props.height;
  return (
    <div ref={ref} className="min-w-0">
      <svg
        role="img"
        aria-label={props.label}
        width={width}
        height={h}
        className="viz-hoverable block touch-none"
        {...(props.hot === null ? {} : { "data-viz-hot": "" })}
        onPointerMove={(e) => {
          props.onHot(slotAt(e.clientX, e.currentTarget, n));
        }}
        onPointerLeave={() => {
          props.onHot(null);
        }}
      >
        <TextureDefs prefix={prefix} series={[props.series]} />
        {props.points.map((p, i) => {
          const v = p.value;
          const x = i * slot + (slot - bar) / 2;
          const mark = {
            "data-viz-mark": "",
            ...(props.hot === i ? { "data-viz-hot": "" } : {}),
          };
          if (v === null) {
            return (
              <rect
                key={p.id}
                {...mark}
                x={x}
                y={h - 7}
                width={bar}
                height={6}
                rx={1}
                fill="url(#viz-hatch-mini)"
              />
            );
          }
          if (v <= 0) return null;
          const bh = Math.max(2, (v / max) * (h - 2));
          return (
            <path
              key={p.id}
              {...mark}
              d={columnPath(x, h - 1 - bh, bar, bh)}
              fill={fillOf(prefix, props.series)}
            />
          );
        })}
        <line className="viz-gridline" x1={0} x2={width} y1={h - 0.5} y2={h - 0.5} />
        <defs>
          <pattern
            id="viz-hatch-mini"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--viz-ink-1)" strokeWidth="1.5" />
          </pattern>
        </defs>
      </svg>
    </div>
  );
}

/** 점 고르기: 양끝에 점이 서는 선에서 포인터에 가장 가까운 점의 번호 */
function nearestAt(clientX: number, el: SVGSVGElement, n: number, inset: number): number {
  if (n <= 1) return 0;
  const box = el.getBoundingClientRect();
  const at = Math.round(
    ((clientX - box.left - inset) / Math.max(1, box.width - inset * 2)) * (n - 1),
  );
  return Math.max(0, Math.min(n - 1, at));
}

/**
 * 날마다 한 점을 잇는 흐름 선(값의 크기가 아니라 오르내림을 본다: 바닥은 0이 아니라 가장 낮은 값 근처다).
 * 값이 없는 날에서 선이 끊긴다. 마지막 점에 표지를 두고, 올린 날에는 세로 선과 점이 선다
 */
export function MiniLine(props: {
  readonly values: readonly (number | null)[];
  readonly height: number;
  readonly label: string;
  readonly hot: number | null;
  readonly onHot: (index: number | null) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const n = Math.max(1, props.values.length);
  const known = props.values.filter((v): v is number => v !== null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const pad = Math.max((hi - lo) * 0.2, hi * 0.05, 1);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const h = props.height;
  const inset = 4;
  const xOf = (i: number): number =>
    n === 1 ? width / 2 : inset + (i / (n - 1)) * (width - inset * 2);
  const yOf = (v: number): number =>
    inset + (1 - (v - min) / Math.max(1, max - min)) * (h - inset * 2);
  const runs: { i: number; v: number }[][] = [];
  props.values.forEach((v, i) => {
    if (v === null) {
      runs.push([]);
      return;
    }
    const last = runs.at(-1);
    if (last === undefined) runs.push([{ i, v }]);
    else last.push({ i, v });
  });
  const paths = runs.filter((r) => r.length > 0);
  const lastIndex = props.values.findLastIndex((v) => v !== null);
  const lastValue = props.values[lastIndex] ?? null;
  const hotValue = props.hot === null ? null : (props.values[props.hot] ?? null);
  return (
    <div ref={ref} className="min-w-0">
      <svg
        role="img"
        aria-label={props.label}
        width={width}
        height={h}
        className="block touch-none"
        onPointerMove={(e) => {
          props.onHot(nearestAt(e.clientX, e.currentTarget, n, inset));
        }}
        onPointerLeave={() => {
          props.onHot(null);
        }}
      >
        {paths.map((run) => {
          const line = run.map((p, k) => `${k === 0 ? "M" : "L"}${xOf(p.i)},${yOf(p.v)}`).join("");
          const first = run[0];
          const end = run.at(-1);
          if (first === undefined || end === undefined) return null;
          return (
            <g key={String(first.i)}>
              {run.length > 1 ? (
                <path
                  d={`${line}L${xOf(end.i)},${h}L${xOf(first.i)},${h}Z`}
                  style={{ fill: "color-mix(in oklab, var(--viz-ink-2) 12%, transparent)" }}
                />
              ) : null}
              {/* 추이 선은 직접 그린 선의 한 벌(화면 1px, AGE-34). 굵기를 줄인 만큼 색을 한 단계 올려(ink-2 → ink-3) 격자선(8%)과 고른 세로선에서 떨어진다 */}
              <path
                d={line}
                fill="none"
                stroke="var(--viz-ink-3)"
                className={LINE_GLYPH.className}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
        {props.hot !== null ? (
          <line
            x1={xOf(props.hot)}
            x2={xOf(props.hot)}
            y1={0}
            y2={h}
            stroke="var(--viz-grid)"
            strokeWidth={1}
          />
        ) : null}
        {hotValue !== null && props.hot !== null ? (
          <circle
            cx={xOf(props.hot)}
            cy={yOf(hotValue)}
            r={3}
            fill="var(--viz-ink-3)"
            stroke="var(--cs-color-surface-base)"
            strokeWidth={2}
          />
        ) : lastValue !== null ? (
          <circle
            cx={xOf(lastIndex)}
            cy={yOf(lastValue)}
            r={3}
            fill="var(--viz-ink-3)"
            stroke="var(--cs-color-surface-base)"
            strokeWidth={2}
          />
        ) : null}
      </svg>
    </div>
  );
}

/** 이어 붙인 가는 띠(한 전체의 갈래). 갈래 사이 2px 틈, 양끝은 둥글다. 올린 갈래만 남는다 */
export function MiniSegments(props: {
  readonly parts: readonly {
    readonly id: string;
    readonly value: number;
    readonly color: string;
  }[];
  readonly label: string;
  readonly hot: number | null;
  readonly onHot: (index: number | null) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const total = props.parts.reduce((s, p) => s + p.value, 0);
  const shown = props.parts.filter((p) => p.value > 0);
  const room = Math.max(0, width - 2 * Math.max(0, shown.length - 1));
  const places = placeAlong(
    shown.map((p) => (total <= 0 ? 0 : Math.max(2, (p.value / total) * room))),
    2,
  );
  return (
    <div ref={ref} className="min-w-0">
      <svg
        role="img"
        aria-label={props.label}
        width={width}
        height={8}
        className="viz-hoverable block"
        {...(props.hot === null ? {} : { "data-viz-hot": "" })}
      >
        {shown.map((p, i) => {
          const at = places[i]?.x ?? 0;
          const w = places[i]?.w ?? 0;
          const index = props.parts.indexOf(p);
          return (
            <rect
              key={p.id}
              data-viz-mark=""
              {...(props.hot === index ? { "data-viz-hot": "" } : {})}
              x={at}
              y={0}
              width={w}
              height={8}
              rx={i === 0 || i === shown.length - 1 ? 4 : 1}
              fill={p.color}
              onPointerEnter={() => {
                props.onHot(index);
              }}
              onPointerLeave={() => {
                props.onHot(null);
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}

/** 전체 가운데 몫 하나(가는 미터). 바탕은 옅은 길, 채움은 중립 먹이다 */
export function MiniMeter(props: {
  readonly share: number;
  readonly label: string;
  readonly onHot: (hot: boolean) => void;
}): ReactNode {
  return (
    <div
      role="img"
      aria-label={props.label}
      className="relative h-2 min-w-0 overflow-hidden rounded-full bg-[var(--viz-track)]"
      onPointerEnter={() => {
        props.onHot(true);
      }}
      onPointerLeave={() => {
        props.onHot(false);
      }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-ink-2)]"
        style={{ width: `${String(Math.round(props.share * 1000) / 10)}%` }}
      />
    </div>
  );
}
