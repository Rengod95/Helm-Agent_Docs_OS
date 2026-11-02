// e04 화면 조각: P-13 확장 목록, P-17 확장 상세(탭별 상태), P-20 측정, P-06 제안 거르기, P-09 키 찾기 결과 없음.
// 공통 규칙: 실패는 그 목록 자리에 soft Alert 하나(DP-28), 오프라인은 머리 아래 soft warning 한 줄 + 쓰기 잠금(§6.0),
// 결과 없음은 찾은 말을 되풀이하고 "거르기 지우기" 하나(N-48), 읽는 중은 실제 행 모양의 Skeleton(같은 높이라 자리가 튀지 않음).
// 빈 화면 그림(EmptyState 아이콘)은 화면마다 하나까지. 원인 코드(wire 메서드, 설정 키)는 화면에 내지 않는다(디자인 언어 §6).
// 표·지표 칸은 _shell의 선 격자(LineGrid·LineGridBlock·LineGridMetric, 옛 언어 이식). 색·글자는 옛 토큰만 쓴다.
import {
  Alert,
  Button,
  EmptyState,
  IconButton,
  Input,
  List,
  ListDescription,
  ListDescriptionRow,
  ListRow,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@caustic/react";
import type { ReactNode } from "react";
import {
  Ellipsis,
  extName,
  extensions,
  josa,
  L2,
  GRID_BODY,
  GRID_INSET,
  LineGrid,
  LineGridBlock,
  LineGridFrame,
  LineGridMetric,
  Search,
  SearchX,
  StageHead,
  T,
  WorkbenchHead,
  type Layout,
  type LineGridCellData,
  type LineGridColumn,
} from "../../_shell";
import type { ListMode, MetricsMode, S, TabMode } from "../flow";
import { ExtList, layerName } from "./ext-list";

/** 머리 아래 본문: 폭 하나. 간격은 화면마다(거르기와 표 12, 구역 32). */
const BODY = `${GRID_BODY} pb-8`;
/** 띠가 있는 화면의 머리: 칸 글자와 같은 안쪽 여백(px-4)으로 첫 열 글자와 줄을 맞춘다. */
const HEAD = `w-full ${GRID_INSET}`;
const LAYERS = ["L0", "L1", "L2", "L3", "plugin", "X"] as const;

/** 결과 없음(N-48): 찾은 말 + 거르기 지우기 하나. 안내 문장을 늘이지 않는다(DP-03). */
export function NoMatch({
  what,
  onClear,
  clearLabel,
  extra,
}: {
  what: string;
  onClear?: () => void;
  clearLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <EmptyState
      size="sm"
      surface="none"
      icon={<SearchX />}
      title={L2(`${josa(what, "과", "와")} 맞는 것이 없어요`, `Nothing matches ${what}`)}
      actions={
        <>
          {onClear !== undefined && (
            <Button size="sm" tone="neutral" variant="outline" onClick={onClear}>
              {clearLabel ?? L2("거르기 지우기", "Clear filters")}
            </Button>
          )}
          {extra}
        </>
      }
    />
  );
}

export function ExtListScreen({
  s,
  layout,
  onQ,
  onLayer,
  onClear,
  onRetry,
  userOnly = false,
}: {
  s: S;
  layout: Layout;
  onQ: (q: string) => void;
  onLayer: (v: string) => void;
  onClear: () => void;
  onRetry: () => void;
  /** 빈 상태: 사용자 확장이 없는 목록(내장만). */
  userOnly?: boolean;
}) {
  const mode: ListMode = s.list;
  const rows = extensions.filter(
    (e) =>
      (s.q === "" ||
        e.name.includes(s.q) ||
        extName(e.name).toLowerCase().includes(s.q.toLowerCase())) &&
      (s.layer === "all" || e.layer === s.layer) &&
      (!userOnly || e.trust === "user"),
  );
  const layerWord = LAYERS.find((l) => l === s.layer);
  const what = [
    s.q !== "" ? `"${s.q}"` : null,
    layerWord !== undefined ? layerName[layerWord] : null,
  ]
    .filter((x) => x !== null)
    .join(" · ");
  const ready = mode === "ready";
  return (
    <>
      <WorkbenchHead
        className={HEAD}
        title={T.extension}
        actions={
          <>
            <Button size="sm" tone="neutral" variant="ghost" disabled={!ready}>
              {L2("가져오기", "Import")}
            </Button>
            <Button size="sm" tone="neutral" variant="outline" disabled={!ready}>
              {L2(`새 ${T.group}`, `New ${T.group.toLowerCase()}`)}
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${BODY} gap-3`}>
          {!userOnly && (
            <div
              role="search"
              aria-label={L2("확장 거르기", "Filter extensions")}
              className="flex flex-wrap items-center gap-2"
            >
              <Input
                size="sm"
                variant="soft"
                prefix={<Search />}
                placeholder={L2("이름으로 찾기", "Find by name")}
                aria-label={L2("확장 이름으로 찾기", "Find extensions by name")}
                value={s.q}
                disabled={!ready}
                onChange={(e) => onQ(e.target.value)}
                containerClassName="w-60"
              />
              <Select
                size="sm"
                variant="soft"
                aria-label={T.layer}
                value={s.layer}
                disabled={!ready}
                onValueChange={onLayer}
                className="w-36"
              >
                <SelectOption value="all">{L2(`${T.layer} 전체`, "All layers")}</SelectOption>
                {LAYERS.map((l) => (
                  <SelectOption key={l} value={l}>
                    {layerName[l]}
                  </SelectOption>
                ))}
              </Select>
            </div>
          )}
          {mode === "error" ? (
            <Alert
              tone="danger"
              actions={[{ label: L2("다시 읽기", "Reload"), onClick: onRetry, primary: true }]}
            >
              {L2(`${T.extension} 목록을 읽지 못했어요`, "Couldn't load the extension list")}
            </Alert>
          ) : mode === "loading" ? (
            <ExtList rows={[]} layout={layout} loading />
          ) : userOnly ? (
            <EmptyState
              size="md"
              surface="none"
              title={L2(
                `직접 설치하거나 만든 ${T.extension}이 없어요`,
                "No extensions you installed or built",
              )}
              actions={
                <Button size="sm" tone="neutral" variant="solid">
                  {L2(`새 ${T.group}`, `New ${T.group.toLowerCase()}`)}
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <NoMatch what={what} onClear={onClear} />
          ) : (
            <ExtList rows={rows} layout={layout} />
          )}
        </div>
      </div>
    </>
  );
}

const TABS = [
  ["overview", L2("개요", "Overview")],
  ["points", T.extensionPoint],
  ["lease", L2(`주도와 상한`, "Lead and limits")],
  ["settings", L2("설정", "Settings")],
  ["metrics", T.metrics],
  ["log", L2("기록", "Log")],
  ["versions", T.version],
  ["views", L2("화면", "Views")],
] as const;

// 훅 표: 훅 · 시간 예산 · 실패. 합치는 방식(fold)과 p50·p95는 개발 모드 상세로 보낸다(디자인 언어 §6).
const POINTS = [
  ["input.agent.before", "10s", "0"],
  ["tool.call.before", "30s", "0"],
  ["tool.execution.after", "5s", "0"],
  ["boundary.settle.after", "5s", "1"],
  ["thread.start", "5s", "0"],
] as const;

const POINT_COLS: LineGridColumn[] = [
  { id: "budget", label: L2("시간 예산", "Time budget"), width: "9rem" },
  { id: "fails", label: L2("실패", "Fails"), width: "7rem" },
];

/** 왼쪽 위 칸 제목. caustic corner는 footnote라 옆 머리 칸(title-3)과 맞춘다. */
const HeadText = ({ children }: { children: ReactNode }) => (
  <span className="text-title-3 text-text-primary">{children}</span>
);

/** 값 하나짜리 칸. 읽는 중은 같은 자리의 Skeleton, 실패가 있으면 6px 점. */
const valueCell = (value: string, loading: boolean, warn = false): LineGridCellData => ({
  items: [
    {
      id: "v",
      label: loading ? (
        <Skeleton className="h-4 w-10" />
      ) : (
        <span className="tabular-nums">{value}</span>
      ),
      ...(warn && !loading ? { dot: "warning" as const } : {}),
    },
  ],
});

function PointsTable({ loading }: { loading: boolean }) {
  return (
    <LineGridFrame>
      <LineGrid
        label={T.extensionPoint}
        aria-busy={loading}
        columns={POINT_COLS}
        rowHeadWidth="minmax(0, 1fr)"
        corner={<HeadText>{T.extensionPoint}</HeadText>}
        rows={POINTS.map((p, i) => ({
          id: p[0],
          label: loading ? (
            <Skeleton
              className="h-4"
              style={{ width: `${[176, 136, 200, 152, 120][i] ?? 150}px` }}
            />
          ) : (
            p[0]
          ),
        }))}
        cell={(r, c) => {
          const p = POINTS.find((x) => x[0] === r) ?? POINTS[0];
          return c === "budget" ? valueCell(p[1], loading) : valueCell(p[2], loading, p[2] !== "0");
        }}
      />
    </LineGridFrame>
  );
}

/** 측정 요약: 값이 주인공인 칸 셋. */
function MetricBlock({
  tokens,
  cost,
  fails,
  loading = false,
}: {
  tokens: string;
  cost: string;
  fails: string;
  loading?: boolean;
}) {
  const v = (x: string) => (loading ? <Skeleton className="h-7 w-16" /> : x);
  return (
    <LineGridFrame>
      <LineGridBlock columns={3} aria-busy={loading}>
        <LineGridMetric value={v(tokens)} metricLabel={L2("토큰", "Tokens")} />
        <LineGridMetric value={v(cost)} metricLabel={L2("비용", "Cost")} />
        <LineGridMetric value={v(fails)} metricLabel={L2("실패", "Fails")} />
      </LineGridBlock>
    </LineGridFrame>
  );
}

/** 탭 하나의 상태별 내용. 오프라인은 마지막 값을 보이고 쓰기만 잠근다. */
function TabBody({ tab, mode }: { tab: string; mode: TabMode }) {
  if (mode === "error")
    return (
      <Alert tone="danger" actions={[{ label: L2("다시 읽기", "Reload"), primary: true }]}>
        {L2("이 탭을 읽지 못했어요", "Couldn't load this tab")}
      </Alert>
    );
  if (mode === "empty") {
    const text: Record<string, string> = {
      views: L2(`이 ${T.extension}이 기여한 화면이 없어요`, "This extension contributes no views"),
      log: L2("최근 기록이 없어요", "No recent log"),
      versions: L2("보관한 이전 버전이 없어요", "No earlier versions kept"),
      lease: L2(
        `${T.lead}를 쓰지 않는 ${T.extension}이에요`,
        "This extension doesn't use the drive lease",
      ),
      points: L2(`연결한 ${T.extensionPoint}이 없어요`, "No hooks connected"),
    };
    return (
      <EmptyState size="sm" surface="none" title={text[tab] ?? L2("자료가 없어요", "No data")} />
    );
  }
  if (tab === "points") return <PointsTable loading={mode === "loading"} />;
  if (tab === "settings" && mode !== "loading")
    return (
      <ListDescription variant="ghost" size="sm" aria-label={L2("설정", "Settings")}>
        <ListDescriptionRow term={L2(`${T.lens} 최대`, "Most lenses")}>
          {L2("4개", "4")}
        </ListDescriptionRow>
      </ListDescription>
    );
  if (tab === "lease" && mode !== "loading")
    return (
      <ListDescription variant="ghost" size="sm" aria-label={L2("주도와 상한", "Lead and limits")}>
        <ListDescriptionRow term={T.lead}>{L2("쓰고 있어요", "In use")}</ListDescriptionRow>
        <ListDescriptionRow term={L2(`${T.lens} 상한`, "Lens limit")}>
          {L2("4개", "4")}
        </ListDescriptionRow>
      </ListDescription>
    );
  if (tab === "versions" && mode !== "loading")
    return (
      <List size="xs" aria-label={T.version}>
        <ListRow
          title="0.1.0"
          end={<span className="text-ui-xs text-text-tertiary">{L2("지금", "Current")}</span>}
        />
        <ListRow title="0.0.9" />
      </List>
    );
  if (tab === "views" && mode !== "loading")
    return (
      <List size="xs" aria-label={L2("화면", "Views")}>
        <ListRow
          title={L2("Helm 탐구", "Helm inquiry")}
          end={<span className="text-ui-xs text-text-tertiary">{T.slotPage}</span>}
        />
      </List>
    );
  if (tab === "metrics")
    return <MetricBlock tokens="1.2M" cost="$3.10" fails="1" loading={mode === "loading"} />;
  if (tab === "log")
    return mode === "loading" ? (
      <div className="grid gap-3">
        {[80, 64, 72].map((w) => (
          <Skeleton key={w} className="h-5" style={{ width: `${w}%` }} />
        ))}
      </div>
    ) : (
      <List size="xs" aria-label={L2("기록", "Log")}>
        <ListRow
          title={L2(
            "단계 마무리에서 핸들러가 실패했어요",
            "A handler failed while the step was settling",
          )}
          end={<span className="text-ui-xs text-text-tertiary">14:03</span>}
        />
      </List>
    );
  return (
    <ListDescription variant="ghost" size="sm">
      <ListDescriptionRow term={L2("설명", "Description")}>
        {mode === "loading" ? (
          <Skeleton className="h-4 w-60" />
        ) : (
          L2("렌즈 여러 개로 원인을 넓게 찾는 그룹", "Finds causes widely with several lenses")
        )}
      </ListDescriptionRow>
      <ListDescriptionRow term={T.layer}>
        {mode === "loading" ? <Skeleton className="h-4 w-24" /> : T.layerL3}
      </ListDescriptionRow>
      <ListDescriptionRow term={T.trust}>
        {mode === "loading" ? <Skeleton className="h-4 w-24" /> : T.trustUser}
      </ListDescriptionRow>
      <ListDescriptionRow term={T.version}>
        {mode === "loading" ? <Skeleton className="h-4 w-12" /> : "0.1.0"}
      </ListDescriptionRow>
    </ListDescription>
  );
}

export function DetailScreen({
  s,
  onTab,
  mode,
}: {
  s: S;
  onTab: (v: string) => void;
  mode: TabMode;
}) {
  const offline = mode === "offline";
  return (
    <>
      <WorkbenchHead
        className={HEAD}
        title={extName("helm")}
        meta={T.group}
        actions={
          <>
            <Button
              size="sm"
              tone="neutral"
              variant="outline"
              disabled={offline || mode === "loading"}
            >
              {L2("끄기", "Turn off")}
            </Button>
            <IconButton size="sm" variant="ghost" label={L2("더 보기", "More")}>
              <Ellipsis />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${BODY} gap-6`}>
          {offline && (
            <Alert tone="warning">
              {L2("오프라인이라 바꿀 수 없어요", "Offline: changes are paused")}
            </Alert>
          )}
          <Tabs value={s.tab} onValueChange={onTab} size="sm" variant="underline">
            <TabsList className="max-compact:overflow-x-auto">
              {TABS.map(([id, label]) => (
                <TabsTrigger key={id} value={id}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <TabBody tab={s.tab} mode={mode} />
        </div>
      </div>
    </>
  );
}

/** 확장 · 토큰 · 비용 · 실패. 요약 칸은 이 값을 더해 그린다. */
type MetricRow = readonly [name: string, tokens: number, cost: number, fails: number];
const METRIC_ROWS: readonly MetricRow[] = [
  ["helm", 1_200_000, 3.1, 1],
  ["learning", 300_000, 0.4, 0],
  ["review", 80_000, 0.2, 7],
  ["web-exa", 42_000, 0.08, 0],
  ["acme-notes", 12_000, 0.02, 2],
];

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(2))}M` : `${Math.round(n / 1000)}k`;
const fmtCost = (n: number): string => `$${n.toFixed(2)}`;

const METRIC_COLS: LineGridColumn[] = [
  { id: "tokens", label: L2("토큰", "Tokens"), width: "8rem" },
  { id: "cost", label: L2("비용", "Cost"), width: "8rem" },
  { id: "fails", label: L2("실패", "Fails"), width: "6rem" },
];

export function MetricsScreen({ mode }: { mode: MetricsMode }) {
  const many = mode === "many";
  const rows: readonly MetricRow[] = many
    ? Array.from({ length: 50 }, (_, i): MetricRow => {
        const base = METRIC_ROWS[i];
        return (
          base ?? [
            `ext-${String(i).padStart(2, "0")}`,
            ((i * 7) % 90) * 1000,
            ((i * 3) % 90) / 100,
            i % 4 === 0 ? 1 : 0,
          ]
        );
      })
    : METRIC_ROWS;
  const loading = mode === "loading";
  const sum = (f: (r: MetricRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return (
    <>
      <WorkbenchHead
        className={HEAD}
        title={L2("성능 측정과 평가", "Benchmark and evaluation")}
        actions={
          <SegmentedControl aria-label={L2("기간", "Period")} size="sm" defaultValue="7">
            <SegmentedControlItem value="1">{L2("1일", "1d")}</SegmentedControlItem>
            <SegmentedControlItem value="7">{L2("7일", "7d")}</SegmentedControlItem>
            <SegmentedControlItem value="30">{L2("30일", "30d")}</SegmentedControlItem>
          </SegmentedControl>
        }
      />
      <div className="-mt-2 min-h-0 flex-1 overflow-y-auto pt-2">
        <div className={`${BODY} gap-8`}>
          {mode === "off" ? (
            <EmptyState
              size="md"
              surface="none"
              title={L2(`${T.instrumentation}이 꺼져 있어요`, "Instrumentation is off")}
              actions={
                <Button size="sm" tone="neutral" variant="outline">
                  {L2(`${T.instrumentation} 켜기`, "Turn on instrumentation")}
                </Button>
              }
            />
          ) : mode === "empty" ? (
            <EmptyState
              size="md"
              surface="none"
              title={L2("이 기간에 기록이 없어요", "Nothing recorded in this period")}
              actions={
                <Button size="sm" tone="neutral" variant="outline">
                  {L2("30일로 넓히기", "Widen to 30 days")}
                </Button>
              }
            />
          ) : (
            <>
              <MetricBlock
                tokens={fmtTokens(sum((r) => r[1]))}
                cost={fmtCost(sum((r) => r[2]))}
                fails={String(sum((r) => r[3]))}
                loading={loading}
              />
              <div data-bleed="" className={`${GRID_BODY} gap-3`}>
                {many && (
                  <div>
                    <Input
                      size="sm"
                      variant="soft"
                      prefix={<Search />}
                      placeholder={L2("확장 찾기", "Find an extension")}
                      aria-label={L2("확장 찾기", "Find an extension")}
                      containerClassName="w-60"
                    />
                  </div>
                )}
                <LineGridFrame>
                  <LineGrid
                    label={T.metrics}
                    aria-busy={loading}
                    columns={METRIC_COLS}
                    rowHeadWidth="minmax(0, 1fr)"
                    corner={<HeadText>{T.extension}</HeadText>}
                    rows={rows.map((r, i) => ({
                      id: r[0],
                      label: loading ? (
                        <Skeleton
                          className="h-4"
                          style={{ width: `${[150, 112, 176, 124, 100][i] ?? 124}px` }}
                        />
                      ) : (
                        extName(r[0])
                      ),
                    }))}
                    cell={(rowId, c) => {
                      const r = rows.find((x) => x[0] === rowId) ?? METRIC_ROWS[0];
                      if (r === undefined) return null;
                      return c === "tokens"
                        ? valueCell(fmtTokens(r[1]), loading)
                        : c === "cost"
                          ? valueCell(fmtCost(r[2]), loading)
                          : valueCell(String(r[3]), loading, r[3] > 0);
                    }}
                  />
                </LineGridFrame>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** P-06 제안 거르기 결과 없음(N-48). 대화 영역 화면. */
export function ProposalsFilterEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-[46rem] content-start px-3 pb-8">
      <StageHead title={T.proposals} />
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            variant="soft"
            prefix={<Search />}
            aria-label={L2("제안 찾기", "Find proposals")}
            value="rollback"
            readOnly
            containerClassName="w-60"
          />
          <Select
            size="sm"
            variant="soft"
            aria-label={L2("종류", "Kind")}
            value="skill"
            className="w-36"
          >
            <SelectOption value="skill">{L2("스킬 생성", "Skill")}</SelectOption>
          </Select>
          <Select
            size="sm"
            variant="soft"
            aria-label={L2("상태", "Status")}
            value="open"
            className="w-32"
          >
            <SelectOption value="open">{L2("대기", "Open")}</SelectOption>
          </Select>
        </div>
        <NoMatch
          what={`"rollback"`}
          onClear={onClear}
          extra={
            <Button size="sm" tone="neutral" variant="ghost">
              {L2("지난 제안까지 찾기", "Include past proposals")}
            </Button>
          }
        />
      </div>
    </div>
  );
}
