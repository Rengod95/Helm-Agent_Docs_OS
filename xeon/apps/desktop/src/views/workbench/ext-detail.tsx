// P-17 플러그인 상세("자세히 보기"). 여섯 탭(plugTab, AGE-76), 탭 하나는 질문 하나에 답하고 이어진 구역은 두 단으로 둔다(`TwoColumns`, 좁으면 한 단):
// 개요(`detail-overview.tsx`: 하는 일 / 쓰임과 믿음, 준비 상태), 구성(멤버와 Drive 단계 / 훅 표), 의존(기대는 것 / 기대어 오는 것, 아래 기능 연결 표),
// 화면과 설정(화면과 대화 기능 / 설정 폼과 설정 화면), 상태(메트릭 / 실패 기록), 버전(§6.24.1, 신뢰 수준 포함). 옛 탭 값은 `detailTabOf`가 옮긴다.
// 머리 줄: 이름(표시 이름 + 회색 mono id), 종류, 출처, 버전, 쓰는 곳, 문제가 있으면 상태. 층 id와 등급 같은 내부 말은 머리에 두지 않는다.
// 머리 행동: 프로필에 넣기(체크 메뉴), 테스트 챗, 내보내기, "…" 메뉴의 지우기. 앱 핵심 플러그인은 행동 대신 자물쇠 문장을 늘 보인다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  failureRowsOf,
  inspectHookRowsOf,
  detailTabOf,
  rowOf,
  type DetailTab,
  type ExtRowVM,
  type FailureRowVM,
  type InspectHookVM,
} from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ExtTimingsResult, PluginCard } from "@fresnel/contracts/extensions";
import type { ExtGetResult, ExtListEntry } from "@fresnel/contracts/wire";
import { PanelExpandButton } from "../shell/screen-header.tsx";
import {
  Alert,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Progress,
  Skeleton,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type TableColumn,
} from "@caustic/react";
import { Ellipsis, Lock } from "@caustic/react/icons";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { useHandlerFailures, useLinkPhase } from "../../state/engine/index.ts";
import { useWorkThreadId } from "../craft/test-chat/borrow-state.ts";
import { TestChatButton } from "../craft/test-chat/test-chat-button.tsx";
import { hasMembers } from "../craft/members/members-model.ts";
import { MembersTab } from "../craft/members/members-tab.tsx";
import { DepsTab } from "../craft/deps/deps-tab.tsx";
import { CompositionTab } from "../craft/composition/composition-tab.tsx";
import { BindingsPanel } from "./bindings-panel.tsx";
import { AutoOffNotice } from "./craft-parts.tsx";
import { kindText } from "./ext-row.tsx";
import { ExportExtension } from "./export-extension.tsx";
import { DetailOverview } from "./detail-overview.tsx";
import { HealthCell, rowHealthOf } from "./plugin-list.tsx";
import { ProfilePutMenu, type ProfileSetLoad } from "./profile-put-menu.tsx";
import { profileUseOf, profileUseText } from "./profile-use.ts";
import { removableOf } from "./remove-model.ts";
import { MetricsTab } from "./metrics-tab.tsx";
import { SurfacesTab } from "./surfaces-tab.tsx";
import { ColumnHead, MUTED, PLAIN_TABLE, TwoColumns } from "./tab-body.tsx";
import { originText } from "./origin-text.ts";
import { kindWord, pluginKindOf } from "./plugin-kind.tsx";
import { readinessBlocked, type ToolReadinessVM } from "./tool-ready.ts";
import { VersionsTab } from "./versions-tab.tsx";

/** 칸에 값이 없을 때의 자리 글 */
const DASH = "—";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly result: ExtGetResult };

type TimingsLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly result: ExtTimingsResult };

/** 머리의 이름: 표시 이름, 옆에 회색 mono id(DP-39). 표시 이름이 없으면 id만 */
function DetailName(props: { readonly row: ExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <h2 className="m-0 inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 text-ui-strong text-text-primary">
      <span className="min-w-0 truncate">{row.displayName ?? row.name}</span>
      {row.displayName !== null && (
        <span className="font-mono text-mono-sm font-normal text-text-tertiary">{row.name}</span>
      )}
    </h2>
  );
}

