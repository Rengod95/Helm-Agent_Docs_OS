// 앱 안 설치(Q9): 출처 입력 → 권한 확인 → 설치 → 결과. 위험 경고는 보이게 두고 설명은 정보 아이콘 뒤에 둔다(DP-58).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Alert, Button, Dialog, Input } from "@caustic/react";
import { useReducer, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../folder-pick.ts";
import { useFolderPick } from "../folder-pick-context.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { RestartNowButton } from "../restart-confirm-dialog.tsx";
import {
  applyInstalled,
  INITIAL_INSTALL_FLOW,
  installFailureOf,
  pickOutcomeOf,
  installReduce,
  warningsOf,
  type InstallFailure,
  type InstallWarning,
} from "./install-model.ts";

const FAILURE_TEXT: Readonly<Record<InstallFailure, MessageId>> = {
  safe_mode: "desktop.install.fail.safeMode",
  managed_locked: "desktop.install.fail.managedLocked",
  source_changed: "desktop.install.fail.sourceChanged",
  invalid_input: "desktop.install.fail.invalidInput",
  not_found: "desktop.install.fail.notFound",
  denied: "desktop.install.fail.denied",
  offline: "desktop.install.fail.offline",
  unsupported: "desktop.install.fail.unsupported",
  other: "desktop.install.fail.other",
};

function warningText(warning: InstallWarning): string {
  switch (warning.kind) {
    case "shell":
      return t("desktop.install.warn.shell");
    case "network":
      return t("desktop.install.warn.network");
    case "files":
      return t("desktop.install.warn.files");
    case "tools":
      return t("desktop.install.warn.tools", { tools: warning.tools.join(", ") });
    case "untrusted":
      return t("desktop.install.warn.untrusted");
    case "checks":
      return t("desktop.install.warn.checks", { count: warning.count });
    default:
      return assertNever(warning, "InstallWarning");
  }
}

function run(work: Promise<void>): void {
  detach(work, rethrow);
}

export function InstallDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** 설치가 끝났을 때(목록을 다시 읽는다) */
  readonly onInstalled: () => void;
}): ReactNode {
  const commands = useCommands();
  const [flow, dispatch] = useReducer(installReduce, INITIAL_INSTALL_FLOW);
  const folderPick = useFolderPick();
  const [pickError, setPickError] = useState<string | null>(null);

  // 취소는 입력란을 그대로 둔다. 창을 못 연 실패도 입력란은 그대로 두고 한 줄로만 알린다
  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const outcome = pickOutcomeOf(await pickWorkspaceFolder(invoke));
    if (outcome.kind === "failed") {
      setPickError(t("desktop.workspace.pickFailed"));
      return;
    }
    if (outcome.kind === "keep") return;
    setPickError(null);
    dispatch({ type: "source", source: outcome.source });
  };

  const preview = async (source: string): Promise<void> => {
    dispatch({ type: "previewStart" });
    const got = await commands.workbench.installPreview(source);
    dispatch(
      got.ok
        ? { type: "previewed", preview: got.value }
        : { type: "previewFailed", failure: installFailureOf(got.error) },
    );
  };
  const install = async (source: string, sha256: string): Promise<void> => {
    dispatch({ type: "installStart" });
    const got = await commands.workbench.install(source, sha256);
    if (got.ok) {
      // 새 이름은 다시 시작한 뒤에 목록에 나타난다. 상태 표시줄의 다시 시작 줄에 모은다(U-02)
      if (got.value.appliesAt === "restart") {
        commands.noteRestartNeeded({ kind: "install", name: got.value.name });
      }
      const reloadFailure = await applyInstalled(
        (name) => commands.workbench.reload(name),
        got.value,
      );
      dispatch({ type: "installed", result: got.value, reloadFailure });
      props.onInstalled();
    } else {
      dispatch({ type: "installFailed", failure: installFailureOf(got.error) });
    }
  };

  const failure = flow.step === "source" || flow.step === "confirm" ? flow.failure : null;
  const busy = flow.step === "previewing" || flow.step === "installing";
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
      title={
        flow.step === "confirm" || flow.step === "installing"
          ? t("desktop.install.confirm.heading", {
              name: flow.preview.displayName ?? flow.preview.name,
              version: flow.preview.version,
            })
          : t("desktop.install.title")
      }
      description={
        flow.step === "confirm" || flow.step === "installing"
          ? t("desktop.install.confirm.body", {
              name: flow.preview.displayName ?? flow.preview.name,
            })
          : undefined
      }
      footer={
        <>
          {flow.step === "done" ? (
            <Button size="sm" onClick={props.onClose}>
              {t("desktop.install.close")}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={flow.step === "confirm" ? () => dispatch({ type: "back" }) : props.onClose}
              >
                {t("desktop.workbench.cancel")}
              </Button>
              {flow.step === "confirm" && (
                <Button
                  size="sm"
                  variant="solid"
                  onClick={() => run(install(flow.preview.source, flow.preview.sha256))}
                >
                  {t("desktop.install.allow")}
                </Button>
              )}
              {(flow.step === "source" || flow.step === "previewing") && (
                <Button
                  size="sm"
                  variant="solid"
                  loading={flow.step === "previewing"}
                  disabled={flow.step === "source" && flow.source.trim() === ""}
                  onClick={() => {
                    if (flow.step === "source") run(preview(flow.source.trim()));
                  }}
                >
                  {t("desktop.install.preview")}
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="grid gap-3">
        {(flow.step === "source" || flow.step === "previewing") && (
          <div className="grid gap-1.5">
            <span className="flex items-center gap-1 text-ui-dense text-text-secondary">
              {t("desktop.install.source.label")}
              <InfoTip text={t("desktop.install.source.info")} />
            </span>
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                value={flow.source}
                disabled={flow.step === "previewing"}
                placeholder={t("desktop.install.source.placeholder")}
                aria-label={t("desktop.install.source.label")}
                onValueChange={(value) => {
                  setPickError(null);
                  dispatch({ type: "source", source: value });
                }}
              />
              {folderPick === null ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flow.step === "previewing"}
                  onClick={() => run(pick(folderPick))}
                >
                  {t("desktop.workspace.pickFolderButton")}
                </Button>
              )}
            </div>
            {pickError === null ? null : (
              <p role="alert" className="m-0 text-footnote text-text-secondary">
                {pickError}
              </p>
            )}
          </div>
        )}
        {(flow.step === "confirm" || flow.step === "installing") && (
          <>
            <span className="truncate text-footnote text-text-secondary">
              {t("desktop.install.confirm.source", { source: flow.preview.source })}
            </span>
            {flow.preview.installedVersion !== null && (
              <span className="text-footnote text-text-secondary">
                {t("desktop.install.confirm.replaces", { version: flow.preview.installedVersion })}
              </span>
            )}
            <div className="grid gap-1.5">
              <span className="flex items-center gap-1 text-ui-strong text-text-primary">
                {t("desktop.install.section.access")}
                <InfoTip text={t("desktop.install.info.access")} />
              </span>
              {warningsOf(flow.preview).length === 0 ? (
                <span className="text-ui-dense text-text-secondary">
                  {t("desktop.install.none")}
                </span>
              ) : (
                warningsOf(flow.preview).map((warning) => (
                  <Alert key={warning.kind} tone="warning">
                    {warningText(warning)}
                  </Alert>
                ))
              )}
            </div>
            <div className="grid gap-1">
              <span className="flex items-center gap-1 text-ui-strong text-text-primary">
                {t("desktop.install.section.parts")}
                <InfoTip text={t("desktop.install.info.parts")} />
              </span>
              <span className="text-ui-dense text-text-secondary">
                {t("desktop.install.parts.hooks", { count: flow.preview.hooks.length })}
                {flow.preview.drives ? ` · ${t("desktop.install.parts.drives")}` : ""}
              </span>
            </div>
          </>
        )}
        {flow.step === "done" && flow.reloadFailure === null && (
          <p role="status" className="m-0 text-ui-dense text-text-secondary">
            {t(
              flow.result.appliesAt === "restart"
                ? "desktop.install.done.restart"
                : "desktop.install.done.now",
            )}
          </p>
        )}
        {flow.step === "done" && flow.result.appliesAt === "restart" && (
          <RestartNowButton size="sm" info={t("desktop.restart.info")} />
        )}
        {flow.step === "done" && flow.reloadFailure !== null && (
          <Alert tone="danger">{t("desktop.install.fail.reload")}</Alert>
        )}
        {flow.step === "installing" && (
          <span className="text-footnote text-text-secondary">
            {t("desktop.install.installing")}
          </span>
        )}
        {failure !== null && <Alert tone="danger">{t(FAILURE_TEXT[failure])}</Alert>}
      </div>
    </Dialog>
  );
}
