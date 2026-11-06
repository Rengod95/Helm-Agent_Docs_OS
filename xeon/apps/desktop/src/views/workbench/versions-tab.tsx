// P-17 버전 탭(§6.24.1). 기록이 있으면 전체 단계(설치 이력과 되돌리기 O-11), 없거나 읽기를 지원하지 않으면 대체 단계(설치본과 번들 버전 읽기만).
// `ext.versions`와 `ext.rollback`. 그림을 고르는 것은 `versionsViewOf`(@fresnel/client/workbench)가 한다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  versionsViewOf,
  type VersionRowVM,
  type VersionsLoad,
  type VersionsView,
} from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
  Table,
  toast,
  type TableColumn,
} from "@caustic/react";
import { History, RotateCcw } from "@caustic/react/icons";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { PLAIN_TABLE } from "./tab-body.tsx";
import { RollbackDialog } from "./rollback-dialog.tsx";

type Load = { readonly kind: "loading" } | VersionsLoad;

const SOURCE_TEXT: Readonly<Record<VersionRowVM["source"], MessageId>> = {
  bundled: "desktop.workbench.versions.source.bundled",
  user: "desktop.workbench.versions.source.user",
  authored: "desktop.workbench.versions.source.authored",
};

/** 되돌린 뒤에는 이력을 다시 읽도록 본체를 새로 세운다 */
export function VersionsTab(props: {
  readonly entry: Pick<ExtListEntry, "name" | "version" | "origin">;
  readonly locked: boolean;
}): ReactNode {
  const [generation, setGeneration] = useState(0);
  return (
    <VersionsBody
      key={generation}
      entry={props.entry}
      locked={props.locked}
      onChanged={() => {
        setGeneration((g) => g + 1);
      }}
    />
  );
}

function VersionsBody(props: {
  readonly entry: Pick<ExtListEntry, "name" | "version" | "origin">;
  readonly locked: boolean;
  readonly onChanged: () => void;
}): ReactNode {
  const commands = useCommands();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const { entry } = props;
  const name = entry.name;
  useEffect(() => {
    detach(
      commands.workbench.versions(name).then((r) => {
        setLoad(
          r.ok
            ? { kind: "ready", result: r.value }
            : r.error.kind === "unsupported"
              ? { kind: "unsupported" }
              : { kind: "error" },
        );
        return undefined;
      }),
      rethrow,
    );
  }, [commands, name]);

  if (load.kind === "loading") return <Skeleton height={24} />;

  const rollback = (version: string, clearState: boolean): void => {
    detach(
      commands.workbench.rollback(name, version, clearState).then((r) => {
        if (!r.ok) {
          toast({ tone: "danger", title: t("desktop.workbench.rollback.failed") });
          return undefined;
        }
        // 재시작 뒤에 도는 되돌리기는 상태 표시줄의 다시 시작 줄에 모은다(U-02)
        if (r.value === "restart") commands.noteRestartNeeded({ kind: "rollback", name });
        toast({
          tone: "success",
          title: t("desktop.workbench.rollback.done"),
          ...(r.value === "restart"
            ? { description: t("desktop.workbench.rollback.doneRestart") }
            : {}),
        });
        props.onChanged();
        return undefined;
      }),
      rethrow,
    );
  };

  return (
    <VersionsPanel view={versionsViewOf(entry, load)} locked={props.locked} onRollback={rollback} />
  );
}

/** 버전 탭의 그림. 읽기와 명령은 바깥이 맡고, 여기서는 `view`대로 그린다 */
export function VersionsPanel(props: {
  readonly view: VersionsView;
  readonly locked: boolean;
  readonly onRollback: (version: string, clearState: boolean) => void;
}): ReactNode {
  const [target, setTarget] = useState<VersionRowVM | null>(null);
  const { view } = props;
  if (view.kind === "error") {
    return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
  }
  if (view.kind === "fallback") {
    return (
      <>
        <FallbackVersions
          installed={view.installed}
          bundled={view.bundled}
          onRollback={
            view.rollbackTo === null || props.locked
              ? null
              : () => {
                  setTarget({
                    version: view.rollbackTo ?? "",
                    installedAt: null,
                    source: "bundled",
                    current: false,
                    canRollback: true,
                    needsClearState: false,
                  });
                }
          }
        />
        <RollbackDialog
          current={view.installed}
          target={target}
          onConfirm={(version, clearState) => {
            setTarget(null);
            props.onRollback(version, clearState);
          }}
          onCancel={() => {
            setTarget(null);
          }}
        />
      </>
    );
  }
  const current = view.rows.find((r) => r.current)?.version ?? null;

  return (
    <>
      <VersionsTable
        rows={view.rows}
        locked={props.locked}
        onPick={(row) => {
          setTarget(row);
        }}
      />
      <RollbackDialog
        current={current}
        target={target}
        onConfirm={(version, clearState) => {
          setTarget(null);
          props.onRollback(version, clearState);
        }}
        onCancel={() => {
          setTarget(null);
        }}
      />
    </>
  );
}