/** 훅 fold의 사용자 글(용어 `fold`: 보기·막기·고치기·모으기). 알려지지 않은 훅은 글이 없다 */
export const FOLD_TEXT: Readonly<Record<string, MessageId>> = {
  tap: "desktop.inspect.fold.tap",
  first: "desktop.inspect.fold.first",
  chain: "desktop.inspect.fold.chain",
  collect: "desktop.inspect.fold.collect",
};

function foldWordOf(fold: string | null): string {
  const id = fold === null ? undefined : FOLD_TEXT[fold];
  return id === undefined ? DASH : t(id);
}

/** 예산 막대의 색: 50% 넘으면 warning, 100%면 danger(§6.24). 보통은 강조색 */
export const BAR_TONE = { normal: "accent", warning: "warning", danger: "danger" } as const;

/** ms 값의 글. 1초 이상은 초로 줄인다(wb-opus 훅 표와 같다) */
function msText(value: number): string {
  return value >= 1000 ? `${value / 1000}s` : `${value}ms`;
}

/** 예산 대비 칸: 계측이 있으면 막대와 퍼센트, 없으면 자리 글 */
function budgetUseCell(row: InspectHookVM): ReactNode {
  if (row.p95Ms === null || row.level === null || row.budgetMs <= 0) {
    return <span className="text-text-tertiary">{DASH}</span>;
  }
  const ratio = row.p95Ms / row.budgetMs;
  return (
    <span className="flex items-center gap-2">
      <Progress
        value={Math.max(2, Math.round(ratio * 100))}
        size="xs"
        tone={BAR_TONE[row.level]}
        label={t("desktop.workbench.detail.hooks.col.use")}
        className="w-14"
      />
      <span className="text-ui-xs tabular-nums text-text-tertiary">
        {ratio < 0.01 ? "<1%" : `${Math.round(ratio * 100)}%`}
      </span>
    </span>
  );
}

/** 훅 표의 열 */
type HookColumn = "hook" | "fold" | "budget" | "p95" | "use" | "failures";

const HOOK_COLUMNS: readonly HookColumn[] = ["hook", "fold", "budget", "p95", "use", "failures"];

/** 표 열의 키(문자열)를 열 이름으로 바꾼다. 열 이름이 아니면 undefined */
function hookColumnOf(key: string): HookColumn | undefined {
  return HOOK_COLUMNS.find((column) => column === key);
}

/** 훅 표 한 칸의 내용 */
function hookCell(row: InspectHookVM, column: HookColumn): ReactNode {
  switch (column) {
    case "hook":
      return <span className="text-text-primary">{row.hook}</span>;
    case "fold":
      return <span className="text-text-secondary">{foldWordOf(row.fold)}</span>;
    case "budget":
      return <span className="text-text-secondary">{msText(row.budgetMs)}</span>;
    case "p95":
      return (
        <span className="text-text-primary">{row.p95Ms === null ? DASH : msText(row.p95Ms)}</span>
      );
    case "use":
      return budgetUseCell(row);
    case "failures":
      return (
        <span
          className={
            row.failures !== null && row.failures > 0 ? "text-text-primary" : "text-text-tertiary"
          }
        >
          {row.failures === null ? DASH : String(row.failures)}
        </span>
      );
    default:
      return assertNever(column, "hookCell");
  }
}

/**
 * 훅 표(wb-opus 훅 탭): 훅, fold, 예산, p95, 예산 대비 막대, 실패. 계측이 없는 칸은 자리 글이고,
 * 계측이 꺼졌으면 표 위 한 줄로 알린다
 */
function HookTable(props: {
  readonly rows: readonly InspectHookVM[];
  readonly traceOff: boolean;
}): ReactNode {
  const columns: TableColumn[] = [
    { key: "hook", header: t("term.hook") },
    { key: "fold", header: t("term.fold") },
    { key: "budget", header: t("desktop.workbench.detail.hooks.budget"), align: "end" },
    { key: "p95", header: "p95", align: "end" },
    { key: "use", header: t("desktop.workbench.detail.hooks.col.use") },
    { key: "failures", header: t("desktop.workbench.detail.hooks.col.failures"), align: "end" },
  ];
  return (
    <div className="grid gap-2">
      {props.traceOff && <p className={MUTED}>{t("desktop.inspect.hook.traceOff")}</p>}
      <Table
        variant="ghost"
        size="xs"
        aria-label={t("desktop.workbench.detail.tab.hooks")}
        className={PLAIN_TABLE}
        columns={columns}
        rows={props.rows.map((_, index) => ({ id: String(index) }))}
        renderCell={(picked, column) => {
          const row = props.rows[Number(picked.id)];
          const name = hookColumnOf(column.key);
          if (row === undefined || name === undefined) return null;
          return hookCell(row, name);
        }}
      />
    </div>
  );
}

