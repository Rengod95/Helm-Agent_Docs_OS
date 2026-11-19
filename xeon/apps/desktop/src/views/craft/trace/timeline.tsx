// 트레이스의 시간 순서 그림. 줄 다섯(모델, Hook, 도구, 사람에게 묻기, Drive)에 턴 시작부터의 구간을 놓는다.
// 겹치는 구간은 같은 줄 안에서 아랫단으로 내린다. 단계 경계는 세로 점선이다. 올리면 오른쪽 위에 값이 뜬다.
// 색: 모델은 먹, 도구·Drive는 종류 색, Hook은 결과를 먹의 진하기로(막음이 가장 진함, 고장은 위험 글자색), 묻기는 빗금.
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { useRef, useState, type ReactNode } from "react";
import {
  ChartTable,
  FigureToggle,
  placeAlong,
  Legend,
  Readout,
  niceStep,
  useWidth,
  type Series,
} from "../metrics/charts.tsx";
import { msText } from "../metrics/format.ts";
import { KIND_COLOR } from "../metrics/glyphs.tsx";
import { LANES, type Lane, type Outcome, type Span } from "./model.ts";

const LANE_WORD: Readonly<Record<Lane, MessageId>> = {
  model: "desktop.craft.trace.lane.model",
  hook: "desktop.craft.trace.lane.hook",
  tool: "desktop.craft.trace.lane.tool",
  ask: "desktop.craft.trace.lane.ask",
  drive: "desktop.craft.trace.lane.drive",
};

export const OUTCOME_WORD: Readonly<Record<Outcome, MessageId>> = {
  pass: "desktop.craft.trace.outcome.pass",
  modified: "desktop.craft.trace.outcome.modified",
  asked: "desktop.craft.trace.outcome.asked",
  blocked: "desktop.craft.trace.outcome.blocked",
  error: "desktop.craft.trace.outcome.error",
  timeout: "desktop.craft.trace.outcome.timeout",
  skipped: "desktop.craft.trace.outcome.skipped",
};

export function outcomeColor(outcome: Outcome): string {
  switch (outcome) {
    case "pass":
    case "skipped":
      return "var(--viz-pass)";
    case "modified":
      return "var(--viz-modified)";
    case "asked":
      return "var(--viz-asked)";
    case "blocked":
      return "var(--viz-blocked)";
    case "error":
    case "timeout":
      return "var(--viz-fault)";
    default:
      return assertNever(outcome, "Outcome");
  }
}

function laneColor(span: Span): string {
  switch (span.lane) {
    case "model":
      return "var(--viz-model)";
    case "hook":
      return span.outcome === null ? KIND_COLOR.hook : outcomeColor(span.outcome);
    case "tool":
      return KIND_COLOR.tool;
    case "ask":
      return "url(#trace-hatch)";
    case "drive":
      return KIND_COLOR.drive;
    default:
      return assertNever(span.lane, "Lane");
  }
}

/** 같은 줄에서 겹치는 구간을 아랫단으로 내린다(탐욕 배치). 단 수는 `max`까지, 넘치면 맨 아랫단에 겹친다 */
/** 첫 기록 시각. 턴 길이의 4분의 1보다 늦게 시작할 때만 그 조금 앞을 돌려주고, 아니면 0 */
function recordedFrom(
  spans: readonly Span[],
  steps: readonly { readonly atMs: number }[],
  length: number,
): number {
  const first = Math.min(...spans.map((s) => s.startMs), ...steps.map((s) => s.atMs));
  if (!Number.isFinite(first) || first <= length / 4) return 0;
  return Math.max(0, first - (length - first) * 0.04);
}

export function packRows(
  spans: readonly Span[],
  end: number,
  minMs: number,
  max: number,
): Map<string, number> {
  const rows: number[] = [];
  const out = new Map<string, number>();
  for (const s of spans.toSorted((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))) {
    const stop = Math.max(s.endMs ?? end, s.startMs + minMs);
    let row = rows.findIndex((free) => free <= s.startMs);
    if (row === -1) row = rows.length < max ? rows.length : max - 1;
    rows[row] = Math.max(rows[row] ?? 0, stop);
    out.set(s.id, row);
  }
  return out;
}

