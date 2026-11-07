// P-17 확장 상세("자세히 보기"). 탭: 개요(위치·등급·기능 연결·진단), 훅(`ext.get`·`ext.timings`, wb-opus 훅 표), 설정(`settings.list`·`settings.get`, 읽기 전용, 확장이 그린 부분은 설정 탭 안),
// 측정(`group.metrics`, 그룹만), 기록(`scope.handler_failed`), 버전(§6.24.1), 화면(`ext.ui.list`).
// 머리 줄: 이름(표시 이름 + 회색 mono id), 층 mono · 종류 · 설치 위치 · 버전, 상태 점과 범위 글(ADR-0022 §3.3, 배지는 두지 않는다).
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  enabledScopeOf,
  failureRowsOf,
  inspectHookRowsOf,
  isDetailTab,
  rowOf,
  type DetailTab,
  type ExtRowVM,
  type FailureRowVM,
  type InspectHookVM,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ExtTimingsResult } from "@fresnel/contracts/extensions";
import type { ExtGetResult, ExtListEntry } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  Menu,
  MenuItem,
  Progress,
  Skeleton,
  StatusDot,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type TableColumn,
} from "@caustic/react";
import { Ellipsis } from "@caustic/react/icons";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { useHandlerFailures, useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useShellActions, type ShellActions } from "../../state/shell/index.ts";
import { usePluginUiState } from "../plugin/plugin-context.tsx";
import { InfoTip } from "../craft/info-tip.tsx";
import { AutoOffNotice } from "./craft-parts.tsx";
import { kindText, lockText, stateText, stateTone } from "./ext-row.tsx";
import { removableOf } from "./remove-model.ts";
import { MetricsTab } from "./metrics-tab.tsx";
import { scopeText } from "./source-badge.tsx";
import { ScreensTab } from "./screens-tab.tsx";
import { SettingsTab } from "./settings-tab.tsx";
import { MUTED, PLAIN_TABLE } from "./tab-body.tsx";
import { originText } from "./trust-dialog.tsx";
import { VersionsTab } from "./versions-tab.tsx";

/** 확장 상세의 설명 목록 자리: 줄 머리 8rem, 바깥 칸 없이 */
const LD = "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

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

function Overview(props: { readonly entry: ExtListEntry; readonly get: Load }): ReactNode {
  const { entry } = props;
  const bindings = props.get.kind === "ready" ? props.get.result.bindings : [];
  return (
    <div className="grid gap-3">
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.workbench.detail.tab.overview")}
        className={`${LD} max-w-176`}
      >
        <ListDescriptionRow term={t("desktop.workbench.detail.origin")}>
          {originText(entry.origin)}{" "}
          <span className="font-mono text-mono-sm text-text-tertiary">{entry.location}</span>
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.workbench.detail.grade")}>
          {t("desktop.workbench.detail.grade.value", {
            requested: entry.requestedGrade,
            effective: entry.effectiveGrade,
          })}
        </ListDescriptionRow>
        {/* 기능 줄은 첫 줄에만 "Capabilities" 글을 단다. 나머지 줄은 글 없이 이어진다 */}
        {bindings.map((b, index) => (
          <ListDescriptionRow
            key={`${b.registrationId}:${b.relation}:${b.capability}`}
            term={index === 0 ? t("desktop.workbench.detail.bindings") : ""}
          >
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-mono-sm text-text-tertiary">{b.relation}</span>
              <span className="font-mono text-mono-sm text-text-primary">{b.capability}</span>
              <span className="text-text-tertiary">
                {b.satisfied
                  ? t("desktop.workbench.detail.binding.ok")
                  : t("desktop.workbench.detail.binding.unmet")}
              </span>
            </span>
          </ListDescriptionRow>
        ))}
      </ListDescription>
      {entry.diagnostics.length > 0 && (
        <section aria-label={t("desktop.workbench.detail.diagnostics")} className="grid gap-1">
          {entry.diagnostics.map((d) => (
            <Alert
              key={`${d.code}:${d.message}`}
              tone={d.severity === "error" ? "danger" : "warning"}
              layout="inline"
              size="sm"
            >
              {d.message}
              {d.file !== undefined && (
                <span className="font-mono">
                  {" "}
                  {d.file}
                  {d.line === undefined ? "" : `:${d.line}`}
                </span>
              )}
            </Alert>
          ))}
        </section>
      )}
    </div>
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

/** 플러그인 화면으로 간다: 대화 영역의 `plugins` 화면(내비 항목 하나). 영역과 그 자리를 셸 행동으로 바꾼다 */
export function openPluginScreens(shell: ShellActions): void {
  shell.switchArea("chat");
  shell.updatePlace({ screen: "plugins", scroll: 0 });
}

/**
 * "플러그인 화면 열기" 단추. 이 확장이 플러그인 화면 항목(`page`, 또는 Helm이 아닌 확장의 `panel`)을 가졌을 때만 그린다.
 * 기준은 `PluginPagesTab`이 그리는 항목과 같다(Helm 확장의 `panel`은 Helm 탭이 그린다)
 */
function PluginScreensLink(props: { readonly name: string }): ReactNode {
  const plugin = usePluginUiState();
  const shell = useShellActions();
  const ownsPage = plugin.groups.page.some(({ entry }) => entry.extension === props.name);
  const ownsPanel =
    props.name !== "helm" &&
    plugin.groups.panel.some(({ entry }) => entry.extension === props.name);
  if (!ownsPage && !ownsPanel) return null;
  return (
    <div className="flex">
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          openPluginScreens(shell);
        }}
      >
        {t("desktop.workbench.detail.openPluginScreens")}
      </Button>
    </div>
  );
}

