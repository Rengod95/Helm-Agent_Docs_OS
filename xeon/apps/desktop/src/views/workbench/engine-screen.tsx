// 엔진(`engine`, P-15 시안 `p15-diagnostics`): 머리(다시 확인, 다시 연결, 엔진 다시 시작, 진단 복사), "버전과 연결" 목록, "외부 도구" 표.
// 시안의 플러그인과 그룹 표는 확장 화면(P-13)이 같은 데이터를 그리고, 계약·런타임·OS·저장소 id·웹 요약·진단 목록은 이 화면에 오는 데이터가 아직 없어 그리지 않는다.
import { t } from "@fresnel/client/i18n";
import type { BinaryView } from "@fresnel/client/settings";
import { detach, rethrow } from "@fresnel/contracts";
import {
  Button,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
  Table,
  toast,
  type TableRow,
} from "@caustic/react";
import { RotateCcw } from "@caustic/react/icons";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useEngineState, useLinkBanner } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { useSafeMode } from "../safe-mode-context.ts";
import { useUpdate } from "../update-context.ts";

const LIST = "rounded-none [&_[data-slot=list-description-row]]:px-0 [--cs-size-list-term:7rem]";
const TABLE =
  "[&_[data-slot=table-grid]]:min-w-0 [&_td:first-child]:ps-0 [&_th:first-child]:ps-0 [&_th]:bg-transparent";

type Tools =
  | { readonly phase: "loading" }
  | { readonly phase: "done"; readonly view: BinaryView | null };

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section aria-label={props.title} className="grid gap-1.5">
      <h2 className="m-0 min-h-6 text-ui-sm font-semibold text-text-primary">{props.title}</h2>
      {props.children}
    </section>
  );
}

function ToolsTable(props: { readonly view: BinaryView }): ReactNode {
  const { rows } = props.view;
  return (
    <Table
      variant="ghost"
      size="xs"
      radius="none"
      aria-label={t("desktop.workbench.engine.tools")}
      className={TABLE}
      columns={[
        { key: "name", header: t("desktop.workbench.engine.col.tool"), width: 88 },
        { key: "need", header: t("desktop.workbench.engine.col.need"), width: 56 },
        { key: "note", header: t("desktop.workbench.engine.col.state") },
        { key: "impact", header: t("desktop.workbench.engine.col.impact") },
      ]}
      rows={rows.map((row): TableRow => ({ id: row.name }))}
      renderCell={(picked, column) => {
        const row = rows.find((candidate) => candidate.name === picked.id);
        if (row === undefined) return null;
        if (column.key === "name")
          return <span className="font-mono text-mono-sm">{row.name}</span>;
        if (column.key === "need") {
          return (
            <span className={row.need === "required" ? "" : "text-text-tertiary"}>
              {t(`desktop.workbench.engine.need.${row.need}`)}
            </span>
          );
        }
        if (column.key === "note") {
          return row.ok ? (
            <span className="font-mono text-mono-sm text-text-secondary">{row.note}</span>
          ) : (
            <span className="text-warning-text">{row.note}</span>
          );
        }
        return <span className="text-text-secondary">{row.impact}</span>;
      }}
    />
  );
}

export function EngineScreen(): ReactNode {
  const commands = useCommands();
  const link = useLinkBanner();
  const engine = useEngineState();
  const safeMode = useSafeMode();
  const appVersion = useUpdate()?.currentVersion() ?? null;
  const [tools, setTools] = useState<Tools>({ phase: "loading" });
  const load = useCallback((): void => {
    detach(
      commands.setup.load({ binaries: true }).then((loaded) => {
        setTools({ phase: "done", view: loaded.ok ? loaded.value.binaries : null });
        return undefined;
      }),
      rethrow,
    );
  }, [commands]);
  const recheck = (): void => {
    setTools({ phase: "loading" });
    load();
  };
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-240 flex-1 flex-col px-3 pt-6 pb-4">
      <header className="flex h-10 flex-none items-center gap-1">
        <h1 className="m-0 min-w-0 flex-1 truncate text-text-primary">
          {t("desktop.workbench.engine.title")}
        </h1>
        <Button
          size="sm"

          variant="ghost"
          iconStart={<RotateCcw />}
          loading={tools.phase === "loading"}
          onClick={recheck}
        >
          {t("desktop.workbench.engine.recheck")}
        </Button>
        <Button
          size="sm"

          variant="ghost"
          onClick={() => {
            commands.reconnect();
          }}
        >
          {t("desktop.workbench.engine.reconnect")}
        </Button>
        <Button
          size="sm"

          variant="ghost"
          onClick={() => {
            detach(commands.restartEngine(), rethrow);
          }}
        >
          {t("desktop.workbench.engine.restart")}
        </Button>
        <Button
          size="sm"

          variant="outline"
          onClick={() => {
            detach(
              commands.copyDiagnostics().then((ok) => {
                if (ok) toast({ tone: "success", title: t("desktop.workbench.engine.copied") });
                return undefined;
              }),
              rethrow,
            );
          }}
        >
          {t("desktop.workbench.engine.copy")}
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 content-start gap-6 overflow-auto pt-1 pb-8">
        <Section title={t("desktop.workbench.engine.versions")}>
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label={t("desktop.workbench.engine.versions")}
            className={LIST}
          >
            {appVersion === null ? null : (
              <ListDescriptionRow term={t("desktop.workbench.engine.app")}>
                <span className="font-mono text-mono-sm">{appVersion}</span>
              </ListDescriptionRow>
            )}
            <ListDescriptionRow term={t("desktop.workbench.engine.phase")}>
              <span className="font-mono text-mono-sm">{link.phase}</span>
              {link.attempt > 0 && (
                <span className="text-text-tertiary">
                  {" · "}
                  {t("desktop.workbench.engine.attempt", { attempt: link.attempt })}
                </span>
              )}
            </ListDescriptionRow>
            <ListDescriptionRow term={t("desktop.workbench.engine.state")}>
              <span className="font-mono text-mono-sm">{engine === null ? "-" : engine.kind}</span>
            </ListDescriptionRow>
            {safeMode === null ? null : (
              <ListDescriptionRow term={t("desktop.settings.overview.safeMode")}>
                <span className={safeMode.active ? "text-warning-text" : "text-text-secondary"}>
                  {t(
                    safeMode.active
                      ? "desktop.settings.overview.on"
                      : "desktop.settings.overview.off",
                  )}
                </span>
              </ListDescriptionRow>
            )}
          </ListDescription>
        </Section>
        <Section title={t("desktop.workbench.engine.tools")}>
          {tools.phase === "loading" ? (
            <div className="grid gap-2.5 py-1">
              {[60, 77, 94, 71, 88].map((width) => (
                <Skeleton key={width} height={12} width={`${width}%`} />
              ))}
            </div>
          ) : tools.view === null ? (
            <p className="m-0 text-ui-sm text-text-tertiary">
              {t("desktop.workbench.engine.toolsUnknown")}
            </p>
          ) : (
            <ToolsTable view={tools.view} />
          )}
        </Section>
      </div>
    </div>
  );
}