const LABEL_W = 76;
const ROW_H = 14;
const BAR_H = 10;
const LANE_GAP = 10;
const AXIS_H = 20;
const MAX_ROWS = 4;

export interface TimelineProps {
  readonly spans: readonly Span[];
  readonly lengthMs: number;
  readonly steps: readonly { readonly step: number; readonly atMs: number }[];
  readonly live: boolean;
  readonly label: string;
}

export function Timeline(props: TimelineProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hot, setHot] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const plot = Math.max(80, width - LABEL_W - 8);
  const length = Math.max(1, props.lengthMs);
  // 기록이 턴 중간부터 있으면(다시 시작된 턴 등) 축을 첫 기록에서 시작하고, 그 앞은 기록되지 않았다고 적는다
  const from = recordedFrom(props.spans, props.steps, length);
  const view = Math.max(1, length - from);
  const x = (ms: number): number =>
    LABEL_W + ((Math.min(Math.max(ms, from), length) - from) / view) * plot;
  // 짧은 구간(Hook은 대개 몇 ms)도 5px로 보이게 한다. 배치는 그 둘레 7px를 차지한 것으로 본다
  const minMs = (7 / plot) * view;

  const lanes = LANES.map((lane) => {
    const spans = props.spans.filter((s) => s.lane === lane);
    const rows = packRows(spans, length, minMs, MAX_ROWS);
    const depth = Math.max(1, ...[...rows.values()].map((r) => r + 1));
    return { lane, spans, rows, depth };
  }).filter(
    (l) => l.spans.length > 0 || l.lane === "model" || l.lane === "hook" || l.lane === "tool",
  );
  const tops = placeAlong(
    lanes.map((l) => l.depth * ROW_H),
    LANE_GAP,
  );
  const placed = lanes.map((l, i) => ({ lane: l, top: tops[i]?.x ?? 0 }));
  const last = tops.at(-1);
  const height = (last === undefined ? 0 : last.x + last.w + LANE_GAP) + AXIS_H;
  const step = niceStep(view);
  const ticks: number[] = [];
  for (let at = from === 0 ? 0 : Math.ceil(from / step) * step; at <= length; at += step)
    ticks.push(at);
  const hotSpan = props.spans.find((s) => s.id === hot) ?? null;

  const series: Series[] = [
    { id: "model", label: t("desktop.craft.trace.lane.model"), color: "var(--viz-model)" },
    { id: "tool", label: t("desktop.craft.trace.lane.tool"), color: KIND_COLOR.tool },
    { id: "drive", label: t("desktop.craft.trace.lane.drive"), color: KIND_COLOR.drive },
    { id: "pass", label: t(OUTCOME_WORD.pass), color: outcomeColor("pass") },
    { id: "modified", label: t(OUTCOME_WORD.modified), color: outcomeColor("modified") },
    { id: "asked", label: t(OUTCOME_WORD.asked), color: outcomeColor("asked") },
    { id: "blocked", label: t(OUTCOME_WORD.blocked), color: outcomeColor("blocked") },
    { id: "fault", label: t("desktop.craft.trace.outcome.fault"), color: outcomeColor("error") },
    { id: "ask", label: t("desktop.craft.trace.lane.ask"), color: "", hatch: true },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <Legend series={series} />
        <div className="ml-auto">
          <FigureToggle
            table={table}
            onToggle={() => {
              setTable((v) => !v);
            }}
          />
        </div>
      </div>
      {table ? (
        <ChartTable
          caption={props.label}
          columns={[
            { id: "lane", label: t("desktop.craft.trace.col.lane") },
            { id: "what", label: t("desktop.craft.trace.col.what") },
            { id: "at", label: t("desktop.craft.trace.col.at"), numeric: true },
            { id: "len", label: t("desktop.craft.trace.col.length"), numeric: true },
            { id: "outcome", label: t("desktop.craft.trace.col.outcome") },
          ]}
          rows={props.spans
            .toSorted((a, b) => a.startMs - b.startMs)
            .map((s) => ({
              id: s.id,
              cells: [
                t(LANE_WORD[s.lane]),
                s.label,
                msText(s.startMs),
                s.endMs === null ? t("desktop.craft.trace.running") : msText(s.endMs - s.startMs),
                s.outcome === null ? "" : t(OUTCOME_WORD[s.outcome]),
              ],
            }))}
        />
      ) : (
        <div ref={ref} className="relative">
          {hotSpan === null ? null : (
            <Readout>
              <span className="text-text-secondary">{t(LANE_WORD[hotSpan.lane])}</span>{" "}
              <span className="font-medium">{hotSpan.label}</span>
              {hotSpan.outcome === null ? null : (
                <span className="text-text-secondary"> · {t(OUTCOME_WORD[hotSpan.outcome])}</span>
              )}{" "}
              <span className="viz-figure text-text-secondary">
                {msText(hotSpan.startMs)} +{" "}
                {hotSpan.endMs === null
                  ? t("desktop.craft.trace.running")
                  : msText(hotSpan.endMs - hotSpan.startMs)}
              </span>
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
                id="trace-hatch"
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" fill="var(--viz-track)" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--viz-asked)" strokeWidth="1.5" />
              </pattern>
            </defs>
            {ticks.map((at) => (
              <g key={at}>
                <line
                  className="viz-gridline"
                  x1={x(at)}
                  x2={x(at)}
                  y1={0}
                  y2={height - AXIS_H + 2}
                />
                <text
                  className="viz-axis viz-figure"
                  x={x(at)}
                  y={height - 6}
                  textAnchor={x(at) - LABEL_W < 24 ? "start" : "middle"}
                >
                  {msText(at)}
                </text>
              </g>
            ))}
            {props.steps.map((s) => (
              <line
                key={`s${String(s.step)}`}
                x1={x(s.atMs)}
                x2={x(s.atMs)}
                y1={0}
                y2={height - AXIS_H + 2}
                stroke="var(--cs-color-text-tertiary)"
                strokeDasharray="2 3"
                strokeWidth="1"
              />
            ))}
            {placed.map(({ lane: l, top }) => (
              <g key={l.lane}>
                <text className="viz-axis" x={0} y={top + BAR_H} style={{ fontSize: 12 }}>
                  {t(LANE_WORD[l.lane])}
                </text>
                <rect
                  x={LABEL_W}
                  y={top}
                  width={plot}
                  height={l.depth * ROW_H - (ROW_H - BAR_H)}
                  rx={3}
                  fill="var(--viz-track)"
                  opacity={0.5}
                />
                {l.spans.map((s) => {
                  const row = l.rows.get(s.id) ?? 0;
                  const x0 = x(s.startMs);
                  const x1 = Math.max(x0 + 5, x(s.endMs ?? length));
                  const open = s.endMs === null;
                  return (
                    <rect
                      key={s.id}
                      data-viz-mark=""
                      {...(hot === s.id ? { "data-viz-hot": "" } : {})}
                      className={open && props.live ? "viz-live" : undefined}
                      x={x0}
                      y={top + row * ROW_H}
                      width={x1 - x0}
                      height={BAR_H}
                      rx={2}
                      fill={laneColor(s)}
                      onPointerEnter={() => {
                        setHot(s.id);
                      }}
                      onPointerLeave={() => {
                        setHot(null);
                      }}
                    >
                      <title>{`${t(LANE_WORD[s.lane])} ${s.label}`}</title>
                    </rect>
                  );
                })}
              </g>
            ))}
          </svg>
          {from > 0 ? (
            <p
              className="mt-1 text-ui-sm text-text-tertiary"
              style={{ paddingInlineStart: LABEL_W }}
            >
              {t("desktop.craft.trace.timeline.cut", { d: msText(from) })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
