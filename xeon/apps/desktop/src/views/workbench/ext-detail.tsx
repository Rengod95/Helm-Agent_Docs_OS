// P-17 확장 상세("자세히 보기"). 탭: 개요(위치·등급·기능 연결·진단), 훅(`ext.get`), 버전(§6.24.1). 설정·측정·기록·화면 탭은 아직 없다.
import { t } from "@fresnel/client/i18n";
import { rowOf, type WorkbenchState } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtGetResult, ExtListEntry } from "@fresnel/contracts/wire";
import { Alert, Button, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { ExtName, ExtSwitch, kindText, lockText, stateText } from "./ext-row.tsx";
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

export function ExtDetail(props: {
  readonly state: WorkbenchState;
  readonly entry: ExtListEntry;
  readonly onBack: () => void;
  readonly onToggle: (target: boolean) => void;
}): ReactNode {
  const commands = useCommands();
  const { entry } = props;
  const row = rowOf(entry, props.state.pending);
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
        <span className="ms-auto text-ui-sm text-text-secondary">{stateText(row.state)}</span>
        <ExtSwitch row={row} onToggle={props.onToggle} />
      </header>
      {row.lock !== null && <p className="text-ui-sm text-text-tertiary">{lockText(row.lock)}</p>}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("desktop.workbench.detail.tab.overview")}</TabsTrigger>
          <TabsTrigger value="hooks" count={entry.hookCount}>
            {t("desktop.workbench.detail.tab.hooks")}
          </TabsTrigger>
          <TabsTrigger value="versions">{t("desktop.workbench.detail.tab.versions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview entry={entry} get={get} />
        </TabsContent>
        <TabsContent value="hooks">
          <HooksTab get={get} />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsTab key={entry.name} name={entry.name} locked={row.lock !== null} />
        </TabsContent>
      </Tabs>
    </article>
  );
}
