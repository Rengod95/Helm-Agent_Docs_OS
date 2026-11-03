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
import { useCommands } from "../commands.ts";
import { useHandlerFailures, useLinkPhase } from "../../state/engine/index.ts";
import { KeepOffAlert } from "./craft-parts.tsx";
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
      <KeepOffAlert entry={entry} onKeepOn={props.onKeepOn} onKeepOff={props.onKeepOff} />
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
    </article>
  );
}
