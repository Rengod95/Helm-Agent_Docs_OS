// 메트릭 화면(C9)의 그리기. 질문 둘: "규칙을 넣었는데 지키는지", "컨텍스트가 어디에 쓰이는지".
// 짜임(사용자 2026-11-20): 그림이 먼저인 판 나를 바탕으로 콘텐츠 영역 전체를 쓴다. 왼쪽은 그림 칸(따로 스크롤),
// 오른쪽은 인사이트 고정 열(열 안에서 따로 스크롤). 콘텐츠 폭이 `NARROW`보다 좁으면 열 대신 위 요약 줄과 서랍이다.
// 왼쪽 차례: 머리 숫자 → 표본 줄 → 컨텍스트 분해 → 블록별 시간 │ 날별 흐름 → 최근 턴 → 플러그인 표 → 버전 전후.
// 셋째 판(m6X3): 머리는 `flush`다. 셸이 flush가 아닌 머리 뒤 첫 요소에 주던 오른쪽 60px(세로 단추 띠 48 + 12)과 위 24px이
// 인사이트 열 오른쪽에 남던 큰 여백의 원인이었다. 이제 두 열은 머리 선 바로 아래에서 시작하고 인사이트 열은 창 오른쪽 끝까지 간다.
// 위 여백은 두 열이 같은 24px을 스스로 갖고, 띠는 띠와 같은 높이의 덩어리만 비킨다(`rail-avoid.ts`).
import { activeLocale, t } from "@fresnel/client/i18n";
import {
  Button,
  Chip,
  Select,
  SelectOption,
  SegmentedControl,
  SegmentedControlItem,
  Toast,
} from "@caustic/react";
import type { ReactNode } from "react";
import { X } from "@caustic/react/icons";
import { useEffect, useRef, useState } from "react";
import { useCommands } from "../../commands.ts";
import {
  HEADER_SEGMENTED_SIZE,
  HEADER_SELECT_SIZE,
  ScreenHeader,
} from "../../shell/screen-header.tsx";
import { useWidth } from "./charts.tsx";
import { InsightPanel, InsightSummary } from "./insights.tsx";
import { DEFAULT_FILTER, PERIODS, dailyOf, isPeriod, type MetricsFilter } from "./model.ts";
import { KpiStrip } from "./kpi.tsx";
import { RecentTurnsSection, type RecentFilter } from "./recent.tsx";
import {
  CompareSection,
  ContextSection,
  DailySection,
  PluginTableSection,
  SampleBand,
  TimeSection,
} from "./sections.tsx";
import type { Finding } from "@fresnel/contracts/wire";
import type { MetricsData } from "./source.ts";

/** 이 폭(px, 콘텐츠 영역)보다 좁으면 인사이트가 서랍으로 간다. 1100px 창에서 내비를 뺀 폭이 이 아래다 */
const NARROW = 880;

/** 인사이트 열의 폭: 콘텐츠가 넓을수록 넉넉히(근거와 다음 걸음이 한 줄씩 읽히게) */
function columnWidthOf(width: number): number {
  if (width >= 1500) return 420;
  if (width >= 1100) return 360;
  return 340;
}

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
      {filter.plugin === null ? null : (
        <Button
          size="sm"
          variant="outline"
          aria-label={t("desktop.craft.metrics.focus.clear", { plugin: filter.plugin })}
          onClick={() => {
            set({ plugin: null });
          }}
        >
          <span className="max-w-36 truncate">{filter.plugin}</span>
          <X size={12} />
        </Button>
      )}
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
        <rect x="48" y="32" width="70" height="12" rx="6" fill="var(--viz-ink-1)" />
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
            fill={i === 5 ? "var(--viz-ink-3)" : "var(--viz-ink-1)"}
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
      <div className="grid grid-cols-1 gap-1.5">
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

/**
 * 기록이 꺼져 있으면(엔진이 `measurement_off`를 알림) 항상 보이는 알림. 0으로 그리지 않는다.
 * 리뷰 화면의 알림 카드와 같은 부품이다(m6X3): 앱의 알림 토스트를 제자리(`inline`)에 그림자 없이 그린다
 */
