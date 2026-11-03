// P-17 버전 탭(§6.24.1). 기록이 있으면 전체 단계(설치 이력과 되돌리기 O-11), 없거나 읽기를 지원하지 않으면 대체 단계(설치본과 번들 버전 읽기만).
// `ext.versions`와 `ext.rollback`. 그림을 고르는 것은 `versionsViewOf`(@fresnel/client/workbench)가 한다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  versionsViewOf,
  type VersionRowVM,
  type VersionsLoad,
  type VersionsView,
} from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Alert, Badge, Button, Skeleton, toast } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
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
      <ul className="grid gap-1">
        {view.rows.map((row) => (
          <li key={row.version} className="flex items-center gap-3 px-2 py-1 text-ui-sm">
            <span className="w-16 font-mono text-text-primary">{row.version}</span>
            <span className="text-text-tertiary">
              {row.installedAt ?? t("desktop.workbench.versions.inApp")}
            </span>
            <Badge size="sm">{t(SOURCE_TEXT[row.source])}</Badge>
            {row.current && <Badge size="sm">{t("desktop.workbench.versions.current")}</Badge>}
            {row.canRollback && (
              <Button
                size="xs"
                variant="outline"
                className="ms-auto"
                disabled={props.locked}
                onClick={() => {
                  setTarget(row);
                }}
              >
                {t("desktop.workbench.versions.rollback")}
              </Button>
            )}
          </li>
        ))}
      </ul>
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
    <div className="grid gap-2 text-ui-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-text-tertiary">{t("desktop.workbench.versions.installed")}</dt>
        <dd className="font-mono text-text-primary">{props.installed}</dd>
        {props.bundled !== null && (
          <>
            <dt className="text-text-tertiary">{t("desktop.workbench.versions.bundled")}</dt>
            <dd className="font-mono text-text-primary">{props.bundled}</dd>
          </>
        )}
      </dl>
      <p className="text-text-tertiary">{t("desktop.workbench.versions.noHistory")}</p>
      {props.onRollback !== null ? (
        <Button
          size="xs"
          variant="outline"
          className="justify-self-start"
          onClick={props.onRollback}
        >
          {t("desktop.workbench.versions.rollbackToBundled")}
        </Button>
      ) : (
        <p className="text-text-tertiary">
          {props.bundled !== null
            ? t("desktop.workbench.versions.bundledNoRollback")
            : t("desktop.workbench.versions.userNoRollback")}
        </p>
      )}
    </div>
  );
}