function HooksTab(props: { readonly get: Load; readonly timings: TimingsLoad }): ReactNode {
  if (props.get.kind === "loading") return <Skeleton height={24} />;
  if (props.get.kind === "error") {
    return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
  }
  // 계측을 못 읽었거나 꺼졌으면 측정 칸은 자리 글이다(예산과 fold는 확장 읽기만으로 보인다)
  const ready = props.timings.kind === "ready" ? props.timings.result : null;
  const measured = ready !== null && ready.traceEnabled ? ready.timings : [];
  const rows = inspectHookRowsOf(props.get.result.hooks, measured);
  if (rows.length === 0)
    return <p className={MUTED}>{t("desktop.workbench.detail.hooks.empty")}</p>;
  return <HookTable rows={rows} traceOff={ready !== null && !ready.traceEnabled} />;
}

/** 기록 표의 열 */
type FailureColumn = "point" | "result" | "message" | "count" | "consecutive";

const FAILURE_COLUMNS: readonly FailureColumn[] = [
  "point",
  "result",
  "message",
  "count",
  "consecutive",
];

/** 표 열의 키(문자열)를 열 이름으로 바꾼다. 열 이름이 아니면 undefined */
function failureColumnOf(key: string): FailureColumn | undefined {
  return FAILURE_COLUMNS.find((column) => column === key);
}

/** 표 한 칸의 글 */
function failureCell(row: FailureRowVM, column: FailureColumn): string {
  switch (column) {
    case "point":
      return row.point;
    case "result":
      return row.result;
    case "message":
      return row.message;
    case "count":
      return String(row.count);
    case "consecutive":
      return String(row.consecutive);
    default:
      return assertNever(column, "failureCell");
  }
}

/** 기록 탭 그림: 엔진 연결이 실패했으면 오류 한 줄, 기록이 없으면 빈 문장, 있으면 선 없는 표 하나(훅·결과·메시지·횟수·연속) */
export function FailureRecords(props: {
  readonly rows: readonly FailureRowVM[];
  readonly failed: boolean;
}): ReactNode {
  if (props.failed) {
    return <Alert tone="danger">{t("desktop.workbench.detail.record.failed")}</Alert>;
  }
  if (props.rows.length === 0) {
    return <p className={MUTED}>{t("desktop.workbench.detail.record.empty")}</p>;
  }
  // 머리글은 그릴 때 고른다. 말투(로케일)가 연결 뒤에 바뀔 수 있다
  const columns: TableColumn[] = [
    { key: "point", header: t("desktop.workbench.detail.record.col.hook") },
    { key: "result", header: t("desktop.workbench.detail.record.col.result") },
    { key: "message", header: t("desktop.workbench.detail.record.col.message") },
    { key: "count", header: t("desktop.workbench.detail.record.col.count"), align: "end" },
    {
      key: "consecutive",
      header: t("desktop.workbench.detail.record.col.consecutive"),
      align: "end",
    },
  ];
  return (
    <Table
      variant="ghost"
      size="xs"
      aria-label={t("desktop.workbench.detail.tab.record")}
      className={PLAIN_TABLE}
      columns={columns}
      rows={props.rows.map((_, index) => ({ id: String(index) }))}
      renderCell={(picked, column) => {
        const row = props.rows[Number(picked.id)];
        const name = failureColumnOf(column.key);
        if (row === undefined || name === undefined) return null;
        return failureCell(row, name);
      }}
    />
  );
}

/** 기록 탭: 이 확장의 `scope.handler_failed`를 엔진 거울에서 읽어 묶는다. 안전 모드·자동 꺼짐 띠는 건드리지 않는다 */
function RecordTab(props: { readonly name: string }): ReactNode {
  const records = useHandlerFailures();
  const failed = useLinkPhase() === "failed";
  return <FailureRecords rows={failureRowsOf(records, props.name)} failed={failed} />;
}

