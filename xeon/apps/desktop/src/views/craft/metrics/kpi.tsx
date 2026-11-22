// 머리 숫자(AGE-36 넷째 판). 숫자만 늘어놓던 한 줄 상자를, 값마다 작은 그림을 단 칸 다섯으로 바꿨다.
// 짜임(혼합안): 위 줄은 화면의 둘째 물음 "컨텍스트가 어디에 쓰이는지"의 바탕인 양(턴, 턴당 플러그인 컨텍스트), 아래 줄은 첫째 물음
// "규칙을 지키는지"의 세 값(막음, 물음, 지침이 있어도 막은 횟수)이다(좁으면 두 칸씩: 턴·컨텍스트, 막음·물음, 지침 몫 한 줄). 칸은 차트 판(`Card`)과 같은 rounded-2xl squircle, border-subtle.
// 값은 엔진이 주는 것만 그린다:
//   - 턴: 날별 턴 수의 작은 기둥(날별 흐름과 같은 중립 먹)
//   - 턴당 컨텍스트: 날마다 플러그인 갈래 합의 흐름 선. 값이 있는 날이 둘보다 적으면 세 갈래(늘 실림·Drive·필요할 때)의 가는 띠와 범례
//   - 막음·물음: 날별 결정의 작은 기둥(Hook 결정 그림과 같은 색과 결: 막음은 꽉 찬 먹, 물음은 촘촘한 점)
//   - 지침이 있어도 막은 횟수: 막음·물음 가운데 몫(가는 미터). 정의상 지침이 실린 턴에서 같은 플러그인의 Hook이 막거나 물은 호출이다
// 지난 기간(같은 길이의 앞 창) 값이 있으면 "지난 n일보다 ±x%"를 숫자 옆에 둔다. 없으면(보존 기간 밖, 0) 쓰지 않는다.
// 그림에 올리면 숫자 자리가 그 날(또는 갈래)의 값으로 바뀐다(축 없는 그림의 값 읽기, 줄이지 않은 자릿수). 색은 종류를 가르는 데만 쓴다.
// 버린 짜임(2026-11-21 비교): 같은 칸 다섯(1440에서 이름과 대비 글이 잘림), 숫자 줄 + 넓은 흐름 하나(턴 말고는 그림이 없음).
// 숫자는 카드의 큰 숫자와 같은 한 단계(title-feature, 600)다: 큰 숫자는 화면에 두 단계뿐이다(섹션 머리의 title-1, 그 밖의 title-feature).
import { activeLocale, t } from "@fresnel/client/i18n";
import { useState, type ReactNode } from "react";
import { InfoTip } from "../info-tip.tsx";
import { Legend, MiniColumns, MiniLine, MiniMeter, MiniSegments, type Series } from "./charts.tsx";
import { cellText, countText, percentText, tokensText } from "./format.ts";
import { DECISION_INK, DECISION_TEXTURE, DecisionGlyph } from "./glyphs.tsx";
import {
  CONTEXT_PARTS,
  changeOf,
  contextOf,
  coveredDays,
  dailyContextOf,
  dailyOf,
  pluginRowsOf,
  rawDecisionsOf,
  shareOf,
  sumCells,
  valueOf,
  type Cell,
  type PeriodTotals,
} from "./model.ts";
import { LoadingBlock } from "./parts.tsx";
import { dayDecisionsOf, dayLongText, partSeries, type DecisionKind } from "./sections.tsx";
import type { MetricsData } from "./source.ts";

/** 올린 자리의 값과 그 이름(날 또는 갈래). 숫자 자리가 잠깐 이것으로 바뀐다 */
interface Hot {
  readonly value: string;
  readonly what: string;
}

/** 지난 기간 대비 바뀐 몫의 글(+12%, −8%). 0이면 "같아요" */
function changeText(change: number, days: number): string {
  if (Math.round(change * 100) === 0) {
    return t("desktop.craft.metrics.kpi.same", { n: String(days) });
  }
  const pct = new Intl.NumberFormat(activeLocale(), {
    style: "percent",
    maximumFractionDigits: Math.abs(change) < 0.1 ? 1 : 0,
    signDisplay: "exceptZero",
  }).format(change);
  return t("desktop.craft.metrics.kpi.change", { change: pct, n: String(days) });
}

