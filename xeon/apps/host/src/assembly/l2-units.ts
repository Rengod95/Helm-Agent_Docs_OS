import { err, ok } from "@xeon/contracts";
import {
  DialogAsk,
  DialogAskKey,
  DialogAttachments,
  DialogAttachmentsKey,
  DialogCommands,
  DialogCommandsKey,
  DialogNotify,
  DialogNotifyKey,
  DialogStatus,
  DialogStatusKey,
  type CapabilityApi,
  type CommandActionRegistry,
  type NoticeFeed,
} from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import { OsPortKey, ToolServicePortKey, type ToolRegistration } from "@xeon/contracts/services";
import { hostOf, type ExtensionUnit } from "@xeon/ext-host";

// m2-plan HOST.6. cap-dialog와 cap-work가 옵션으로 받는 명령 등록부, 그리고 질문 도구를 L1.tools에 올리는 브리지 확장.
// 질문·계획 승인 포트와 사용자 셸은 두 패키지의 기본 구현(`questionApprovalsOver`, `planApprovalsOver`, `shellPortOver`)이 `xeon.approvals`와
// `xeon.loop`를 감싸므로 조립 루트가 따로 잇지 않는다. 조립 루트 코드(DR-14 예외 2).

/** `dialog.commands` 능력의 서비스 API(목록, 실행). 호스트의 `command.*` 처리기가 쓴다 */
export type CommandsApi = CapabilityApi<typeof DialogCommands>;
/** `dialog.status` 능력의 서비스 API. 호스트의 `status.list` 처리기가 쓴다 */
export type StatusApi = CapabilityApi<typeof DialogStatus>;
/** `dialog.attachments` 능력의 서비스 API. 호스트의 `attachments.add` 처리기가 쓴다 */
export type AttachmentsApi = CapabilityApi<typeof DialogAttachments>;
/** `dialog.notify` 능력의 서비스 API와 같은 프로세스 구독. 알림 목록(`notify.list`)과 알림 전달(`notify.delivered`)이 쓴다 */
export type NotifyApi = CapabilityApi<typeof DialogNotify> & NoticeFeed;

/**
 * 동작 명령 등록부와 대화 능력 API(명령, 상태줄, 첨부, 알림)를 나중에 채우는 자리. 브리지 확장이 채우고 cap-work가 등록 시점에(`current`),
 * 호스트의 `command.*`·`status.list`·`attachments.add` 처리기가 호출 시점에(`api`, `status`, `attachments`) 읽는다
 */
export interface CommandRegistryHolder {
  current: CommandActionRegistry | undefined;
  api: CommandsApi | undefined;
  status: StatusApi | undefined;
  attachments: AttachmentsApi | undefined;
  notify: NotifyApi | undefined;
  /**
   * `notify`를 채우거나 비운 뒤 부른다. 알림 전달 구독(`DialogWirePort.subscribeNotices`)이 서비스가 나타날 때 붙고 사라질 때 뗀다.
   * 엔진을 세운 뒤 브리지 확장이 올라오는 순서와 무관하게 구독이 맞물리게 한다
   */
  readonly notifyListeners: Set<() => void>;
}

/** `notify`를 채우거나 비우고 등록된 리스너를 부른다(`CommandRegistryHolder.notifyListeners`) */
function publishNotify(holder: CommandRegistryHolder, api: NotifyApi | undefined): void {
  holder.notify = api;
  for (const listener of Array.from(holder.notifyListeners)) listener();
}

/**
 * `dialog.commands` 능력의 동작 명령 등록부. cap-work가 `/plan`, `/tasks`를 등록할 때 쓴다. 능력 선택 의존(W-10)이 확정되기 전이라
 * 브리지 확장(`dialogBridgePlugin`)이 능력을 얻어 이 자리에 채운다. cap-work는 브리지보다 뒤에 싣는다: 등록 시점에 비어 있으면
 * 명령 없이 올라간다
 */
export function lazyCommandRegistry(holder: CommandRegistryHolder): CommandActionRegistry {
  return {
    registerAction(decl, handler) {
      const registry = holder.current;
      return registry === undefined ? () => undefined : registry.registerAction(decl, handler);
    },
  };
}

/** `dialog.commands` 공급자는 능력 메서드 밖의 TS 메서드 `registerAction`을 가진다(F `CommandActionRegistry`). 실제로 있는지 본다 */
function isCommandRegistry(value: unknown): value is CommandActionRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerAction" in value &&
    typeof value.registerAction === "function"
  );
}

