// 메트릭 화면(C9)의 그리기. 질문: "내 플러그인들이 실제로 효과가 있나, 비용은 얼마나 드나?"
// 판 둘(개발 빌드에서 바꿔 본다):
// - 가 `insights`: 인사이트가 먼저(스펙 AC-40의 순서). 그다음 플러그인 표, 컨텍스트 분해, 블록별 시간, 날별 흐름, 버전 전후.
// - 나 `charts`: 숫자와 분해 그림이 먼저. 머리 숫자, 큰 컨텍스트 분해, 옆 칸에 인사이트를 좁게. 그다음 시간·흐름·표·버전.
import { activeLocale, t } from "@fresnel/client/i18n";
import {
  Button,
  Chip,
  Select,
  SelectOption,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import type { ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import {
  HEADER_SEGMENTED_SIZE,
  HEADER_SELECT_SIZE,
  ScreenHeader,
} from "../../shell/screen-header.tsx";
import { InsightList } from "./insights.tsx";
import { PERIODS, dailyOf, isPeriod, type MetricsFilter } from "./model.ts";
import {
  CompareSection,
  ContextSection,
  DailySection,
  KpiStrip,
  PluginTableSection,
  TimeSection,
} from "./sections.tsx";
import { Section } from "./parts.tsx";
import type { MetricsData } from "./source.ts";

export type MetricsLayout = "insights" | "charts";

const ALL = "__all";

function FilterBar(props: { readonly data: MetricsData }): ReactNode {
  const { filter, setFilter, profiles } = props.data;
  const set = (patch: Partial<MetricsFilter>): void => {
    setFilter({ ...filter, ...patch });
  };
  return (
    <div className="flex items-center gap-2">
      <SegmentedControl
        size={HEADER_SEGMENTED_SIZE}
        aria-label={t("desktop.craft.metrics.filter.period")}
        value={String(filter.days)}
        onValueChange={(value) => {
          const days = Number(value);
          if (isPeriod(days)) set({ days });
        }}
      >
        {PERIODS.map((days) => (
          <SegmentedControlItem key={days} value={String(days)}>
            {t("desktop.craft.metrics.filter.days", { n: String(days) })}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <Select
        size={HEADER_SELECT_SIZE}
        variant="soft"
        aria-label={t("desktop.craft.metrics.filter.profile")}
        value={filter.profileId ?? ALL}
        onValueChange={(value) => {
          set({ profileId: value === ALL ? null : value });
        }}
        className="w-44"
      >
        <SelectOption value={ALL}>{t("desktop.craft.metrics.filter.allProfiles")}</SelectOption>
        {profiles.kind === "ready"
          ? profiles.value.map((p) => (
              <SelectOption key={p.id} value={p.id}>
                {p.title}
              </SelectOption>
            ))
          : null}
      </Select>
      <Chip
        size="md"
        variant="outline"
        pressed={filter.includeTests}
        onPressedChange={(pressed: boolean) => {
          set({ includeTests: pressed });
        }}
      >
        {t("desktop.craft.metrics.filter.tests")}
      </Chip>
    </div>
  );
}

/** 기록이 하나도 없을 때의 그림: 대화에서 턴을 돌리면 → 트레이스가 쌓이고 → 메트릭과 인사이트가 생긴다 */
function EmptyFigure(): ReactNode {
  const steps = [
    t("desktop.craft.metrics.empty.step1"),
    t("desktop.craft.metrics.empty.step2"),
    t("desktop.craft.metrics.empty.step3"),
  ];
  return (
    <svg
      viewBox="0 0 520 132"
      className="block w-full max-w-130"
      role="img"
      aria-label={steps.join(" → ")}
    >
      {/* 1. 대화의 턴: 말풍선 셋 */}
      <g transform="translate(20 18)">
        <rect width="132" height="76" rx="12" fill="none" stroke="var(--cs-color-border-default)" />
        <rect x="14" y="14" width="70" height="12" rx="6" fill="var(--viz-pass)" />
        <rect x="48" y="32" width="70" height="12" rx="6" fill="var(--viz-modified)" />
        <rect x="14" y="50" width="52" height="12" rx="6" fill="var(--viz-pass)" />
      </g>
      {/* 2. 트레이스: 시간 줄 */}
      <g transform="translate(194 18)">
        <rect width="132" height="76" rx="12" fill="none" stroke="var(--cs-color-border-default)" />
        <rect x="14" y="16" width="60" height="8" rx="4" fill="var(--viz-model)" />
        <rect x="62" y="30" width="16" height="8" rx="4" fill="var(--viz-hook)" />
        <rect x="80" y="30" width="38" height="8" rx="4" fill="var(--viz-tool)" />
        <rect x="14" y="44" width="40" height="8" rx="4" fill="var(--viz-inject)" />
        <rect x="56" y="58" width="62" height="8" rx="4" fill="var(--viz-drive)" />
      </g>
      {/* 3. 메트릭: 기둥 */}
      <g transform="translate(368 18)">
        <rect width="132" height="76" rx="12" fill="none" stroke="var(--cs-color-border-default)" />
        {[22, 38, 30, 52, 44, 60].map((h, i) => (
          <rect
            key={h}
            x={16 + i * 18}
            y={66 - h}
            width="10"
            height={h}
            rx="3"
            fill={i === 5 ? "var(--viz-blocked)" : "var(--viz-modified)"}
          />
        ))}
      </g>
      <g
        stroke="var(--cs-color-text-tertiary)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M160 56h26M180 50l6 6-6 6" />
        <path d="M334 56h26M354 50l6 6-6 6" />
      </g>
      {steps.map((s, i) => (
        <text
          key={s}
          x={86 + i * 174}
          y={120}
          textAnchor="middle"
          className="viz-axis"
          style={{ fontSize: 12 }}
        >
          {s}
        </text>
      ))}
    </svg>
  );
}

function EmptyPage(props: { readonly filtered: boolean; readonly onClear: () => void }): ReactNode {
  const commands = useCommands();
  return (
    <div className="mx-auto grid max-w-140 justify-items-center gap-5 px-4 py-16 text-center">
      <EmptyFigure />
      <div className="grid gap-1.5">
        <h2 className="text-title-3 font-semibold text-text-primary">
          {t("desktop.craft.metrics.empty.title")}
        </h2>
        <p className="text-ui text-text-secondary">{t("desktop.craft.metrics.empty.body")}</p>
      </div>
      <div className="flex gap-2">
        <Button
          size="md"
          variant="outline"

          onClick={() => {
            commands.showScreen("chat");
          }}
        >
          {t("desktop.craft.metrics.empty.toChat")}
        </Button>
        {props.filtered ? (
          <Button size="md" variant="ghost" onClick={props.onClear}>
            {t("desktop.craft.metrics.empty.clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** 기록이 꺼져 있으면(엔진이 `measurement_off`를 알림) 항상 보이는 띠. 0으로 그리지 않는다 */
function OffBand(props: { readonly data: MetricsData }): ReactNode {
  const commands = useCommands();
  const p = props.data.plugins;
  const off = p.kind === "ready" && p.value.notes.some((n) => n.code === "measurement_off");
  if (!off) return null;
  return (
    <div
      role="note"
      className="flex items-center gap-3 rounded-xl border border-warning-border bg-warning-soft px-4 py-2.5 text-ui text-text-primary"
    >
      <span className="min-w-0 flex-1">{t("desktop.craft.metrics.off")}</span>
      <Button
        size="sm"
        variant="ghost"

        onClick={() => {
          commands.showScreen("settings");
        }}
      >
        {t("desktop.craft.metrics.offSettings")}
      </Button>
    </div>
  );
}

/** 연결이 끊겨 마지막으로 읽은 값을 보이는 중 */
function StaleNote(props: { readonly data: MetricsData }): ReactNode {
  const stale = [props.data.plugins, props.data.findings].some(
    (l) => l.kind === "ready" && l.stale,
  );
  if (!stale && props.data.link !== "offline") return null;
  return (
    <div role="status" className="text-ui-sm text-warning-text">
      {t("desktop.craft.metrics.stale")}
    </div>
  );
}

/** 기록이 하나도 없는가(턴 0, 플러그인 행 0, 인사이트 0) */
function isEmpty(data: MetricsData): boolean {
  if (
    data.plugins.kind !== "ready" ||
    data.daily.kind !== "ready" ||
    data.findings.kind !== "ready"
  ) {
    return false;
  }
  return (
    data.plugins.value.rows.length === 0 &&
    data.findings.value.findings.length === 0 &&
    dailyOf(data.daily.value).every((p) => p.turns === 0)
  );
}

function InsightsFirst(props: { readonly data: MetricsData }): ReactNode {
  const d = props.data;
  return (
    <div className="grid gap-10">
      <Section
        id="cm-insights"
        title={t("desktop.craft.metrics.insight.title")}
        info={t("desktop.craft.metrics.insight.info")}
      >
        <InsightList data={d} compact={false} limit={6} locale={activeLocale()} />
      </Section>
      <PluginTableSection data={d} />
      <ContextSection data={d} hero={false} />
      <div className="grid items-start gap-10 medium:grid-cols-2">
        <TimeSection data={d} />
        <DailySection data={d} height={96} />
      </div>
      <CompareSection data={d} />
    </div>
  );
}

function ChartsFirst(props: { readonly data: MetricsData }): ReactNode {
  const d = props.data;
  return (
    <div className="grid gap-10">
      <KpiStrip data={d} />
      <div className="grid gap-10 wide:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-10">
          <ContextSection data={d} hero />
          <DailySection data={d} height={120} />
        </div>
        <Section
          id="cm-insights"
          title={t("desktop.craft.metrics.insight.title")}
          info={t("desktop.craft.metrics.insight.info")}
          className="content-start"
        >
          <InsightList data={d} compact limit={4} locale={activeLocale()} />
        </Section>
      </div>
      <TimeSection data={d} />
      <PluginTableSection data={d} />
      <CompareSection data={d} />
    </div>
  );
}

export function MetricsView(props: {
  readonly data: MetricsData;
  readonly layout: MetricsLayout;
}): ReactNode {
  const d = props.data;
  const filtered = d.filter.profileId !== null || d.filter.includeTests || d.filter.days !== 30;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title={t("desktop.craft.metrics.title")} controls={<FilterBar data={d} />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isEmpty(d) ? (
          <EmptyPage
            filtered={filtered}
            onClear={() => {
              d.setFilter({ days: 30, profileId: null, includeTests: true });
            }}
          />
        ) : (
          <div className="mx-auto grid w-full max-w-280 gap-6 px-6 pt-2 pb-12">
            <OffBand data={d} />
            <StaleNote data={d} />
            {props.layout === "insights" ? <InsightsFirst data={d} /> : <ChartsFirst data={d} />}
          </div>
        )}
      </div>
    </div>
  );
}