/**
 * 칸 하나: 이름(12, 흐림) / 큰 숫자(title-feature 600)와 그 옆 덧말(12, 보조) / 아래 바닥에 붙은 그림.
 * 위 여백 14, 아래 16, 좌우 16(카드와 같은 판). 그림은 칸 바닥에 붙어(같은 줄의 칸끼리 그림 바닥이 한 선) 이름 줄과 숫자 줄은 위에 선다
 */
function Tile(props: {
  readonly label: string;
  readonly mark?: ReactNode;
  readonly info?: string;
  readonly cell: Cell;
  readonly format: (value: number) => string;
  /** 숫자 옆 덧말(지난 기간 대비, 표본 적음). 없으면 비운다 */
  readonly aside: string | null;
  readonly hot: Hot | null;
  readonly className: string;
  readonly children: ReactNode;
}): ReactNode {
  const muted = props.cell.kind !== "value" && props.hot === null;
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-2xl border border-border-subtle bg-surface-base px-4 pt-3.5 pb-4 ${props.className}`}
    >
      <div className="flex h-5 min-w-0 items-center gap-1.5 text-ui-sm text-text-tertiary">
        {props.mark === undefined ? null : <span className="flex items-center">{props.mark}</span>}
        <span className="min-w-0 truncate">{props.label}</span>
        {props.info === undefined ? null : <InfoTip text={props.info} />}
      </div>
      <div className="flex h-6 min-w-0 items-baseline gap-2">
        <span
          className={
            muted
              ? "shrink-0 text-ui text-text-tertiary"
              : "viz-figure shrink-0 text-title-feature font-semibold text-text-primary"
          }
        >
          {props.hot?.value ?? cellText(props.cell, props.format)}
        </span>
        {(props.hot?.what ?? props.aside) === null ? null : (
          <span className="min-w-0 truncate text-ui-sm text-text-secondary">
            {props.hot?.what ?? props.aside}
          </span>
        )}
      </div>
      <div className="mt-auto pt-2">{props.children}</div>
    </div>
  );
}

/** 그림 칸이 비었을 때도 같은 높이를 둔다(같은 줄의 칸끼리 바닥이 맞게) */
function Blank(props: { readonly height: number }): ReactNode {
  return <div aria-hidden="true" style={{ height: props.height }} />;
}

/** 올린 자리의 토큰 값은 줄이지 않은 자릿수로 보인다(칸의 큰 숫자는 "~1.5만"처럼 줄인다) */
function exactTokens(value: number): string {
  return countText(Math.round(value));
}

/** 날별 기둥 칸(턴·막음·물음)의 공통 상태: 올린 날 */
function useHot(): readonly [number | null, (index: number | null) => void] {
  const [hot, setHot] = useState<number | null>(null);
  return [hot, setHot];
}

const ROW1_H = 40;
const ROW2_H = 28;

function decisionSeriesOf(kind: Exclude<DecisionKind, "modified">): Series {
  return {
    id: kind,
    label: t(
      kind === "blocked" ? "desktop.craft.metrics.kpi.blocked" : "desktop.craft.metrics.kpi.asked",
    ),
    color: DECISION_INK[kind],
    texture: DECISION_TEXTURE[kind],
  };
}

/** 날별 값 목록의 화면 읽기 글: "11월 14일 3, 11월 15일 0, …" */
function daysLabel(
  title: string,
  days: readonly string[],
  values: readonly (number | null)[],
  format: (v: number) => string,
): string {
  const parts = days.map((day, i) => {
    const v = values[i];
    return `${dayLongText(day)} ${v === null || v === undefined ? t("desktop.craft.metrics.cell.sample") : format(v)}`;
  });
  return `${title}: ${parts.join(", ")}`;
}

export function KpiStrip(props: { readonly data: MetricsData }): ReactNode {
  const d = props.data;
  const [turnHot, setTurnHot] = useHot();
  const [contextHot, setContextHot] = useHot();
  const [blockedHot, setBlockedHot] = useHot();
  const [askedHot, setAskedHot] = useHot();
  const [meterHot, setMeterHot] = useState(false);
  if (d.plugins.kind !== "ready" || d.daily.kind !== "ready") {
    return <LoadingBlock height={236} label={t("desktop.craft.metrics.kpi.label")} />;
  }
  const rows = pluginRowsOf(d.plugins.value);
  const points = dailyOf(d.daily.value);
  const days = points.map((p) => p.day);
  const turns = points.reduce((s, p) => s + p.turns, 0);
  const recent = d.recent.kind === "ready" ? d.recent.value : null;
  const recentTurns = recent?.turns ?? [];
  // 막음·물음을 엔진이 표본 부족으로 내지 않을 때: 기간의 턴을 다 읽었으면(첫 쪽이 마지막 쪽) 턴 요약의 합을 "표본 적음"과 함께 보인다
  const raw =
    recent !== null && turns > 0 && recent.next === null && recent.turns.length >= turns
      ? rawDecisionsOf(recent.turns.map((r) => r.turn))
      : null;
  const fromRaw = (cell: Cell, value: number | undefined): { cell: Cell; few: boolean } =>
    cell.kind === "sample" && value !== undefined && d.filter.plugin === null
      ? { cell: { kind: "value", value, approx: false, n: turns }, few: true }
      : { cell, few: false };
  const blocked = fromRaw(
    sumCells(rows, (r) => r.blocked),
    raw?.blocked,
  );
  const asked = fromRaw(
    sumCells(rows, (r) => r.asked),
    raw?.asked,
  );
  const defied = sumCells(rows, (r) => r.defied);
  const context = contextOf(rows);
  const contextCell: Cell =
    context.slices.length === 0
      ? { kind: "sample", n: 0 }
      : { kind: "value", value: context.total, approx: true, n: 0 };
  const prev: PeriodTotals | null = d.previous.kind === "ready" ? d.previous.value : null;
  const aside = (now: number | null, before: number | null | undefined): string | null => {
    const change = changeOf(now, before ?? null);
    return change === null ? null : changeText(change, d.filter.days);
  };
  const few = t("desktop.craft.metrics.kpi.fewTurns");

  // 날별 값
  const decisions = dayDecisionsOf(points, coveredDays(points, recentTurns), recentTurns, false);
  const dayValues = (kind: "blocked" | "asked"): (number | null)[] =>
    decisions.map((dd, i) =>
      dd.values === null ? ((points[i]?.turns ?? 0) > 0 ? null : 0) : dd.values[kind],
    );
  const blockedDays = dayValues("blocked");
  const askedDays = dayValues("asked");
  const turnDays = points.map((p) => p.turns);
  const contextDays =
    d.dailyContext.kind === "ready"
      ? dailyContextOf(d.dailyContext.value, days).map((x) => x.total)
      : days.map(() => null);
  const contextKnown = contextDays.filter((v) => v !== null).length;
  const parts = partSeries();
  const partValues = CONTEXT_PARTS.map((part, i) => ({
    id: part,
    value: context.totals[part],
    color: parts[i]?.color ?? "var(--viz-pass)",
    label: parts[i]?.label ?? part,
  }));

  const partHot = (index: number | null): Hot | null => {
    const part = index === null ? undefined : partValues[index];
    return part === undefined ? null : { value: `~${exactTokens(part.value)}`, what: part.label };
  };
  const dayHot = (
    index: number | null,
    values: readonly (number | null)[],
    format: (v: number) => string,
  ): Hot | null => {
    if (index === null) return null;
    const day = days[index];
    if (day === undefined) return null;
    const v = values[index];
    return {
      value: v === null || v === undefined ? t("desktop.craft.metrics.cell.sample") : format(v),
      what: dayLongText(day),
    };
  };

  const blockedValue = valueOf(blocked.cell);
  const askedValue = valueOf(asked.cell);
  const ruled = blockedValue === null || askedValue === null ? null : blockedValue + askedValue;
  const share = shareOf(valueOf(defied), ruled);

  return (
    <div
      role="group"
      aria-label={t("desktop.craft.metrics.kpi.label")}
      className="grid grid-cols-2 gap-3 @[44rem]/metrics:grid-cols-6"
    >
      <Tile
        label={t("desktop.craft.metrics.kpi.turns")}
        cell={{ kind: "value", value: turns, approx: false, n: turns }}
        format={countText}
        aside={aside(turns, prev?.turns)}
        hot={dayHot(turnHot, turnDays, countText)}
        className="@[44rem]/metrics:col-span-3"
      >
        <MiniColumns
          series={{
            id: "turns",
            label: t("desktop.craft.metrics.kpi.turns"),
            color: "var(--viz-ink-2)",
          }}
          points={days.map((id, i) => ({ id, value: turnDays[i] ?? 0 }))}
          height={ROW1_H}
          label={daysLabel(t("desktop.craft.metrics.kpi.turns"), days, turnDays, countText)}
          hot={turnHot}
          onHot={setTurnHot}
        />
      </Tile>
      <Tile
        label={t("desktop.craft.metrics.kpi.context")}
        cell={contextCell}
        format={tokensText}
        aside={aside(contextCell.kind === "value" ? contextCell.value : null, prev?.context)}
        hot={
          contextKnown >= 2
            ? dayHot(contextHot, contextDays, (v) => `~${exactTokens(v)}`)
            : partHot(contextHot)
        }
        className="@[44rem]/metrics:col-span-3"
      >
        {contextKnown >= 2 ? (
          <MiniLine
            values={contextDays}
            height={ROW1_H}
            label={daysLabel(
              t("desktop.craft.metrics.kpi.context"),
              days,
              contextDays,
              (v) => `~${exactTokens(v)}`,
            )}
            hot={contextHot}
            onHot={setContextHot}
          />
        ) : context.total > 0 ? (
          <div className="flex flex-col justify-end gap-2" style={{ height: ROW1_H }}>
            <Legend series={parts.filter((_, i) => (partValues[i]?.value ?? 0) > 0)} />
            <MiniSegments
              parts={partValues}
              label={partValues.map((p) => `${p.label} ~${exactTokens(p.value)}`).join(", ")}
              hot={contextHot}
              onHot={setContextHot}
            />
          </div>
        ) : (
          <Blank height={ROW1_H} />
        )}
      </Tile>
      <Tile
        label={t("desktop.craft.metrics.kpi.blocked")}
        mark={<DecisionGlyph decision="blocked" size={11} />}
        cell={blocked.cell}
        format={countText}
        aside={blocked.few ? few : aside(blockedValue, prev?.blocked)}
        hot={dayHot(blockedHot, blockedDays, countText)}
        className="@[44rem]/metrics:col-span-2"
      >
        <MiniColumns
          series={decisionSeriesOf("blocked")}
          points={days.map((id, i) => ({ id, value: blockedDays[i] ?? null }))}
          height={ROW2_H}
          label={daysLabel(t("desktop.craft.metrics.kpi.blocked"), days, blockedDays, countText)}
          hot={blockedHot}
          onHot={setBlockedHot}
        />
      </Tile>
      <Tile
        label={t("desktop.craft.metrics.kpi.asked")}
        mark={<DecisionGlyph decision="asked" size={11} />}
        cell={asked.cell}
        format={countText}
        aside={asked.few ? few : aside(askedValue, prev?.asked)}
        hot={dayHot(askedHot, askedDays, countText)}
        className="@[44rem]/metrics:col-span-2"
      >
        <MiniColumns
          series={decisionSeriesOf("asked")}
          points={days.map((id, i) => ({ id, value: askedDays[i] ?? null }))}
          height={ROW2_H}
          label={daysLabel(t("desktop.craft.metrics.kpi.asked"), days, askedDays, countText)}
          hot={askedHot}
          onHot={setAskedHot}
        />
      </Tile>
      <Tile
        label={t("desktop.craft.metrics.kpi.defied")}
        info={t("desktop.craft.metrics.table.defiedInfo")}
        cell={defied}
        format={countText}
        aside={aside(valueOf(defied), prev?.defied)}
        hot={
          meterHot && ruled !== null && valueOf(defied) !== null
            ? {
                value: `${countText(valueOf(defied) ?? 0)} / ${countText(ruled)}`,
                what: t("desktop.craft.metrics.kpi.ofRuled"),
              }
            : null
        }
        className="col-span-2 @[44rem]/metrics:col-span-2"
      >
        {share === null || ruled === null ? (
          <Blank height={ROW2_H} />
        ) : (
          <div className="flex flex-col justify-end gap-2" style={{ height: ROW2_H }}>
            <div className="truncate text-ui-sm leading-none text-text-tertiary">
              {t("desktop.craft.metrics.kpi.share", {
                n: countText(ruled),
                pct: percentText(share),
              })}
            </div>
            <MiniMeter
              share={share}
              label={t("desktop.craft.metrics.kpi.share", {
                n: countText(ruled),
                pct: percentText(share),
              })}
              onHot={setMeterHot}
            />
          </div>
        )}
      </Tile>
    </div>
  );
}
