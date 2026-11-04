// P-17 확장 상세("자세히 보기"). 탭: 개요(위치·등급·기능 연결·진단), 훅(`ext.get`), 설정(`settings.list`·`settings.get`, 읽기 전용),
// 측정(`group.metrics`, 그룹만), 기록(`scope.handler_failed`), 버전(§6.24.1), 화면(`ext.ui.list`). 머리에는 설치 등급과 범위 배지(ADR-0022 §3.3)를 둔다.
import { t } from "@fresnel/client/i18n";
import {
  enabledScopeOf,
  failureRowsOf,
  rowOf,
  type FailureRowVM,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ExtGetResult, ExtListEntry } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Skeleton,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type TableColumn,
} from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { nativeEntriesOf } from "../../plugin-ui/placements.ts";
import { useCommands } from "../commands.ts";
import { useHandlerFailures, useLinkPhase } from "../../state/engine/index.ts";
import { useShellActions, type ShellActions } from "../../state/shell/index.ts";
import { EntrySurface } from "../plugin/plugin-view.tsx";
import { usePluginUiState } from "../plugin/plugin-context.tsx";
import { AutoOffNotice } from "./craft-parts.tsx";
import { ExtName, ExtSwitch, kindText, lockText, stateText } from "./ext-row.tsx";
import { MetricsTab } from "./metrics-tab.tsx";
import { OriginBadge, ScopeBadge } from "./source-badge.tsx";
import { ScreensTab } from "./screens-tab.tsx";
import { SettingsTab } from "./settings-tab.tsx";
import { originText } from "./trust-dialog.tsx";
import { VersionsTab } from "./versions-tab.tsx";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly result: ExtGetResult };

function Overview(props: { readonly entry: ExtListEntry; readonly get: Load }): ReactNode {
  const { entry } = props;
  return (
    <div className="grid gap-3 text-ui-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-text-tertiary">{t("desktop.workbench.detail.origin")}</dt>
        <dd>
          {originText(entry.origin)}{" "}
          <span className="font-mono text-text-tertiary">{entry.location}</span>
        </dd>
        <dt className="text-text-tertiary">{t("desktop.workbench.detail.grade")}</dt>
        <dd>
          {t("desktop.workbench.detail.grade.value", {
            requested: entry.requestedGrade,
            effective: entry.effectiveGrade,
          })}
        </dd>
      </dl>
      {entry.diagnostics.length > 0 && (
        <section aria-label={t("desktop.workbench.detail.diagnostics")} className="grid gap-1">
          {entry.diagnostics.map((d) => (
            <Alert
              key={`${d.code}:${d.message}`}
              tone={d.severity === "error" ? "danger" : "warning"}
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
      {props.get.kind === "ready" && props.get.result.bindings.length > 0 && (
        <section aria-label={t("desktop.workbench.detail.bindings")} className="grid gap-1">
          <h4 className="text-ui-strong text-text-primary">
            {t("desktop.workbench.detail.bindings")}
          </h4>
          <ul>
            {props.get.result.bindings.map((b) => (
              <li key={`${b.registrationId}:${b.relation}:${b.capability}`} className="flex gap-2">
                <span className="font-mono text-text-tertiary">{b.relation}</span>
                <span className="font-mono">{b.capability}</span>
                <span className="ms-auto text-text-tertiary">
                  {b.satisfied
                    ? t("desktop.workbench.detail.binding.ok")
                    : t("desktop.workbench.detail.binding.unmet")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HooksTab(props: { readonly get: Load }): ReactNode {
  if (props.get.kind === "loading") return <Skeleton height={24} />;
  if (props.get.kind === "error") {
    return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
  }
  const hooks = props.get.result.hooks;
  if (hooks.length === 0)
    return <p className="text-text-tertiary">{t("desktop.workbench.detail.hooks.empty")}</p>;
  return (
    <ul className="grid gap-0.5 text-ui-sm">
      {hooks.map((h) => (
        <li key={`${h.registrationId}:${h.hook}`} className="flex gap-3 px-2">
          <span className="font-mono text-text-primary">{h.hook}</span>
          <span className="ms-auto text-text-tertiary">
            {t("desktop.workbench.detail.hooks.budget")} {h.budgetClass} · {h.budgetMs}ms
          </span>
        </li>
      ))}
    </ul>
  );
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

/** 기록 탭 그림: 엔진 연결이 실패했으면 오류 한 줄, 기록이 없으면 빈 문장, 있으면 표 하나(훅·결과·메시지·횟수·연속) */
export function FailureRecords(props: {
  readonly rows: readonly FailureRowVM[];
  readonly failed: boolean;
}): ReactNode {
  if (props.failed) {
    return <Alert tone="danger">{t("desktop.workbench.detail.record.failed")}</Alert>;
  }
  if (props.rows.length === 0) {
    return <p className="text-text-tertiary">{t("desktop.workbench.detail.record.empty")}</p>;
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

/**
 * 확장 상세의 설정 구역. 이 확장의 `settings` 화면 항목 하나를 항목 제목으로 그린다(ADR-0021 §3.2).
 * 항목이 없거나 확장이 꺼졌으면 아무것도 그리지 않는다
 */
function SettingsSection(props: { readonly name: string }): ReactNode {
  const plugin = usePluginUiState();
  const shown = nativeEntriesOf(plugin.groups.settings, plugin.inactive).find(
    (entry) => entry.extension === props.name,
  );
  if (shown === undefined) return null;
  return (
    <section aria-label={shown.title} className="grid gap-2">
      <h4 className="text-ui-strong text-text-primary">{shown.title}</h4>
      <EntrySurface entry={shown} />
    </section>
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
        size="sm"
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
  readonly onBack: () => void;
  readonly onToggle: (target: boolean) => void;
  readonly onKeepOn: () => void;
  readonly onKeepOff: () => void;
}): ReactNode {
  const commands = useCommands();
  const { entry } = props;
  const row = rowOf(entry, props.state.pending);
  const scope = enabledScopeOf(entry.enabledSource);
  const [get, setGet] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    detach(
      commands.workbench.get(entry.name).then((r) => {
        setGet(r.ok ? { kind: "ready", result: r.value } : { kind: "error" });
        return undefined;
      }),
      rethrow,
    );
  }, [commands, entry.name]);
  return (
    <article className="grid min-h-0 content-start gap-3 p-4">
      <header className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={props.onBack}>
          {t("desktop.workbench.detail.back")}
        </Button>
        <ExtName row={row} />
        <span className="font-mono text-text-tertiary">
          {row.layer} · {kindText(row.kind)} · {row.version}
        </span>
        {entry.origin !== undefined && <OriginBadge origin={entry.origin} />}
        {scope !== null && <ScopeBadge scope={scope} />}
        <span className="ms-auto text-ui-sm text-text-secondary">{stateText(row.state)}</span>
        <ExtSwitch row={row} onToggle={props.onToggle} />
      </header>
      {row.lock !== null && <p className="text-ui-sm text-text-tertiary">{lockText(row.lock)}</p>}
      <AutoOffNotice entry={entry} onKeepOn={props.onKeepOn} onKeepOff={props.onKeepOff} />
      <PluginScreensLink name={entry.name} />
      <Tabs defaultValue="overview">
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
          <HooksTab get={get} />
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
      <SettingsSection name={entry.name} />
    </article>
  );
}