function OffBand(props: { readonly data: MetricsData }): ReactNode {
  const commands = useCommands();
  const p = props.data.plugins;
  const off = p.kind === "ready" && p.value.notes.some((n) => n.code === "measurement_off");
  if (!off) return null;
  return (
    <Toast
      inline
      tone="warning"
      shadow="none"
      role="note"
      title={t("desktop.craft.metrics.off")}
      actionLabel={t("desktop.craft.metrics.offSettings")}
      onAction={() => {
        commands.showScreen("settings");
      }}
    />
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

/** 왼쪽 그림 칸. 그림들의 짜임은 칸 폭(컨테이너 `metrics`)으로 정한다 */
function ChartsColumn(props: {
  readonly data: MetricsData;
  readonly narrow: boolean;
  readonly onOpenInsights: () => void;
  readonly recent: RecentFilter;
  readonly onRecent: (next: RecentFilter) => void;
}): ReactNode {
  const d = props.data;
  const day = props.recent.kind === "day" ? props.recent.day : null;
  const recentRef = useRef<HTMLDivElement>(null);
  // 인사이트 카드에서 근거를 고르면 "최근 턴"으로 내린다
  useEffect(() => {
    if (props.recent.kind === "evidence") {
      recentRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [props.recent]);
  return (
    <div
      className="cm-charts grid w-full grid-cols-1 gap-10 px-6 pt-6 pb-12"
      data-narrow={props.narrow ? "" : undefined}
    >
      <div className="grid grid-cols-1 gap-4">
        <OffBand data={d} />
        <StaleNote data={d} />
        {props.narrow ? <InsightSummary data={d} onOpen={props.onOpenInsights} /> : null}
        <KpiStrip data={d} />
        <SampleBand data={d} />
      </div>
      <ContextSection data={d} hero />
      <div className="grid grid-cols-1 items-start gap-10 @[44rem]/metrics:grid-cols-2">
        <TimeSection data={d} />
        <DailySection
          data={d}
          height={128}
          pickedDay={day}
          onPickDay={(picked) => {
            props.onRecent(day === picked ? { kind: "all" } : { kind: "day", day: picked });
            recentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }}
        />
      </div>
      <div ref={recentRef} className="scroll-mt-4">
        <RecentTurnsSection
          data={d}
          filter={props.recent}
          onClear={() => {
            props.onRecent({ kind: "all" });
          }}
        />
      </div>
      <PluginTableSection data={d} />
      <CompareSection data={d} />
    </div>
  );
}

export function MetricsView(props: {
  readonly data: MetricsData;
  /** 개발 빌드만: 머리 오른쪽 끝의 표본 메뉴(`metrics-dev.tsx`). 배포 빌드는 넘기지 않는다 */
  readonly dev?: ReactNode;
}): ReactNode {
  const d = props.data;
  const filtered =
    d.filter.profileId !== null ||
    d.filter.includeTests ||
    d.filter.days !== DEFAULT_FILTER.days ||
    d.filter.plugin !== null;
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame);
  const narrow = width > 0 && width < NARROW;
  const [drawer, setDrawer] = useState(false);
  const drawerOpen = narrow && drawer;
  // "최근 턴"의 거르기: 날(날별 기둥) 또는 인사이트의 근거(카드의 "근거 턴 n개"). 근거를 고르면 서랍을 닫고 목록으로 내린다
  const [recent, setRecent] = useState<RecentFilter>({ kind: "all" });
  const showEvidence = (finding: Finding): void => {
    setRecent({ kind: "evidence", finding });
    setDrawer(false);
  };
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);
  const empty = isEmpty(d);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={t("desktop.craft.metrics.title")}
        flush
        controls={
          <>
            <FilterBar data={d} />
            {props.dev}
          </>
        }
      />
      <div ref={frame} className="relative flex min-h-0 flex-1">
        {empty ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyPage
              filtered={filtered}
              onClear={() => {
                d.setFilter(DEFAULT_FILTER);
              }}
            />
          </div>
        ) : (
          <>
            <div className="@container/metrics min-h-0 min-w-0 flex-1 overflow-y-auto">
              <ChartsColumn
                data={d}
                narrow={narrow}
                onOpenInsights={() => {
                  setDrawer(true);
                }}
                recent={recent}
                onRecent={setRecent}
              />
            </div>
            {narrow ? null : (
              <div
                className="flex min-h-0 shrink-0 flex-col border-l border-border-subtle"
                style={{ width: columnWidthOf(width) }}
              >
                <InsightPanel data={d} locale={activeLocale()} onShowEvidence={showEvidence} />
              </div>
            )}
            {drawerOpen ? (
              <>
                <div
                  aria-hidden="true"
                  className="absolute inset-0 z-20 bg-bg-scrim"
                  onClick={() => {
                    setDrawer(false);
                  }}
                />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="cm-insights-title"
                  className="absolute inset-y-0 right-0 z-30 flex w-[min(400px,100%)] flex-col border-l border-border-subtle bg-surface-base shadow-3"
                >
                  <InsightPanel
                    data={d}
                    locale={activeLocale()}
                    onShowEvidence={showEvidence}
                    onClose={() => {
                      setDrawer(false);
                    }}
                  />
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
