import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { Alert, Button, Dialog, RadioGroup, RadioGroupItem, toast } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useCommands, type ExportFormat } from "./commands.ts";
import { useFileSave } from "./file-save-context.ts";
import {
  exportAndSave,
  primaryLabelOf,
  type ExportOutcome,
  type ExportPhase,
} from "./export-model.ts";

// 대화 내보내기 대화 상자(L4.desktop-ux O-13). 행 메뉴와 대화 머리 ⋯ 메뉴가 연다. Markdown은 읽기용, JSON은 item 원형이다.
// 시크릿 값은 어느 형식에도 없고 이름만 남는다는 말을 늘 보인다. 읽기와 저장이 끝나면 토스트를 띄우고 닫는다.
// 저장 창에서 취소하면 대화 상자는 그대로 두고 아무것도 알리지 않는다. 실패하면 한 줄을 보이고 "다시 시도"를 준다.
// 실행 중에는 닫지 못한다(읽기는 짧고, 저장 창이 떠 있는 동안 닫히면 저장 결과를 알릴 곳이 없다).

export function ThreadExportDialog(props: {
  readonly id: ThreadId;
  readonly title: string;
  readonly onDone: () => void;
}): ReactNode {
  const commands = useCommands();
  const fileSave = useFileSave();
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [failure, setFailure] = useState<MessageId | null>(null);

  const applyOutcome = (outcome: ExportOutcome): void => {
    if (outcome.kind === "saved") {
      toast({
        tone: "success",
        title: t("desktop.threads.export.saved"),
        description: t("desktop.threads.export.itemCount", {
          name: outcome.filename,
          count: outcome.itemCount,
        }),
      });
      props.onDone();
      return;
    }
    if (outcome.kind === "cancelled") {
      setPhase("idle");
      return;
    }
    setPhase("failed");
    setFailure(outcome.message);
  };

  const run = (): void => {
    setPhase("running");
    setFailure(null);
    detach(
      exportAndSave({
        exportThread: (chosen) => commands.exportThread(props.id, chosen),
        format,
        fileSave,
      }).then((outcome) => {
        applyOutcome(outcome);
        return undefined;
      }),
      rethrow,
    );
  };

  return (
    <ThreadExportDialogView
      title={props.title}
      format={format}
      phase={phase}
      failure={failure}
      desktop={fileSave !== null}
      onFormat={setFormat}
      onRun={run}
      onClose={props.onDone}
    />
  );
}

/** 상태를 받아 그리는 부분. 대화 상자는 포털이라 서버 렌더 시험은 본문(`ExportDialogBody`)을 본다 */
function ThreadExportDialogView(props: {
  readonly title: string;
  readonly format: ExportFormat;
  readonly phase: ExportPhase;
  readonly failure: MessageId | null;
  /** 데스크톱(저장 창)인지 웹(내려받기)인지 */
  readonly desktop: boolean;
  readonly onFormat: (format: ExportFormat) => void;
  readonly onRun: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const running = props.phase === "running";
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !running) props.onClose();
      }}
      title={t("desktop.threads.export.title")}
      description={t("desktop.threads.export.description", { title: props.title })}
      footer={
        <>
          <Button size="sm" variant="outline" disabled={running} onClick={props.onClose}>
            {t("desktop.threads.menu.cancel")}
          </Button>
          <Button size="sm" variant="solid" loading={running} onClick={props.onRun}>
            {t(primaryLabelOf(props.desktop, props.phase === "failed"))}
          </Button>
        </>
      }
    >
      <ExportDialogBody
        format={props.format}
        phase={props.phase}
        failure={props.failure}
        onFormat={props.onFormat}
      />
    </Dialog>
  );
}

/** 형식 고르기, 시크릿 안내, 실행 중 문장, 실패 한 줄. 대화 상자 본문이다 */
export function ExportDialogBody(props: {
  readonly format: ExportFormat;
  readonly phase: ExportPhase;
  readonly failure: MessageId | null;
  readonly onFormat: (format: ExportFormat) => void;
}): ReactNode {
  const running = props.phase === "running";
  return (
    <div className="grid gap-3">
      <RadioGroup
        aria-label={t("desktop.threads.export.format")}
        value={props.format}
        disabled={running}
        onValueChange={(value) => {
          props.onFormat(value === "json" ? "json" : "markdown");
        }}
        className="gap-1"
      >
        <RadioGroupItem value="markdown">
          <span className="grid">
            <span>{t("desktop.threads.export.markdown")}</span>
            <span className="text-ui text-text-tertiary">
              {t("desktop.threads.export.markdown.hint")}
            </span>
          </span>
        </RadioGroupItem>
        <RadioGroupItem value="json">
          <span className="grid">
            <span>{t("desktop.threads.export.json")}</span>
            <span className="text-ui text-text-tertiary">
              {t("desktop.threads.export.json.hint")}
            </span>
          </span>
        </RadioGroupItem>
      </RadioGroup>
      <p className="text-ui text-text-tertiary">{t("desktop.threads.export.secrets")}</p>
      {running ? (
        <p className="text-ui text-text-secondary" role="status">
          {t("desktop.threads.export.running")}
        </p>
      ) : null}
      {props.failure === null ? null : (
        <Alert tone="danger" size="sm" radius="md" role="alert">
          {t(props.failure)}
        </Alert>
      )}
    </div>
  );
}
