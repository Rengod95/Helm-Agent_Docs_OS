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
import {
  INITIAL_INSTALL_FLOW,
  installFailureOf,
  installReasonsOf,
  installFailureHeadOf,
  installReasonKeyOf,
  pickOutcomeOf,
  installReduce,
  accessIsEmpty,
  bridgeAccessOf,
  hooksOf,
  warningsOf,
  type BridgeAccess,
  type InstallHook,
  type InstallHookPower,
  type InstallFailureHead,
  type InstallReason,
  type InstallReasonKey,
  type InstallWarning,
} from "./install-model.ts";

const FAILURE_TEXT: Readonly<Record<InstallFailureHead, MessageId>> = {
  checked: "desktop.install.fail.checked",
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
  not_available: "desktop.install.fail.notAvailable",
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

/** 훅 이름의 사람 말 사건 이름. 훅 선언 50개 가운데 46개만 이름이 있다. 나머지 네 개(M5e)는 id가 그대로 보인다 [미결: 데스크톱 이름] */
const HOOK_EVENT_TEXT: Readonly<Record<string, MessageId>> = {
  "input.user.before": "desktop.install.hook.event.input.user.before",
  "input.bash.before": "desktop.install.hook.event.input.bash.before",
  "input.agent.before": "desktop.install.hook.event.input.agent.before",
  "request.context.before": "desktop.install.hook.event.request.context.before",
  "request.system.before": "desktop.install.hook.event.request.system.before",
  "request.cache.before": "desktop.install.hook.event.request.cache.before",
  "request.provider.before": "desktop.install.hook.event.request.provider.before",
  "request.headers.before": "desktop.install.hook.event.request.headers.before",
  "request.provider.after": "desktop.install.hook.event.request.provider.after",
  "request.stream": "desktop.install.hook.event.request.stream",
  "request.model.after": "desktop.install.hook.event.request.model.after",
  "request.thinking.after": "desktop.install.hook.event.request.thinking.after",
  "tool.call.before": "desktop.install.hook.event.tool.call.before",
  "tool.result": "desktop.install.hook.event.tool.result",
  "tool.execution.before": "desktop.install.hook.event.tool.execution.before",
  "tool.execution.update": "desktop.install.hook.event.tool.execution.update",
  "tool.execution.after": "desktop.install.hook.event.tool.execution.after",
  "boundary.turn.before": "desktop.install.hook.event.boundary.turn.before",
  "boundary.step.before": "desktop.install.hook.event.boundary.step.before",
  "boundary.message.before": "desktop.install.hook.event.boundary.message.before",
  "boundary.message.update": "desktop.install.hook.event.boundary.message.update",
  "boundary.message.after": "desktop.install.hook.event.boundary.message.after",
  "boundary.step.after": "desktop.install.hook.event.boundary.step.after",
  "boundary.settle.before": "desktop.install.hook.event.boundary.settle.before",
  "boundary.turn.after": "desktop.install.hook.event.boundary.turn.after",
  "boundary.settle.after": "desktop.install.hook.event.boundary.settle.after",
  "thread.trust.before": "desktop.install.hook.event.thread.trust.before",
  "thread.resources": "desktop.install.hook.event.thread.resources",
  "thread.mcp.after": "desktop.install.hook.event.thread.mcp.after",
  "thread.start": "desktop.install.hook.event.thread.start",
  "thread.info.after": "desktop.install.hook.event.thread.info.after",
  "thread.switch.before": "desktop.install.hook.event.thread.switch.before",
  "thread.fork.before": "desktop.install.hook.event.thread.fork.before",
  "thread.compact.before": "desktop.install.hook.event.thread.compact.before",
  "thread.compact.after": "desktop.install.hook.event.thread.compact.after",
  "thread.compact.failed": "desktop.install.hook.event.thread.compact.failed",
  "thread.tree.before": "desktop.install.hook.event.thread.tree.before",
  "thread.tree.after": "desktop.install.hook.event.thread.tree.after",
  "thread.shutdown": "desktop.install.hook.event.thread.shutdown",
  "thread.prompt.before": "desktop.install.hook.event.thread.prompt.before",
  "thread.prompt.after": "desktop.install.hook.event.thread.prompt.after",
  "guard.model.before": "desktop.install.hook.event.guard.model.before",
  "guard.tool.before": "desktop.install.hook.event.guard.tool.before",
  "guard.output.before": "desktop.install.hook.event.guard.output.before",
  "lifecycle.agent.settled": "desktop.install.hook.event.lifecycle.agent.settled",
  "lifecycle.lease.rejected": "desktop.install.hook.event.lifecycle.lease.rejected",
};

const HOOK_POWER_TEXT: Readonly<Record<InstallHookPower, MessageId>> = {
  block: "desktop.install.hook.power.block",
  modify: "desktop.install.hook.power.modify",
  observe: "desktop.install.hook.power.observe",
  unknown: "desktop.install.hook.power.unknown",
};

function hookEventText(id: string): string {
  const key = HOOK_EVENT_TEXT[id];
  return key === undefined ? id : t(key);
}

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
    case "toolHooks":
      return t("desktop.install.warn.toolHooks", {
        hooks: warning.hooks.map(hookEventText).join(", "),
      });
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
  /** 설치 요청이 검토함에 들어갔을 때(검토 항목 id) */
  readonly onInstalled: (itemId: string) => void;
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
      // 검토함에 들어갔으면 알리고 상자를 닫는다. 결과 화면은 두지 않는다
      props.onInstalled(got.value.itemId);
      props.onClose();
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
          : t("desktop.install.subtitle")
      }
      footer={
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
            <span className="text-ui text-text-tertiary">{t("desktop.install.source.hint")}</span>
            {pickError === null ? null : (
              <p role="alert" className="m-0 text-ui text-text-secondary">
                {pickError}
              </p>
            )}
          </div>
        )}
        {(flow.step === "confirm" || flow.step === "installing") && (
          <>
            <span className="truncate text-ui text-text-tertiary">
              {t("desktop.install.confirm.source", { source: flow.preview.source })}
            </span>
            {flow.preview.installedVersion !== null && (
              <span className="text-ui text-text-tertiary">
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
              <span className="flex flex-wrap items-baseline gap-2 text-ui-dense text-text-secondary">
                <span>
                  {t("desktop.install.parts.hooks", { count: flow.preview.hooks.length })}
                </span>
                {flow.preview.drives ? (
                  <>
                    {" "}
                    <span>{t("desktop.install.parts.drives")}</span>
                  </>
                ) : null}
              </span>
              <InstallHookList hooks={hooksOf(flow.preview)} />
              <span className="text-ui-dense text-text-secondary">
                {t("desktop.install.parts.screens", { count: flow.preview.screens.length })}
              </span>
              {flow.preview.screens.map((screen) => (
                <span
                  key={screen.id}
                  className="flex min-w-0 items-baseline gap-2 text-ui text-text-tertiary"
                >
                  <span className="min-w-0">{screen.title}</span>{" "}
                  <span className="flex-none">
                    {t(
                      screen.mode === "app"
                        ? "desktop.install.parts.screen.app"
                        : "desktop.install.parts.screen.native",
                    )}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
        {flow.step === "installing" && (
          <span className="text-ui text-text-secondary">{t("desktop.install.installing")}</span>
        )}
        {failure !== null && (
          <Alert tone="danger">
            {t(FAILURE_TEXT[installFailureHeadOf(failure, reasons)])}
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
            {place === null ? null : <span className="block text-ui">{place}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** 확인 화면의 훅 목록: 훅마다 사건 이름과 할 수 있는 일 한 줄. 도구 호출을 막을 수 있는 훅은 진하게 보인다 */
export function InstallHookList(props: { readonly hooks: readonly InstallHook[] }): ReactNode {
  return (
    <>
      {props.hooks.map((hook) => (
        <span
          key={hook.id}
          data-blocks-tools={hook.blocksTools ? "true" : undefined}
          className={`flex min-w-0 items-baseline gap-2 ${
            hook.blocksTools
              ? "text-ui-dense font-medium text-text-primary"
              : "text-ui text-text-tertiary"
          }`}
        >
          <span>{hookEventText(hook.id)}</span>{" "}
          <span className="flex-none text-text-tertiary">{t(HOOK_POWER_TEXT[hook.power])}</span>
        </span>
      ))}
    </>
  );
}
