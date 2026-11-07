// 앱 안 설치(Q9): 출처 입력 → 권한 확인 → 설치 → 결과. 위험 경고는 보이게 두고 설명은 정보 아이콘 뒤에 둔다(DP-58).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Alert, Button, Dialog, Input } from "@caustic/react";
import { Folder, Package } from "@caustic/react/icons";
import { useReducer, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../folder-pick.ts";
import { useFolderPick } from "../folder-pick-context.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { RestartNowButton } from "../restart-confirm-dialog.tsx";
import {
  applyInstalled,
  installDoneOf,
  type InstallDone,
  INITIAL_INSTALL_FLOW,
  installFailureOf,
  installReasonsOf,
  installReasonKeyOf,
  pickOutcomeOf,
  installReduce,
  accessIsEmpty,
  bridgeAccessOf,
  warningsOf,
  type BridgeAccess,
  type InstallFailure,
  type InstallReason,
  type InstallReasonKey,
  type InstallWarning,
} from "./install-model.ts";

const FAILURE_TEXT: Readonly<Record<InstallFailure, MessageId>> = {
  safe_mode: "desktop.install.fail.safeMode",
  managed_locked: "desktop.install.fail.managedLocked",
  source_changed: "desktop.install.fail.sourceChanged",
  invalid_input: "desktop.install.fail.invalidInput",
  not_absolute: "desktop.install.fail.notAbsolute",
  no_manifest: "desktop.install.fail.noManifest",
  not_found: "desktop.install.fail.notFound",
  denied: "desktop.install.fail.denied",
  offline: "desktop.install.fail.offline",
  unsupported: "desktop.install.fail.unsupported",
  other: "desktop.install.fail.other",
};

const REASON_TEXT: Readonly<Record<InstallReasonKey, MessageId>> = {
  not_absolute: "desktop.install.reason.notAbsolute",
  folder_missing: "desktop.install.reason.folderMissing",
  no_manifest: "desktop.install.reason.noManifest",
  manifest_json: "desktop.install.reason.manifestJson",
  unknown_key: "desktop.install.reason.unknownKey",
  missing_field: "desktop.install.reason.missingField",
  invalid_value: "desktop.install.reason.invalidValue",
  entry_format: "desktop.install.reason.entryFormat",
  entry_missing: "desktop.install.reason.entryMissing",
  builtin_trust: "desktop.install.reason.builtinTrust",
  name_invalid: "desktop.install.reason.nameInvalid",
  name_reserved: "desktop.install.reason.nameReserved",
  other: "desktop.install.reason.other",
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

const BRIDGE_TEXT: Readonly<Record<BridgeAccess["capability"], MessageId>> = {
  files: "desktop.install.bridge.files",
  notify: "desktop.install.bridge.notify",
  settingsWrite: "desktop.install.bridge.settingsWrite",
  secrets: "desktop.install.bridge.secrets",
};

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
        : {
            type: "previewFailed",
            failure: installFailureOf(got.error),
            reasons: installReasonsOf(got.error),
          },
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
      dispatch({
        type: "installFailed",
        failure: installFailureOf(got.error),
        reasons: installReasonsOf(got.error),
      });
    }
  };

  const failure = flow.step === "source" || flow.step === "confirm" ? flow.failure : null;
  const reasons = flow.step === "source" || flow.step === "confirm" ? flow.reasons : [];
  const busy = flow.step === "previewing" || flow.step === "installing";
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
      size="md"
      icon={<Package />}
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
          : flow.step === "source" || flow.step === "previewing"
            ? t("desktop.install.subtitle")
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
                variant="outline"
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
            <span className="text-ui-dense text-text-secondary">
              {t("desktop.install.source.label")}
            </span>
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                // 입력란이 줄 폭을 다 쓰고 고르기 단추는 오른쪽에 붙는다(시안 b03 install: 입력란이 폭을 채운다)
                containerClassName="min-w-0 flex-1"
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
                  iconStart={<Folder />}
                  disabled={flow.step === "previewing"}
                  onClick={() => run(pick(folderPick))}
                >
                  {t("desktop.workspace.pickFolderButton")}
                </Button>
              )}
            </div>
            <span className="text-ui-xs text-text-tertiary">
              {t("desktop.install.source.hint")}
            </span>
            {pickError === null ? null : (
              <p role="alert" className="m-0 text-ui-xs text-text-secondary">
                {pickError}
              </p>
            )}
          </div>
        )}
        {(flow.step === "confirm" || flow.step === "installing") && (
          <>
            <span className="truncate text-ui-xs text-text-tertiary">
              {t("desktop.install.confirm.source", { source: flow.preview.source })}
            </span>
            {flow.preview.installedVersion !== null && (
              <span className="text-ui-xs text-text-tertiary">
                {t("desktop.install.confirm.replaces", { version: flow.preview.installedVersion })}
              </span>
            )}
            <div className="grid gap-1.5">
              <span className="flex items-center gap-1 text-ui-strong text-text-primary">
                {t("desktop.install.section.access")}
                <InfoTip text={t("desktop.install.info.access")} />
              </span>
              {accessIsEmpty(flow.preview) ? (
                <span className="text-ui-dense text-text-secondary">
                  {t("desktop.install.none")}
                </span>
              ) : (
                <>
                  {warningsOf(flow.preview).map((warning) => (
                    <Alert key={warning.kind} tone="warning">
                      {warningText(warning)}
                    </Alert>
                  ))}
                  {bridgeAccessOf(flow.preview).map((access) => {
                    const text = t(BRIDGE_TEXT[access.capability], {
                      screens: access.screens.join(", "),
                    });
                    return access.strong ? (
                      <Alert key={access.capability} tone="warning">
                        {text}
                      </Alert>
                    ) : (
                      <span key={access.capability} className="text-ui-dense text-text-secondary">
                        {text}
                      </span>
                    );
                  })}
                </>
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
              <span className="text-ui-dense text-text-secondary">
                {t("desktop.install.parts.screens", { count: flow.preview.screens.length })}
              </span>
              {flow.preview.screens.map((screen) => (
                <span key={screen.id} className="text-ui-xs text-text-tertiary">
                  {t(
                    screen.mode === "app"
                      ? "desktop.install.parts.screen.app"
                      : "desktop.install.parts.screen.native",
                    { title: screen.title },
                  )}
                </span>
              ))}
            </div>
          </>
        )}
        {flow.step === "done" && flow.reloadFailure === null && (
          <InstallDoneNote done={installDoneOf(flow.result)} />
        )}
        {flow.step === "done" && flow.result.appliesAt === "restart" && (
          <RestartNowButton size="sm" info={t("desktop.restart.info")} />
        )}
        {flow.step === "done" && flow.reloadFailure !== null && (
          <Alert tone="danger">{t("desktop.install.fail.reload")}</Alert>
        )}
        {flow.step === "installing" && (
          <span className="text-ui-xs text-text-secondary">{t("desktop.install.installing")}</span>
        )}
        {failure !== null && (
          <Alert tone="danger">
            {t(FAILURE_TEXT[failure])}
            <InstallReasonList reasons={reasons} />
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

/** 사유의 자리 문장. 필드와 줄을 다 알면 "필드 · N번째 줄", 하나만 알면 그것만 쓰고, 둘 다 모르면 없다 */
function placeText(reason: InstallReason): string | null {
  if (reason.field !== undefined && reason.line !== undefined) {
    return t("desktop.install.reason.place.fieldLine", {
      field: reason.field,
      line: reason.line,
    });
  }
  if (reason.field !== undefined)
    return t("desktop.install.reason.place.field", { field: reason.field });
  if (reason.line !== undefined)
    return t("desktop.install.reason.place.line", { line: reason.line });
  return null;
}

/**
 * 설치가 거절된 사유 목록. 사유마다 한 문장과 알면 자리를 실패 문장 아래에 보인다. 오류 자체라 정보 아이콘 뒤에 두지 않는다.
 * 검사기 원문 `message`는 여기서 쓰지 않는다. 사유가 없으면 아무것도 그리지 않는다.
 */
export function InstallReasonList(props: {
  readonly reasons: readonly InstallReason[];
}): ReactNode {
  if (props.reasons.length === 0) return null;
  return (
    <ul className="m-0 grid list-disc gap-1 ps-4 text-ui-dense">
      {props.reasons.map((reason) => {
        const place = placeText(reason);
        // 같아 보이는 사유는 installReasonsOf가 이미 하나로 줄였으므로 내용 키가 겹치지 않는다
        return (
          <li key={installReasonKeyOf(reason)}>
            {t(REASON_TEXT[reason.key])}
            {place === null ? null : <span className="block text-ui-xs">{place}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const DONE_TEXT: Readonly<Record<"listed" | "boundary" | "restart", MessageId>> = {
  listed: "desktop.install.done.listed",
  boundary: "desktop.install.done.boundary",
  restart: "desktop.install.done.restart",
};

const NOT_LOADED_TEXT: Readonly<Record<"safe_mode" | "disabled" | "error", MessageId>> = {
  safe_mode: "desktop.install.done.notLoaded.safeMode",
  disabled: "desktop.install.done.notLoaded.disabled",
  error: "desktop.install.done.notLoaded.error",
};

/** 설치 결과 한 줄. 싣지 못했으면 경고로 복사된 상태와 첫 진단 문장을 함께 보인다 */
function InstallDoneNote(props: { readonly done: InstallDone }): ReactNode {
  const done = props.done;
  if (done.kind !== "notLoaded") {
    return (
      <p role="status" className="m-0 text-ui-dense text-text-secondary">
        {t(DONE_TEXT[done.kind])}
      </p>
    );
  }
  return (
    <Alert tone="warning">
      {t(NOT_LOADED_TEXT[done.reason])}
      {done.detail === null ? "" : ` ${done.detail}`}
    </Alert>
  );
}