/** 목록과 실행 메서드를 가진 명령 서비스 API인가. 공급자가 다른 능력 구현이면 호스트 명령이 없다 */
function isCommandsApi(value: unknown): value is CommandsApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "list" in value &&
    typeof value.list === "function" &&
    "run" in value &&
    typeof value.run === "function"
  );
}

/** 상태줄 서비스 API인가. 호스트가 부르는 `list`를 본다 */
function isStatusApi(value: unknown): value is StatusApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "list" in value &&
    typeof value.list === "function"
  );
}

/** 첨부 서비스 API인가. 호스트가 부르는 `add`를 본다 */
function isAttachmentsApi(value: unknown): value is AttachmentsApi {
  return (
    typeof value === "object" && value !== null && "add" in value && typeof value.add === "function"
  );
}

/** 알림 서비스 API인가. 목록과 같은 프로세스 구독을 본다 */
function isNotifyApi(value: unknown): value is NotifyApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "list" in value &&
    typeof value.list === "function" &&
    "subscribe" in value &&
    typeof value.subscribe === "function"
  );
}

const DIALOG_BRIDGE_NAME = "host-dialog-bridge";

/**
 * cap-dialog 곁에 싣는 조립 확장 하나가 맡는 두 가지:
 * - 질문 도구(`ask_user`)를 L1.tools에 올린다. cap-dialog는 `dialog.ask` 능력만 제공하고 도구 등록은 하지 않는다.
 *   질문은 사용자 응답을 기다리므로 `user_interaction` 부류를 달아 서브에이전트에서 막을 수 있게 한다(L1.agents.spec §4.6)
 * - `dialog.commands` 능력의 동작 명령 등록부를 `holder`에 채운다(cap-work의 `/plan`, `/tasks`)
 * - 상태줄, 첨부, 알림 능력 API를 `holder`에 채운다(`status.list`, `attachments.add`, M3-REQ-16)
 */
export function dialogBridgePlugin(
  holder: CommandRegistryHolder,
  loadIndex: number,
): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: DIALOG_BRIDGE_NAME,
    version: "0.1.0",
    displayName: "Dialog bridge",
    description:
      "Registers the ask_user tool and hands the command action registry to cap-work (host assembly).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    requires: [
      { id: DialogCommands.id, range: `^${DialogCommands.version}` },
      { id: DialogStatus.id, range: `^${DialogStatus.version}` },
      { id: DialogAttachments.id, range: `^${DialogAttachments.version}` },
      { id: DialogNotify.id, range: `^${DialogNotify.version}` },
    ],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const tools = host.port(ToolServicePortKey);
      const logger = host.port(OsPortKey).logger("dialog");
      const commands: unknown = g.capability(DialogCommandsKey);
      if (isCommandsApi(commands)) holder.api = commands;
      else
        logger.warn("dialog.command_api_missing", {
          effect: "command.list and command.run are unavailable",
        });
      if (isCommandRegistry(commands)) holder.current = commands;
      else
        logger.warn("dialog.command_registry_missing", {
          effect: "/plan and /tasks are not registered",
        });
      const status: unknown = g.capability(DialogStatusKey);
      if (isStatusApi(status)) holder.status = status;
      else logger.warn("dialog.status_api_missing", { effect: "status.list is unavailable" });
      const attachments: unknown = g.capability(DialogAttachmentsKey);
      if (isAttachmentsApi(attachments)) holder.attachments = attachments;
      else
        logger.warn("dialog.attachments_api_missing", {
          effect: "attachments.add is unavailable",
        });
      const notify: unknown = g.capability(DialogNotifyKey);
      if (isNotifyApi(notify)) publishNotify(holder, notify);
      else logger.warn("dialog.notify_api_missing", { effect: "notify.list is unavailable" });
      g.onDispose(() => {
        holder.current = undefined;
        holder.api = undefined;
        holder.status = undefined;
        holder.attachments = undefined;
        publishNotify(holder, undefined);
      });
      const registration: ToolRegistration = {
        kind: "capability",
        def: DialogAsk,
        key: DialogAskKey,
        policy: { ask_user: { risk: "read", classes: ["user_interaction"] } },
      };
      const registered = tools.register(registration);
      if (!registered.ok) {
        logger.warn("dialog.ask_tool_not_registered", { reason: registered.error.kind });
        return err({ reason: registered.error.kind, cause: registered.error });
      }
      g.onDispose(registered.value);
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex, builtin: true };
}
