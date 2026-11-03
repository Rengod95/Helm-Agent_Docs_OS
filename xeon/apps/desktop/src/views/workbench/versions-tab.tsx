// P-17 버전 탭(§6.24.1 전체 단계): 설치 이력과 되돌리기(O-11). `ext.versions`와 `ext.rollback`.
import { t, type MessageId } from "@fresnel/client/i18n";
import { versionRows, type VersionRowVM } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtVersionsResult } from "@fresnel/contracts/wire";
import { Alert, Badge, Button, Skeleton, toast } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { RollbackDialog } from "./rollback-dialog.tsx";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly result: ExtVersionsResult };

const SOURCE_TEXT: Readonly<Record<VersionRowVM["source"], MessageId>> = {
  bundled: "desktop.workbench.versions.source.bundled",
  user: "desktop.workbench.versions.source.user",
  authored: "desktop.workbench.versions.source.authored",
};

/** 되돌린 뒤에는 이력을 다시 읽도록 본체를 새로 세운다 */
export function VersionsTab(props: { readonly name: string; readonly locked: boolean }): ReactNode {
  const [generation, setGeneration] = useState(0);
  return (
    <VersionsBody
      key={generation}
      name={props.name}
      locked={props.locked}
      onChanged={() => {
        setGeneration((g) => g + 1);
      }}
    />
  );
}

function VersionsBody(props: {
  readonly name: string;
  readonly locked: boolean;
  readonly onChanged: () => void;
}): ReactNode {
  const commands = useCommands();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [target, setTarget] = useState<VersionRowVM | null>(null);
  const { name } = props;
  useEffect(() => {
    detach(
      commands.workbench.versions(name).then((r) => {
        setLoad(r.ok ? { kind: "ready", result: r.value } : { kind: "error" });
        return undefined;
      }),
      rethrow,
    );
  }, [commands, name]);

  if (load.kind === "loading") return <Skeleton height={24} />;
  if (load.kind === "error") {
    return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
  }
  const rows = versionRows(load.result);
  if (rows.length === 0)
    return <p className="text-text-tertiary">{t("desktop.workbench.versions.empty")}</p>;
  const current = rows.find((r) => r.current)?.version ?? null;

  const rollback = (version: string, clearState: boolean): void => {
    setTarget(null);
    detach(
      commands.workbench.rollback(props.name, version, clearState).then((r) => {
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
    <>
      <ul className="grid gap-1">
        {rows.map((row) => (
          <li key={row.version} className="flex items-center gap-3 px-2 py-1 text-ui-sm">
            <span className="w-16 font-mono text-text-primary">{row.version}</span>
            <span className="text-text-tertiary">{row.installedAt}</span>
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
        onConfirm={rollback}
        onCancel={() => {
          setTarget(null);
        }}
      />
    </>
  );
}
