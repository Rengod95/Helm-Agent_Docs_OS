// 되돌리기 확인(AGE-76 버전 탭): 바로 바꾸지 않고 리뷰 요청을 만든다는 것을 말하고, 고른 판보다 최신인 줄(빠지는 바뀜)을 보인다.
import { t } from "@fresnel/client/i18n";
import { Badge, Button, Dialog, DialogClose } from "@caustic/react";
import type { PluginHistoryEntry } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { entryKeyOf, eventWordOf, versionLabelOf } from "./versions-model.ts";

export function RollbackDialog(props: {
  readonly open: boolean;
  /** 지금 판의 글 */
  readonly from: string;
  /** 되돌릴 판의 글 */
  readonly to: string;
  readonly dropped: { readonly lines: readonly PluginHistoryEntry[]; readonly rest: number };
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { dropped } = props;
  return (
    <Dialog
      kind="alert"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={t("desktop.workbench.history.rollback.heading", { version: props.to })}
      description={t("desktop.workbench.history.rollback.body", {
        from: props.from,
        to: props.to,
      })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="solid" size="sm" onClick={props.onConfirm}>
              {t("desktop.workbench.history.rollback.confirm")}
            </Button>
          </DialogClose>
        </>
      }
    >
      {dropped.lines.length === 0 ? null : (
        <div className="grid gap-2">
          <p className="m-0 text-ui-sm text-text-tertiary">
            {t("desktop.workbench.history.rollback.dropped")}
          </p>
          <ul className="m-0 grid gap-1.5 p-0">
            {dropped.lines.map((entry) => (
              <li key={entryKeyOf(entry)} className="flex min-w-0 items-center gap-2 list-none">
                <span className="font-mono text-mono text-text-primary">
                  {versionLabelOf(entry)}
                </span>
                <Badge size="md" variant="outline">
                  {t(eventWordOf(entry.event))}
                </Badge>
              </li>
            ))}
          </ul>
          {dropped.rest === 0 ? null : (
            <p className="m-0 text-ui-sm text-text-tertiary">
              {t("desktop.workbench.history.rollback.more", { count: dropped.rest })}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
