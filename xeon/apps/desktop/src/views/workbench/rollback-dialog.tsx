// O-11 되돌리기 확인: 지금 버전, 되돌릴 버전, 상태 스키마 차이(상태를 비워야 하면 그 단추만).
import { t } from "@fresnel/client/i18n";
import type { VersionRowVM } from "@fresnel/client/workbench";
import { Button, Dialog, DialogAction, DialogClose } from "@caustic/react";
import type { ReactNode } from "react";

export function RollbackDialog(props: {
  readonly current: string | null;
  readonly target: VersionRowVM | null;
  readonly onConfirm: (version: string, clearState: boolean) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { target } = props;
  return (
    <Dialog
      kind="alert"
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={
        target === null ? "" : t("desktop.workbench.rollback.heading", { version: target.version })
      }
      description={
        target === null
          ? ""
          : `${t("desktop.workbench.rollback.body", {
              current: props.current ?? "-",
              version: target.version,
            })}${target.needsClearState ? ` ${t("desktop.workbench.rollback.clearState")}` : ""}`
      }
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogAction
            onClick={() => {
              if (target !== null) props.onConfirm(target.version, target.needsClearState);
            }}
          >
            {target?.needsClearState === true
              ? t("desktop.workbench.rollback.confirmClear")
              : t("desktop.workbench.rollback.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}
