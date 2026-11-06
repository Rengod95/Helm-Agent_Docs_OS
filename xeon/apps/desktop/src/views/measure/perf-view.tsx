// P-20 성능 측정 첫 화면의 그림: 최근 달라진 것, 이상 신호, 읽어 볼 Turn, 플러그인 부담 표, Turn 번호 곡선.
// 값은 `perfViewOf`가 만든다. 모든 줄은 `onOpenTurn`으로 Turn 다시 보기에 내려간다. 숫자 판과 합성 점수는 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  perfViewOf,
  type BurdenRowVM,
  type ChangeVM,
  type CurvePointVM,
  type PerfViewVM,
  type SignalVM,
  type TabRead,
} from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import { Button, Table, type TableColumn } from "@caustic/react";
import type { ReactNode } from "react";
import { MUTED, TabBody } from "../workbench/tab-body.tsx";
import type { PerfInput } from "./perf-read.ts";

const SECTION = "grid gap-1.5";

function Heading(props: { readonly children: ReactNode }): ReactNode {
  return <h3 className="m-0 text-ui-sm font-semibold text-text-primary">{props.children}</h3>;
}

function numberText(value: number): string {
  return t("desktop.workbench.metrics.number", { value: Math.round(value * 100) / 100 });
}

const METRIC_TEXT: Readonly<Record<string, MessageId>> = {
  "turn:totalTokens": "desktop.measure.perf.metric.turn.totalTokens",
  "turn:usd": "desktop.measure.perf.metric.turn.usd",
  "call:firstTokenMs": "desktop.measure.perf.metric.call.firstTokenMs",
  "call:durationMs": "desktop.measure.perf.metric.call.durationMs",
};

const CHANGE_TEXT = {
  up: "desktop.measure.perf.change.up",
  down: "desktop.measure.perf.change.down",
  same: "desktop.measure.perf.change.same",
} as const satisfies Readonly<Record<ChangeVM["direction"], MessageId>>;

function changeText(change: ChangeVM): string {
  const id = METRIC_TEXT[`${change.kind}:${change.metric}`];
  return t(CHANGE_TEXT[change.direction], {
    metric: id === undefined ? `${change.kind}.${change.metric}` : t(id),
    latest: numberText(change.latest),
    before: numberText(change.before),
  });
}

const SIGNAL_TEXT = {
  problem: "desktop.measure.perf.signal.problem",
  cacheBreak: "desktop.measure.perf.signal.cacheBreak",
  heavy: "desktop.measure.perf.signal.heavy",
} as const satisfies Readonly<Record<SignalVM["kind"], MessageId>>;

function OpenButton(props: {
  readonly turnId: string;
  readonly number: number | null;
  readonly onOpenTurn: (turnId: string) => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={
        props.number === null
          ? undefined
          : t("desktop.measure.perf.openTurn", { number: props.number })
      }
      onClick={() => {
        props.onOpenTurn(props.turnId);
      }}
    >
      {props.children}
    </Button>
  );
}

function Burden(props: {
  readonly rows: readonly BurdenRowVM[];
  readonly onOpenTurn: (turnId: string) => void;
}): ReactNode {
  if (props.rows.length === 0)
    return <p className={MUTED}>{t("desktop.measure.perf.burdenNone")}</p>;
  // 읽기 전용 표: caustic Table을 ghost로, 행 사이 선 없이 쓴다(DP-26). 플러그인 이름만 그 플러그인의 가장 무거운 Turn으로 내려간다
  const byOwner = new Map(props.rows.map((row) => [row.owner, row] as const));
  const columns: TableColumn[] = [
    { key: "plugin", header: t("desktop.measure.perf.col.plugin") },
    { key: "tokens", header: t("desktop.measure.perf.col.tokens"), align: "end" },
    { key: "cost", header: t("desktop.measure.perf.col.cost"), align: "end" },
    { key: "time", header: t("desktop.measure.perf.col.time"), align: "end" },
    { key: "cache", header: t("desktop.measure.perf.col.cache"), align: "end" },
    { key: "problems", header: t("desktop.measure.perf.col.problems"), align: "end" },
  ];
  return (
    <Table
      variant="ghost"
      size="xs"
      dividers={false}
      columns={columns}
      rows={props.rows.map((row) => ({ id: row.owner }))}
      renderCell={(picked, column) => {
        const row = byOwner.get(picked.id);
        if (row === undefined) return null;
        if (column.key === "plugin") {
          return (
            <OpenButton turnId={row.worstTurnId} number={null} onOpenTurn={props.onOpenTurn}>
              {row.owner}
            </OpenButton>
          );
        }
        if (column.key === "tokens") {
          return <span className="font-mono">{numberText(row.tokensPerTurn)}</span>;
        }
        if (column.key === "cost") {
          return (
            <span className="font-mono text-text-tertiary">
              {row.costUsd === null
                ? t("desktop.measure.perf.costUnknown")
                : numberText(row.costUsd)}
            </span>
          );
        }
        if (column.key === "time") {
          return (
            <span className="font-mono">{t("desktop.measure.ms", { ms: row.msPerTurn })}</span>
          );
        }
        if (column.key === "cache") {
          return <span className="font-mono">{row.cacheEvents}</span>;
        }
        if (column.key === "problems") {
          return <span className="font-mono">{row.problems}</span>;
        }
        return null;
      }}
    />
  );
}

