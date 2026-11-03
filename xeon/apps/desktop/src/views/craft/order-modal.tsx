// 순서 저장 전 확인. 건너뜀·값 변경·안전 검사 위험을 이름으로 보이고, `그대로 저장`을 눌러야만 저장한다.
import { t } from "@fresnel/client/i18n";
import type { OrderWarning } from "@fresnel/client/workbench/canvas";
import { assertNever } from "@fresnel/contracts";
import { Button, Dialog } from "@caustic/react";
import type { ReactNode } from "react";
import type { ReorderConfirm } from "./strata-flow.ts";

type SkipReason = OrderWarning["skipped"][number]["reason"];

export function OrderWarningModal(props: {
  /** 확인을 기다리는 제안. null이면 닫혀 있다 */
  readonly confirm: ReorderConfirm | null;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const warning = props.confirm?.warning;
  const guard = warning?.severity === "guard";
  return (
    <Dialog
      open={props.confirm !== null}
      onOpenChange={(open) => {
        // Esc와 바깥 누르기도 취소와 같다: 저장하지 않는다
        if (!open) props.onCancel();
      }}
      size="sm"
      title={
        guard
          ? t("desktop.craft.strata.modal.guardTitle")
          : t("desktop.craft.strata.modal.skipTitle")
      }
      description={t("desktop.craft.strata.modal.body")}
      footer={
        <>
          <Button size="sm" variant="outline" onClick={props.onCancel}>
            {t("desktop.craft.strata.modal.cancel")}
          </Button>
          <Button size="sm" variant="solid" onClick={props.onSave}>
            {t("desktop.craft.strata.modal.save")}
          </Button>
        </>
      }
    >
      {warning === undefined ? null : <WarningBody warning={warning} />}
    </Dialog>
  );
}

function WarningBody({ warning }: { readonly warning: OrderWarning }): ReactNode {
  return (
    <div className="grid gap-4">
      {warning.severity === "guard" && (
        <p
          role="alert"
          className="m-0 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-ui-sm text-danger-text"
        >
          {t("desktop.craft.strata.modal.guardNotice")}
        </p>
      )}
      {warning.guardLosesFirst.length > 0 && (
        <NameList
          heading={t("desktop.craft.strata.modal.guardLosesFirst")}
          names={warning.guardLosesFirst}
        />
      )}
      {warning.guardMayBeSkipped.length > 0 && (
        <NameList
          heading={t("desktop.craft.strata.modal.guardMayBeSkipped")}
          names={warning.guardMayBeSkipped}
        />
      )}
      {warning.skipped.length > 0 && (
        <section className="grid gap-2">
          <h3 className="m-0 text-footnote font-medium text-text-tertiary">
            {t("desktop.craft.strata.modal.skipped")}
          </h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {warning.skipped.map((s) => (
              <li key={s.registrationId} className="grid gap-0.5">
                <span className="text-ui-sm text-text-primary">
                  {t("desktop.craft.strata.modal.skippedItem", {
                    name: s.name,
                    reason: skipReasonText(s.reason),
                  })}
                </span>
                {s.by.length > 0 && (
                  <span className="text-footnote text-text-tertiary">
                    {t("desktop.craft.strata.modal.skippedBy", { by: s.by.join(" · ") })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {warning.valueChanges.length > 0 && (
        <NameList
          heading={t("desktop.craft.strata.modal.valueChanges")}
          names={warning.valueChanges}
        />
      )}
      {warning.autoDisable.length > 0 && (
        <NameList
          heading={t("desktop.craft.strata.modal.autoDisable")}
          names={warning.autoDisable}
        />
      )}
    </div>
  );
}

function NameList(props: {
  readonly heading: string;
  readonly names: readonly string[];
}): ReactNode {
  return (
    <section className="grid gap-1.5">
      <h3 className="m-0 text-footnote font-medium text-text-tertiary">{props.heading}</h3>
      <p className="m-0 text-ui-sm text-text-primary">{props.names.join(" · ")}</p>
    </section>
  );
}

function skipReasonText(reason: SkipReason): string {
  switch (reason) {
    case "first_answer":
      return t("desktop.craft.strata.reason.firstAnswer");
    case "first_failure_deny":
      return t("desktop.craft.strata.reason.firstFailureDeny");
    case "chain_stop":
      return t("desktop.craft.strata.reason.chainStop");
    default:
      return assertNever(reason, "skipReasonText");
  }
}
