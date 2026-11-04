// B-04 지우기 확인(위험 확인). 지우면 실행 중인 대화의 Turn에서도 이 플러그인이 바로 빠진다는 점을 본문에 적는다.
import { t } from "@fresnel/client/i18n";
import { Button, Dialog, DialogAction, DialogClose } from "@caustic/react";
import type { ReactNode } from "react";

export function RemoveDialog(props: {
  /** 지우려는 확장의 이름. null이면 닫힌다 */
  readonly name: string | null;
  readonly busy: boolean;
  readonly onConfirm: (name: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { name } = props;
  return (
    <Dialog
      kind="alert"
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={name === null ? "" : t("desktop.workbench.remove.heading", { name })}
      description={t("desktop.workbench.remove.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogAction
            disabled={props.busy}
            onClick={(event) => {
              // 확인 단추가 닫기를 먼저 하지 않는다: 지우는 동안 상자를 두고, 끝나면 부른 쪽이 닫는다
              event.preventDefault();
              if (name !== null) props.onConfirm(name);
            }}
          >
            {t("desktop.workbench.remove.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}