/** 기록 탭: 이 확장의 `scope.handler_failed`를 엔진 거울에서 읽어 묶는다. 안전 모드·자동 꺼짐 띠는 건드리지 않는다 */
function RecordTab(props: { readonly name: string }): ReactNode {
  const records = useHandlerFailures();
  const failed = useLinkPhase() === "failed";
  return <FailureRecords rows={failureRowsOf(records, props.name)} failed={failed} />;
}

export function ExtDetail(props: {
  readonly state: WorkbenchState;
  readonly entry: ExtListEntry;
  /** 지금 고른 탭(스토어 값). 기록 보기처럼 밖에서 연 때 그 탭이다 */
  readonly tab: DetailTab;
  readonly onTab: (tab: DetailTab) => void;
  readonly onBack: () => void;
  readonly onToggle: (target: boolean) => void;
  readonly onKeepOn: () => void;
  readonly onKeepOff: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  const commands = useCommands();
  const threadId = useOpenThreadId();
  const { entry } = props;
  const row = rowOf(entry, props.state.pending);
  const scope = enabledScopeOf(entry.enabledSource);
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
  const statusText =
    scope === null ? stateText(row.state) : `${stateText(row.state)} · ${scopeText(scope)}`;
  return (
    <article className="grid min-h-0 content-start gap-3 p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="xs" variant="ghost" onClick={props.onBack}>
          {t("desktop.workbench.detail.back")}
        </Button>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <DetailName row={row} />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui-sm text-text-tertiary">
            <span className="font-mono text-mono-sm">{row.layer}</span>
            <span>
              {`${kindText(row.kind)}${entry.origin === undefined ? "" : ` · ${originText(entry.origin)}`} · ${row.version}`}
            </span>
            <StatusDot tone={stateTone(row.state)} label={statusText} />
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {/* 시안 c02 머리: "끄기" 단추 하나와 "…" 메뉴. 켜기·끄기 요청은 스위치와 같은 `onToggle`이다 */}
          <Button
            size="xs"
            variant="outline"
            disabled={row.lock !== null || row.pendingTarget !== null}
            onClick={() => {
              props.onToggle(!row.on);
            }}
          >
            {t(row.on ? "desktop.workbench.detail.turnOff" : "desktop.workbench.detail.turnOn")}
          </Button>
          {/* 잠긴 이유는 설명 한 줄이라 정보 아이콘 뒤에 둔다(DP-58) */}
          {row.lock === null ? null : <InfoTip text={lockText(row.lock)} />}
          {removableOf(entry) ? (
            <Menu
              size="sm"
              align="end"
              aria-label={t("desktop.workbench.detail.menu")}
              trigger={
                <IconButton size="sm" variant="ghost" label={t("desktop.workbench.detail.menu")}>
                  <Ellipsis aria-hidden />
                </IconButton>
              }
            >
              <MenuItem onSelect={props.onRemove}>{t("desktop.workbench.remove.open")}</MenuItem>
            </Menu>
          ) : (
            <InfoTip text={t("desktop.workbench.remove.locked")} />
          )}
        </div>
      </header>
      <AutoOffNotice entry={entry} onKeepOn={props.onKeepOn} onKeepOff={props.onKeepOff} />
      <PluginScreensLink name={entry.name} />
      <Tabs
        value={props.tab}
        onValueChange={(value) => {
          if (isDetailTab(value)) props.onTab(value);
        }}
        variant="soft"
        size="xs"
      >
        <TabsList>
          <TabsTrigger value="overview">{t("desktop.workbench.detail.tab.overview")}</TabsTrigger>
          <TabsTrigger value="hooks" count={entry.hookCount}>
            {t("desktop.workbench.detail.tab.hooks")}
          </TabsTrigger>
          <TabsTrigger value="settings">{t("desktop.workbench.detail.tab.settings")}</TabsTrigger>
          <TabsTrigger value="metrics">{t("desktop.workbench.detail.tab.metrics")}</TabsTrigger>
          <TabsTrigger value="record">{t("desktop.workbench.detail.tab.record")}</TabsTrigger>
          <TabsTrigger value="versions">{t("desktop.workbench.detail.tab.versions")}</TabsTrigger>
          <TabsTrigger value="screens">{t("desktop.workbench.detail.tab.screens")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview entry={entry} get={get} />
        </TabsContent>
        <TabsContent value="hooks">
          <HooksTab get={get} timings={timings} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab name={entry.name} />
        </TabsContent>
        <TabsContent value="metrics">
          <MetricsTab entry={entry} />
        </TabsContent>
        <TabsContent value="record">
          <RecordTab name={entry.name} />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsTab key={entry.name} entry={entry} locked={row.lock !== null} />
        </TabsContent>
        <TabsContent value="screens">
          <ScreensTab name={entry.name} />
        </TabsContent>
      </Tabs>
    </article>
  );
}