/** 이력 표의 열 */
type VersionColumn = "version" | "source" | "installed" | "act";

const VERSION_COLUMNS: readonly VersionColumn[] = ["version", "source", "installed", "act"];

/** 표 열의 키(문자열)를 열 이름으로 바꾼다. 열 이름이 아니면 undefined */
function versionColumnOf(key: string): VersionColumn | undefined {
  return VERSION_COLUMNS.find((column) => column === key);
}

/**
 * 전체 단계의 이력 표(wb-opus 버전 탭): 버전(mono, 지금 표지), 출처, 설치 시각(없으면 "앱에 든 버전"), 되돌리기 단추.
 * 행 사이 선 없이 표 하나로 읽는다. 저장 형식과 매니페스트 해시는 이 읽기에 없어 칸을 두지 않는다.
 */
function VersionsTable(props: {
  readonly rows: readonly VersionRowVM[];
  readonly locked: boolean;
  readonly onPick: (row: VersionRowVM) => void;
}): ReactNode {
  const columns: TableColumn[] = [
    { key: "version", header: t("desktop.workbench.versions.col.version") },
    { key: "source", header: t("desktop.workbench.versions.col.source") },
    { key: "installed", header: t("desktop.workbench.versions.installed") },
    { key: "act", header: "" },
  ];
  return (
    <Table
      variant="ghost"
      size="xs"
      aria-label={t("desktop.workbench.detail.tab.versions")}
      className={PLAIN_TABLE}
      columns={columns}
      rows={props.rows.map((_, index) => ({ id: String(index) }))}
      renderCell={(picked, column) => {
        const row = props.rows[Number(picked.id)];
        const name = versionColumnOf(column.key);
        if (row === undefined || name === undefined) return null;
        switch (name) {
          case "version":
            return (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-mono-sm text-text-primary">{row.version}</span>
                {row.current && (
                  <Badge size="xs" variant="soft">
                    {t("desktop.workbench.versions.current")}
                  </Badge>
                )}
              </span>
            );
          case "source":
            return <span className="text-text-secondary">{t(SOURCE_TEXT[row.source])}</span>;
          case "installed":
            return (
              <span className="text-text-secondary">
                {row.installedAt ?? t("desktop.workbench.versions.inApp")}
              </span>
            );
          case "act":
            return row.canRollback ? (
              <Button
                size="xs"
                variant="ghost"
                iconStart={<RotateCcw />}
                disabled={props.locked}
                onClick={() => {
                  props.onPick(row);
                }}
              >
                {t("desktop.workbench.versions.rollback")}
              </Button>
            ) : null;
          default:
            return assertNever(name, "VersionsTable");
        }
      }}
    />
  );
}

/**
 * 대체 단계: 설치본 버전과 앱에 든 번들 버전(기본 플러그인만)을 읽기 전용으로 보인다.
 * 번들 버전으로 되돌리는 명령은 wire가 없어(`ext.rollback`은 기록이 없는 확장을 거절한다) 단추를 두지 않는다.
 * 사용자가 만든 확장은 되돌리기가 없고, 폴더 열기 명령도 데스크톱에 없어 둘 곳이 없다.
 */
function FallbackVersions(props: {
  readonly installed: string;
  readonly bundled: string | null;
  /** 번들 판으로 되돌리는 단추. 되돌릴 수 없으면 null */
  readonly onRollback: (() => void) | null;
}): ReactNode {
  return (
    <div className="grid gap-3">
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.workbench.detail.tab.versions")}
        className="rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term={t("desktop.workbench.versions.installed")}>
          <span className="font-mono text-mono-sm text-text-primary">{props.installed}</span>
        </ListDescriptionRow>
        {props.bundled !== null && (
          <ListDescriptionRow term={t("desktop.workbench.versions.bundled")}>
            <span className="font-mono text-mono-sm text-text-primary">{props.bundled}</span>
          </ListDescriptionRow>
        )}
      </ListDescription>
      <p className="m-0 inline-flex items-center gap-1.5 text-ui-sm text-text-secondary">
        <History aria-hidden emphasis="muted" className="size-icon-sm" />
        {t("desktop.workbench.versions.noHistory")}
      </p>
      {props.onRollback !== null ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" iconStart={<RotateCcw />} onClick={props.onRollback}>
            {t("desktop.workbench.versions.rollbackToBundled")}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-ui-xs text-text-tertiary">
          {props.bundled !== null
            ? t("desktop.workbench.versions.bundledNoRollback")
            : t("desktop.workbench.versions.userNoRollback")}
        </p>
      )}
    </div>
  );
}