const CURVE_W = 320;
const CURVE_H = 64;

/** 곡선 하나. 점은 Turn 번호 순서이고 값 범위는 0부터 최댓값이다 */
function Curve(props: {
  readonly label: string;
  readonly points: readonly CurvePointVM[];
  readonly pick: (point: CurvePointVM) => number;
  readonly onOpenTurn: (turnId: string) => void;
}): ReactNode {
  const { points } = props;
  const max = Math.max(1, ...points.map(props.pick));
  const x = (index: number): number =>
    points.length <= 1 ? CURVE_W / 2 : (index / (points.length - 1)) * CURVE_W;
  const y = (value: number): number => CURVE_H - (value / max) * (CURVE_H - 4) - 2;
  const line = points.map((p, i) => `${x(i)},${y(props.pick(p))}`).join(" ");
  return (
    <figure className="m-0 grid gap-0.5">
      <figcaption className="text-ui-sm text-text-tertiary">{props.label}</figcaption>
      <svg
        viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
        className="h-16 w-full max-w-144"
        role="img"
        aria-label={props.label}
      >
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-text-secondary"
        />
        {points.map((p, i) => (
          <circle
            key={p.turnId}
            cx={x(i)}
            cy={y(props.pick(p))}
            r={3}
            className="cursor-pointer fill-current text-text-primary"
            onClick={() => {
              props.onOpenTurn(p.turnId);
            }}
          >
            <title>
              {t("desktop.measure.perf.curvePoint", {
                number: p.number,
                value: numberText(props.pick(p)),
              })}
            </title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}

function Ready(props: {
  readonly view: PerfViewVM;
  readonly capped: boolean;
  readonly turnCount: number;
  readonly onOpenTurn: (turnId: string) => void;
}): ReactNode {
  const { view } = props;
  return (
    <div className="grid gap-5 text-ui-sm">
      <section aria-label={t("desktop.measure.perf.changes")} className={SECTION}>
        <Heading>{t("desktop.measure.perf.changes")}</Heading>
        {view.changes.length === 0 ? (
          <p className={MUTED}>{t("desktop.measure.perf.changesNone")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {view.changes.map((change) => (
              <li key={`${change.kind}:${change.metric}`} className="text-text-primary">
                {changeText(change)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t("desktop.measure.perf.signals")} className={SECTION}>
        <Heading>{t("desktop.measure.perf.signals")}</Heading>
        {view.signals.length === 0 ? (
          <p className={MUTED}>{t("desktop.measure.perf.signalsNone")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {view.signals.map((signal) => (
              <li key={`${signal.kind}:${signal.turnId}`}>
                <OpenButton
                  turnId={signal.turnId}
                  number={signal.number}
                  onOpenTurn={props.onOpenTurn}
                >
                  {t(SIGNAL_TEXT[signal.kind], {
                    number: signal.number,
                    count: numberText(signal.count),
                  })}
                </OpenButton>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t("desktop.measure.perf.toRead")} className={SECTION}>
        <Heading>{t("desktop.measure.perf.toRead")}</Heading>
        {view.toRead.length === 0 ? (
          <p className={MUTED}>{t("desktop.measure.perf.toReadNone")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {view.toRead.map((row) => (
              <li key={row.turnId}>
                <OpenButton turnId={row.turnId} number={row.number} onOpenTurn={props.onOpenTurn}>
                  {t("desktop.measure.perf.toReadRow", {
                    number: row.number,
                    tokens: numberText(row.totalTokens),
                    count: row.signals.length,
                  })}
                </OpenButton>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t("desktop.measure.perf.burden")} className={SECTION}>
        <Heading>{t("desktop.measure.perf.burden")}</Heading>
        <Burden rows={view.burden} onOpenTurn={props.onOpenTurn} />
      </section>
      <section aria-label={t("desktop.measure.perf.curve")} className={SECTION}>
        <Heading>{t("desktop.measure.perf.curve")}</Heading>
        {view.curve.length === 0 ? null : (
          <>
            <Curve
              label={t("desktop.measure.perf.curveTokens")}
              points={view.curve}
              pick={(p) => p.totalTokens}
              onOpenTurn={props.onOpenTurn}
            />
            <Curve
              label={t("desktop.measure.perf.curveTime")}
              points={view.curve}
              pick={(p) => p.durationMs}
              onOpenTurn={props.onOpenTurn}
            />
          </>
        )}
        {props.capped && (
          <p className={MUTED}>{t("desktop.measure.perf.capped", { count: props.turnCount })}</p>
        )}
      </section>
    </div>
  );
}

export function PerfView(props: {
  readonly read: TabRead<PerfInput>;
  readonly onOpenTurn: (turnId: string) => void;
}): ReactNode {
  return (
    <TabBody
      read={props.read}
      render={(input) => {
        const state = perfViewOf(input.series, input.turns);
        switch (state.kind) {
          case "off":
            return <p className={MUTED}>{t("desktop.measure.off")}</p>;
          case "empty":
            return <p className={MUTED}>{t("desktop.measure.noTurns")}</p>;
          case "ready":
            return (
              <Ready
                view={state.view}
                capped={input.capped}
                turnCount={input.turns.length}
                onOpenTurn={props.onOpenTurn}
              />
            );
          default:
            return assertNever(state, "PerfState");
        }
      }}
    />
  );
}
