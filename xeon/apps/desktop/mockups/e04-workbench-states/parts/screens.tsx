// e04 화면 조각: P-13 확장 목록, P-17 확장 상세(탭별 상태), P-20 측정, P-06 제안 거르기, P-09 키 찾기 결과 없음.
// 공통 규칙: 실패는 그 목록 바로 위 Alert 하나(DP-28), 오프라인은 머리 아래 warning inline + 쓰기 잠금(§6.0),
// 결과 없음은 찾은 말을 되풀이하고 "거르기 지우기" 하나(N-48), 읽는 중은 실제 행 모양의 Skeleton(같은 높이라 자리가 튀지 않음).
import {
  Alert,
  Button,
  EmptyState,
  IconButton,
  Input,
  ListDescription,
  ListDescriptionRow,
  Progress,
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
  L2,
  Search,
  SearchX,
  T,
  WB_WIDTH,
  WorkbenchHead,
  type Layout,
} from "../../_shell";
import type { ListMode, MetricsMode, S, TabMode } from "../flow";
import { ExtTable } from "./ext-table";

/** 결과 없음(N-48): 찾은 말 + 거르기 지우기 하나. 안내 문장을 늘이지 않는다(DP-03). */
export function NoMatch({
  what,
  onClear,
  extra,
}: {
  what: string;
  onClear?: () => void;
  extra?: ReactNode;
}) {
  return (
    <EmptyState
      size="sm"
      surface="none"
      icon={<SearchX />}
      title={L2(`${what}와 맞는 것이 없어요`, `Nothing matches ${what}`)}
      actions={
        <>
          {onClear !== undefined && (
            <Button size="xs" tone="neutral" variant="outline" onClick={onClear}>
              {L2("거르기 지우기", "Clear filters")}
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
  const what = [s.q !== "" ? `"${s.q}"` : null, s.layer !== "all" ? `${T.layer} ${s.layer}` : null]
    .filter((x) => x !== null)
    .join(" · ");
  return (
    <>
      <WorkbenchHead
        title={T.extension}
        actions={
          <>
            <Button size="xs" tone="neutral" variant="ghost" disabled={mode !== "ready"}>
              {L2("가져오기", "Import")}
            </Button>
            <Button size="xs" tone="neutral" variant="outline" disabled={mode !== "ready"}>
              {L2(`새 ${T.group}`, `New ${T.group.toLowerCase()}`)}
            </Button>
          </>
        }
        sub={
          mode === "loading" ? (
            <span>{L2("읽는 중…", "Loading…")}</span>
          ) : mode === "error" ? (
            <span>{L2("목록 없음", "No list")}</span>
          ) : (
            <span>
              {L2(`${T.extension} ${extensions.length}`, `${extensions.length} extensions`)}
              {(s.q !== "" || s.layer !== "all") &&
                L2(` · 보이는 것 ${rows.length}`, ` · showing ${rows.length}`)}
            </span>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} grid gap-3 pt-1 pb-6`}>
          <div
            role="search"
            aria-label={L2("확장 거르기", "Filter extensions")}
            className="flex flex-wrap items-center gap-1.5"
          >
            <Input
              size="xs"
              variant="soft"
              prefix={<Search />}
              placeholder={L2("이름으로 찾기", "Find by name")}
              aria-label={L2("확장 이름으로 찾기", "Find extensions by name")}
              value={s.q}
              disabled={mode !== "ready"}
              onChange={(e) => onQ(e.target.value)}
              containerClassName="w-56"
            />
            <Select
              size="xs"
              variant="soft"
              aria-label={T.layer}
              value={s.layer}
              disabled={mode !== "ready"}
              onValueChange={onLayer}
              className="w-28"
            >
              <SelectOption value="all">{L2(`${T.layer} 전체`, "All layers")}</SelectOption>
              {["L0", "L1", "L2", "L3", "plugin", "X"].map((l) => (
                <SelectOption key={l} value={l}>
                  {l}
                </SelectOption>
              ))}
            </Select>
          </div>
          {mode === "error" ? (
            <Alert
              tone="danger"
              actions={[{ label: L2("다시 읽기", "Reload"), onClick: onRetry, primary: true }]}
            >
              {L2(
                `${T.extension} 목록을 읽지 못했어요 · ext.list 시간 초과(5초)`,
                "Couldn't load the extension list · ext.list timed out (5s)",
              )}
            </Alert>
          ) : mode === "loading" ? (
            <ExtTable rows={[]} layout={layout} loading />
          ) : userOnly ? (
            <EmptyState
              size="sm"
              surface="none"
              title={L2(
                `직접 설치하거나 만든 ${T.extension}이 없어요`,
                "No extensions you installed or built",
              )}
              description={L2(
                `내장 ${T.extension} 6개는 그대로 돌아요. ${T.group}을 만들려면 ${T.compose}에서 새 ${T.group}.`,
                `The 6 built-in extensions still run. To build a group, use New group in the composer.`,
              )}
              actions={
                <Button size="xs" tone="neutral" variant="outline">
                  {L2(`새 ${T.group}`, `New ${T.group.toLowerCase()}`)}
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <NoMatch what={what} onClear={onClear} />
          ) : (
            <ExtTable rows={rows} layout={layout} />
          )}
        </div>
      </div>
    </>
  );
}

const TABS = [
  ["overview", L2("개요", "Overview")],
  ["points", T.extensionPoint],
  ["lease", L2(`임대와 상한`, "Lease and limits")],
  ["settings", L2("설정", "Settings")],
  ["metrics", T.metrics],
  ["log", L2("기록", "Log")],
  ["versions", T.version],
  ["views", L2("화면", "Views")],
] as const;

const POINTS = [
  ["input.agent.before", "collect", "10s", "12ms", "40ms", "0"],
  ["tool.call.before", "first", "30s", "3ms", "9ms", "0"],
  ["tool.execution.after", "tap", "5s", "1ms", "4ms", "0"],
  ["boundary.settle.after", "tap", "5s", "20ms", "1.2s", "1"],
  ["session.start", "tap", "5s", "8ms", "8ms", "0"],
] as const;

function PointsTable({ loading }: { loading: boolean }) {
  const grid =
    "grid grid-cols-[minmax(10rem,1fr)_4.5rem_3.5rem_3.5rem_3.5rem_3rem] items-center gap-x-3";
  return (
    <div
      role="table"
      aria-label={T.extensionPoint}
      aria-busy={loading}
      className="grid text-ui-dense"
    >
      <div role="row" className={`${grid} h-7 text-ui-xs text-text-tertiary`}>
        <span>{T.extensionPoint}</span>
        <span>fold</span>
        <span className="text-end">{L2("예산", "Budget")}</span>
        <span className="text-end">p50</span>
        <span className="text-end">p95</span>
        <span className="text-end">{L2("실패", "Fails")}</span>
      </div>
      {POINTS.map((r, i) => (
        <div key={r[0]} role="row" className={`${grid} h-8`}>
          {loading ? (
            <>
              <Skeleton className="h-3.5" style={{ width: `${[70, 55, 80, 62, 48][i]}%` }} />
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="ms-auto h-3.5 w-8" />
              <Skeleton className="ms-auto h-3.5 w-8" />
              <Skeleton className="ms-auto h-3.5 w-8" />
              <Skeleton className="ms-auto h-3.5 w-4" />
            </>
          ) : (
            <>
              <span className="truncate text-text-primary">{r[0]}</span>
              <span className="font-mono text-mono-sm text-text-tertiary">{r[1]}</span>
              <span className="text-end tabular-nums text-text-secondary">{r[2]}</span>
              <span className="text-end tabular-nums text-text-secondary">{r[3]}</span>
              <span className="text-end tabular-nums text-text-secondary">{r[4]}</span>
              <span className="text-end tabular-nums text-text-secondary">{r[5]}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** 탭 하나의 상태별 내용. 오프라인은 마지막 값을 보이고 쓰기만 잠근다. */
function TabBody({ tab, mode }: { tab: string; mode: TabMode }) {
  if (mode === "error")
    return (
      <Alert tone="danger" actions={[{ label: L2("다시 읽기", "Reload"), primary: true }]}>
        {L2(
          "이 탭을 읽지 못했어요 · ext.get 거부(권한 없음)",
          "Couldn't load this tab · ext.get refused (no permission)",
        )}
      </Alert>
    );
  if (mode === "empty") {
    const text: Record<string, string> = {
      views: L2(`이 ${T.extension}이 기여한 화면이 없어요`, "This extension contributes no views"),
      log: L2(
        "최근 기록이 없어요 · 실패나 켜짐 바뀜이 생기면 여기 쌓여요",
        "No recent log · failures and on/off changes land here",
      ),
      versions: L2("보관한 이전 버전이 없어요", "No earlier versions kept"),
      lease: L2(
        `${T.lead}을 쓰지 않는 ${T.extension}이에요`,
        "This extension doesn't use the drive lease",
      ),
      points: L2(`연결한 ${T.extensionPoint}이 없어요`, "No extension points connected"),
    };
    return (
      <EmptyState size="sm" surface="none" title={text[tab] ?? L2("자료가 없어요", "No data")} />
    );
  }
  if (tab === "points") return <PointsTable loading={mode === "loading"} />;
  if (tab === "log")
    return mode === "loading" ? (
      <div className="grid gap-2">
        {[80, 64, 72].map((w) => (
          <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
        ))}
      </div>
    ) : (
      <p className="m-0 text-ui-sm text-text-secondary">
        scope.handler_failed · boundary.settle.after · 14:03
      </p>
    );
  return (
    <ListDescription
      variant="ghost"
      size="xs"
      className="rounded-none [&_[data-slot=list-description-row]]:px-0"
    >
      <ListDescriptionRow term={L2("설명", "Description")}>
        {mode === "loading" ? (
          <Skeleton className="h-4 w-60" />
        ) : (
          L2("렌즈 여러 개로 원인을 넓게 찾는 그룹", "Finds causes widely with several lenses")
        )}
      </ListDescriptionRow>
      <ListDescriptionRow term={L2("설치 위치", "Location")} mono>
        {mode === "loading" ? <Skeleton className="h-4 w-48" /> : "~/.xeon/extensions/helm"}
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
        title={extName("helm")}
        meta={`helm · L3 · ${T.group} · ${T.trustUser} · 0.1.0`}
        actions={
          <>
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              disabled={offline || mode === "loading"}
            >
              {L2("끄기", "Turn off")}
            </Button>
            <IconButton size="xs" variant="ghost" label={L2("더 보기", "More")}>
              <Ellipsis />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} grid gap-3 pt-1 pb-6`}>
          {offline && (
            <Alert tone="warning" layout="inline">
              {L2(
                "엔진에 연결되면 바꿀 수 있어요 · 마지막 값 14:03",
                "You can change this once the engine is connected · last values 14:03",
              )}
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

const METRIC_ROWS = [
  ["helm", "1.2M", "$3.10", "41m", "1", "12"],
  ["learning", "300k", "$0.40", "—", "0", "0"],
  ["review", "80k", "$0.20", "6m", "7", "3"],
  ["web-exa", "42k", "$0.08", "—", "0", "0"],
  ["acme-notes", "12k", "$0.02", "—", "2", "0"],
] as const;

export function MetricsScreen({ mode, layout }: { mode: MetricsMode; layout: Layout }) {
  const many = mode === "many";
  const rows = many
    ? Array.from({ length: 64 }, (_, i) => {
        const base = METRIC_ROWS[i % METRIC_ROWS.length] ?? METRIC_ROWS[0];
        return i < METRIC_ROWS.length
          ? base
          : ([
              `ext-${String(i).padStart(2, "0")}`,
              `${(i * 7) % 90}k`,
              `$0.${String((i * 3) % 90).padStart(2, "0")}`,
              "—",
              `${i % 4 === 0 ? 1 : 0}`,
              "0",
            ] as const);
      })
    : METRIC_ROWS;
  const compact = layout === "compact";
  const grid = compact
    ? "grid grid-cols-[minmax(0,1fr)_4rem_4rem_3rem] items-center gap-x-3"
    : "grid grid-cols-[minmax(9rem,1fr)_5rem_5rem_5rem_3.5rem_3.5rem] items-center gap-x-3";
  return (
    <>
      <WorkbenchHead
        title={L2("측정과 평가", "Measurements and evaluation")}
        actions={
          <SegmentedControl aria-label={L2("기간", "Period")} size="xs" defaultValue="7">
            <SegmentedControlItem value="1">{L2("1일", "1d")}</SegmentedControlItem>
            <SegmentedControlItem value="7">{L2("7일", "7d")}</SegmentedControlItem>
            <SegmentedControlItem value="30">{L2("30일", "30d")}</SegmentedControlItem>
          </SegmentedControl>
        }
        sub={
          many ? (
            <span>
              {L2(
                `${T.extension} 64 · 위 50개만 그리고 스크롤하면 이어서`,
                "64 extensions · first 50 drawn, more on scroll",
              )}
            </span>
          ) : mode === "loading" ? (
            <span>{L2("읽는 중…", "Loading…")}</span>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} grid gap-3 pt-1 pb-6`}>
          {mode === "off" ? (
            <Alert
              tone="neutral"
              actions={[{ label: L2("계측 켜기", "Turn on instrumentation"), primary: true }]}
            >
              {L2(
                `${T.instrumentation}이 꺼져 있어 기록이 없어요 · l3.group-kit.instrumentation`,
                "Instrumentation is off, so there's nothing recorded · l3.group-kit.instrumentation",
              )}
            </Alert>
          ) : mode === "empty" ? (
            <EmptyState
              size="sm"
              surface="none"
              title={L2("이 기간에 기록이 없어요", "Nothing recorded in this period")}
              description={L2(
                `대화에서 ${T.group}이 돌면 쌓여요. 기간을 30일로 넓혀 볼 수 있어요.`,
                "Records appear once groups run in conversations. Try 30 days.",
              )}
            />
          ) : (
            <>
              {many && (
                <Input
                  size="xs"
                  variant="soft"
                  prefix={<Search />}
                  placeholder={L2("확장 찾기", "Find an extension")}
                  aria-label={L2("확장 찾기", "Find an extension")}
                  containerClassName="w-56"
                />
              )}
              <div
                role="table"
                aria-label={T.metrics}
                aria-rowcount={rows.length + 1}
                aria-busy={mode === "loading"}
                className="grid text-ui-dense"
              >
                <div
                  role="row"
                  className={`${grid} sticky top-0 z-[1] h-7 bg-bg-app text-ui-xs text-text-tertiary`}
                >
                  <span>{T.extension}</span>
                  <span className="text-end">{L2("토큰", "Tokens")}</span>
                  <span className="text-end">{L2("비용", "Cost")}</span>
                  {!compact && <span className="text-end">{L2("임대 시간", "Lease time")}</span>}
                  {!compact && <span className="text-end">{L2("실패", "Fails")}</span>}
                  <span className="text-end">{L2("거부", "Denies")}</span>
                </div>
                {(mode === "loading" ? METRIC_ROWS : rows.slice(0, 50)).map((r, i) => (
                  <div
                    key={`${r[0]}-${i}`}
                    role="row"
                    aria-rowindex={i + 2}
                    className={`${grid} h-8`}
                  >
                    {mode === "loading" ? (
                      <>
                        <Skeleton
                          className="h-3.5"
                          style={{ width: `${[60, 45, 70, 50, 40][i]}%` }}
                        />
                        <Skeleton className="ms-auto h-3.5 w-10" />
                        <Skeleton className="ms-auto h-3.5 w-10" />
                        {!compact && <Skeleton className="ms-auto h-3.5 w-8" />}
                        {!compact && <Skeleton className="ms-auto h-3.5 w-4" />}
                        <Skeleton className="ms-auto h-3.5 w-4" />
                      </>
                    ) : (
                      <>
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate font-medium text-text-primary">
                            {extName(r[0])}
                          </span>
                          {extName(r[0]) !== r[0] && (
                            <span className="truncate font-mono text-mono-sm text-text-tertiary">
                              {r[0]}
                            </span>
                          )}
                        </span>
                        <span className="text-end tabular-nums text-text-secondary">{r[1]}</span>
                        <span className="text-end tabular-nums text-text-secondary">{r[2]}</span>
                        {!compact && (
                          <span className="text-end tabular-nums text-text-secondary">{r[3]}</span>
                        )}
                        {!compact && (
                          <span className="text-end tabular-nums text-text-secondary">{r[4]}</span>
                        )}
                        <span className="text-end tabular-nums text-text-secondary">{r[5]}</span>
                      </>
                    )}
                  </div>
                ))}
                {many && (
                  <div role="row" className="grid h-8 items-center">
                    <span className="flex items-center gap-2 text-ui-xs text-text-tertiary">
                      <Progress value={78} size="xs" decorative className="w-12" />
                      {L2("14개 더 읽는 중…", "Loading 14 more…")}
                    </span>
                  </div>
                )}
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
    <div className="mx-auto grid w-full max-w-[46rem] content-start gap-3 px-3">
      <header className="flex h-10 items-center gap-2">
        <h1 className="m-0 flex-1 text-ui-strong text-text-primary">{T.proposals}</h1>
      </header>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          size="xs"
          variant="soft"
          prefix={<Search />}
          aria-label={L2("제안 찾기", "Find proposals")}
          value="rollback"
          readOnly
          containerClassName="w-56"
        />
        <Select
          size="xs"
          variant="soft"
          aria-label={L2("종류", "Kind")}
          value="skill"
          className="w-32"
        >
          <SelectOption value="skill">{L2("스킬 생성", "Skill")}</SelectOption>
        </Select>
        <Select
          size="xs"
          variant="soft"
          aria-label={L2("상태", "Status")}
          value="open"
          className="w-28"
        >
          <SelectOption value="open">{L2("대기", "Open")}</SelectOption>
        </Select>
      </div>
      <NoMatch
        what={`"rollback" · ${L2("스킬 생성", "Skill")} · ${L2("대기", "Open")}`}
        onClear={onClear}
        extra={
          <Button size="xs" tone="neutral" variant="ghost">
            {L2("지난 제안까지 찾기", "Include past proposals")}
          </Button>
        }
      />
    </div>
  );
}