/** 단 안의 구역: 머리 글과 그 내용. 머리와 내용 사이는 `gap-3`이다 */
function Part(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="grid gap-3">
      <ColumnHead title={props.title} />
      {props.children}
    </div>
  );
}

/**
 * 구성 탭(plugTab): 왼쪽 단은 멤버(있을 때)와 Drive 단계(Drive 플러그인일 때), 둘 다 없으면 한 줄이다.
 * 오른쪽 단은 훅 표다. Drive 단계는 읽기 전용이라 편집 단추는 없다
 */
function BuildTab(props: {
  readonly entry: ExtListEntry;
  readonly get: Load;
  readonly timings: TimingsLoad;
}): ReactNode {
  const { entry, get } = props;
  const manifest = get.kind === "ready" ? get.result.manifest : null;
  const withMembers = hasMembers(entry);
  const withComposition = entry.isOrchestration;
  const start =
    withMembers || withComposition ? (
      <>
        {withMembers && (
          <Part title={t("desktop.craft.members.tab")}>
            <MembersTab entry={entry} manifest={manifest} />
          </Part>
        )}
        {withComposition && (
          <Part title={t("desktop.craft.composition.tab")}>
            <CompositionTab name={entry.name} manifest={manifest} failed={get.kind === "error"} />
          </Part>
        )}
      </>
    ) : (
      <p className={MUTED}>{t("desktop.workbench.detail.build.none")}</p>
    );
  return (
    <TwoColumns
      start={start}
      end={
        <Part title={t("desktop.workbench.detail.tab.hooks")}>
          <HooksTab get={get} timings={props.timings} />
        </Part>
      }
    />
  );
}

/** 앱 핵심 플러그인의 자물쇠 문장. 끄기, 지우기, 프로필에 넣기 대신 늘 보인다(정보 아이콘 뒤에 숨기지 않는다) */
function CoreLockLine(): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 text-ui-sm text-text-secondary">
      <Lock aria-hidden className="size-icon-sm" />
      <span>{t("desktop.workbench.core.locked")}</span>
    </span>
  );
}

export function ExtDetail(props: {
  readonly entry: ExtListEntry;
  /** 지금 고른 탭(스토어 값). 기록 보기처럼 밖에서 연 때 그 탭이다. 옛 이름이면 `detailTabOf`로 옮긴다 */
  readonly tab: DetailTab;
  /** 플러그인 카드(`plugin.list`). 읽지 못했으면 null이다. 개요 탭이 쓴다 */
  readonly card: PluginCard | null;
  /** 준비 상태(`usePluginCards().readinessOf`). 도구와 상관없는 플러그인이면 null이다. 개요 탭과 머리의 상태가 쓴다 */
  readonly readiness: ToolReadinessVM | null;
  readonly profiles: ProfileSetLoad;
  readonly onTab: (tab: DetailTab) => void;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly onStop: () => void;
  readonly onRemove: () => void;
  /** 준비 상태의 "다시 확인": 엔진에 도구 점검을 다시 시키고 카드를 다시 읽는다 */
  readonly onRecheck: () => void;
}): ReactNode {
  const commands = useCommands();
  // 훅 시간은 테스트 챗 창이 빌린 대화가 아니라 빌리기 전의 대화로 읽는다(C7)
  const threadId = useWorkThreadId();
  const { entry } = props;
  const row = rowOf(entry);
  const title = row.displayName ?? row.name;
  const profileSet = props.profiles.set;
  // 스토어에 옛 탭 이름이 남아 있어도 지금의 탭으로 옮겨 연다(모르는 값은 개요)
  const tab = detailTabOf(props.tab) ?? "overview";
  const [get, setGet] = useState<Load>({ kind: "loading" });
  const [timings, setTimings] = useState<TimingsLoad>({ kind: "loading" });
  useEffect(() => {
    detach(
      commands.workbench.get(entry.name).then((r) => {
        setGet(r.ok ? { kind: "ready", result: r.value } : { kind: "error" });
        return undefined;
      }),
      rethrow,
    );
  }, [commands, entry.name]);
  useEffect(() => {
    detach(
      commands.workbench.timings(entry.name, threadId ?? undefined).then((r) => {
        setTimings(r.ok ? { kind: "ready", result: r.value } : { kind: "error" });
        return undefined;
      }),
      rethrow,
    );
  }, [commands, entry.name, threadId]);
  // 머리의 종류는 목록의 종류 칸과 같은 규칙(카드의 종류)이다. 카드를 못 읽었으면 묶음 종류(옛 글)로 둔다
  const cardKind = pluginKindOf(props.card);
  const kindLine = cardKind === null ? kindText(row.kind) : kindWord(cardKind);
  const blocked = readinessBlocked(props.readiness);
  return (
    <article className="@container/detail grid min-h-0 content-start gap-3 py-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PanelExpandButton />
        <Button size="xs" variant="ghost" onClick={props.onBack}>
          {t("desktop.workbench.detail.back")}
        </Button>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <DetailName row={row} />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui-sm text-text-tertiary">
            <span>{kindLine}</span>
            {entry.origin === undefined ? null : <span>{originText(entry.origin)}</span>}
            <span>{row.version}</span>
            {profileSet === null ? null : (
              <span className="text-text-secondary">
                {profileUseText(profileUseOf(entry.name, row.appCore, profileSet))}
              </span>
            )}
            {rowHealthOf(row, blocked) === "ready" ? null : (
              <HealthCell row={row} blocked={blocked} />
            )}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {row.appCore ? (
            <CoreLockLine />
          ) : (
            <>
              <ProfilePutMenu name={entry.name} title={title} load={props.profiles} />
              <TestChatButton plugin={entry.name} />
              {removableOf(entry) && <ExportExtension entry={entry} />}
              {removableOf(entry) && (
                <Menu
                  size="sm"
                  align="end"
                  aria-label={t("desktop.workbench.detail.menu")}
                  trigger={
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={t("desktop.workbench.detail.menu")}
                    >
                      <Ellipsis aria-hidden />
                    </IconButton>
                  }
                >
                  <MenuItem onSelect={props.onRemove}>
                    {t("desktop.workbench.remove.open")}
                  </MenuItem>
                </Menu>
              )}
            </>
          )}
        </div>
      </header>
      <AutoOffNotice entry={entry} onRetry={props.onRetry} onStop={props.onStop} />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = detailTabOf(value);
          if (next !== null) props.onTab(next);
        }}
        variant="soft"
        size="xs"
        className="gap-4"
      >
        <TabsList>
          <TabsTrigger value="overview">{t("desktop.workbench.detail.tab.overview")}</TabsTrigger>
          <TabsTrigger value="build">{t("desktop.workbench.detail.tab.build")}</TabsTrigger>
          <TabsTrigger value="dependencies">{t("desktop.craft.deps.tab")}</TabsTrigger>
          <TabsTrigger value="surfaces">{t("desktop.workbench.detail.tab.surfaces")}</TabsTrigger>
          <TabsTrigger value="health">{t("desktop.workbench.detail.tab.health")}</TabsTrigger>
          <TabsTrigger value="versions">{t("desktop.workbench.detail.tab.versions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <DetailOverview
            entry={entry}
            card={props.card}
            readiness={props.readiness}
            profiles={props.profiles}
            onRecheck={props.onRecheck}
          />
        </TabsContent>
        <TabsContent value="build">
          <BuildTab entry={entry} get={get} timings={timings} />
        </TabsContent>
        <TabsContent value="dependencies">
          <div className="grid gap-6">
            <DepsTab entry={entry} />
            {/* 목록 맨 위에 있던 기능 연결 표(B-05)는 여기로 옮겼다(AGE-76 plugMin). 두 단 아래 전체 폭이다 */}
            <BindingsPanel />
          </div>
        </TabsContent>
        <TabsContent value="surfaces">
          <SurfacesTab entry={entry} />
        </TabsContent>
        <TabsContent value="health">
          <TwoColumns
            start={
              <Part title={t("desktop.workbench.detail.tab.metrics")}>
                <MetricsTab entry={entry} />
              </Part>
            }
            end={
              <Part title={t("desktop.workbench.detail.tab.record")}>
                <RecordTab name={entry.name} />
              </Part>
            }
          />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsTab key={entry.name} entry={entry} locked={row.lock !== null} />
        </TabsContent>
      </Tabs>
    </article>
  );
}
