import { err, ok } from "@xeon/contracts";
import {
  DialogAsk,
  DialogAskKey,
  DialogCommands,
  DialogCommandsKey,
  type CallContext,
  type CommandActionRegistry,
} from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import {
  ApprovalServicePortKey,
  LoopServicePortKey,
  OsPortKey,
  ToolServicePortKey,
  type ApprovalOrigin,
  type ApprovalService,
  type LoopService,
  type ToolRegistration,
} from "@xeon/contracts/services";
import type { ApprovalsPortFactory, ShellPort } from "@xeon/cap-dialog";
import type { PlanApprovalsFactory } from "@xeon/cap-work";
import { hostOf, type ExtHost, type ExtensionUnit } from "@xeon/ext-host";
import { createCallL2ApprovalsPort, createOriginL2ApprovalsPort } from "./l2-approvals.ts";

// m2-plan HOST.6. cap-dialog와 cap-work가 옵션으로 받는 포트(승인 공장, 사용자 셸, 명령 등록부)를 실제 서비스로 이어 붙이는 조립 코드.
// 서비스는 플러그인을 싣는 시점에는 아직 없을 수 있어(`xeon.approvals`는 core-tools, `xeon.loop`은 core-loop가 올린다) 호출 때마다 포트를 찾는다.
// 조립 루트 코드(DR-14 예외 2).

/** 확장 호스트의 포트 조회만 쓴다 */
export type PortSource = Pick<ExtHost, "ports">;

function approvalsOf(source: PortSource): ApprovalService | undefined {
  return source.ports.get(ApprovalServicePortKey);
}

/**
 * 질문(`dialog.ask`)의 승인 공장. 호출 문맥으로 출처를 만들어 도구 호출 안이면 L1.tools가 그 호출의 대기 체크포인트를 같은 커밋에 넣는다.
 * 승인 서비스가 없으면 요청은 바로 거부 값이다
 */
export function dialogApprovalsFactory(source: PortSource): ApprovalsPortFactory {
  return {
    forCall(context: CallContext | undefined) {
      const approvals = approvalsOf(source);
      return approvals === undefined
        ? UNAVAILABLE_PORT
        : createCallL2ApprovalsPort(approvals, context);
    },
  };
}

/** 계획 승인(`work.plans`)의 승인 공장. 호출마다 출처가 다르다 */
export function planApprovalsFactory(source: PortSource): PlanApprovalsFactory {
  return (origin: ApprovalOrigin) => {
    const approvals = approvalsOf(source);
    return approvals === undefined
      ? UNAVAILABLE_PORT
      : createOriginL2ApprovalsPort(approvals, origin);
  };
}

/** `xeon.approvals`가 없을 때의 포트. 모든 요청이 거부 값이다 */
const UNAVAILABLE_PORT: ReturnType<ApprovalsPortFactory["forCall"]> = {
  request: () =>
    Promise.resolve(
      err({
        kind: "rejected",
        code: "approvals.unavailable",
        detail: "xeon.approvals is not provided",
      }),
    ),
  get: () => Promise.resolve(ok(null)),
  respond: () => Promise.resolve({ applied: false }),
  cancel: () => Promise.resolve({ applied: false }),
  wait: () => Promise.resolve(err({ kind: "cancelled" as const })),
};

/**
 * 사용자 개시 셸(`dialog.commands`의 셸 주입). `xeon.loop`의 `runUserBash`를 부른다. 결과는 명령 치환에 쓰일 뿐 모델 컨텍스트에는
 * 넣지 않는다. core-loop가 아직 `runUserBash`를 구현하지 않으면 실행 전 실패(`input_invalid`)라 `failed`로 알린다
 */
export function userShellPort(source: PortSource): ShellPort {
  return {
    async run(command, context) {
      const loop: LoopService | undefined = source.ports.get(LoopServicePortKey);
      if (loop === undefined) {
        return err({ kind: "failed", code: "unavailable", message: "xeon.loop is not provided" });
      }
      const ran = await loop.runUserBash({
        threadId: context.threadId,
        command,
        excludeFromContext: true,
        requestId: context.requestId,
        signal: context.signal,
      });
      if (!ran.ok) {
        return err({
          kind: "failed",
          code: ran.error.kind,
          message: `runUserBash: ${ran.error.kind}`,
        });
      }
      const outcome = ran.value;
      if (outcome.status === "denied") return err({ kind: "denied", message: outcome.reason });
      const { result } = outcome;
      if (result.cancelled) {
        return err({ kind: "failed", code: "cancelled", message: "the command was cancelled" });
      }
      if (result.exitCode !== undefined && result.exitCode !== 0) {
        return err({
          kind: "failed",
          code: String(result.exitCode),
          message: result.output.slice(0, 400),
        });
      }
      return ok({ output: result.output });
    },
  };
}

/** 동작 명령 등록부를 나중에 채우는 자리. 브리지 확장이 채우고 cap-work가 등록 시점에 읽는다 */
export interface CommandRegistryHolder {
  current: CommandActionRegistry | undefined;
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

const DIALOG_BRIDGE_NAME = "host-dialog-bridge";

/**
 * cap-dialog 곁에 싣는 조립 확장 하나가 맡는 두 가지:
 * - 질문 도구(`ask_user`)를 L1.tools에 올린다. cap-dialog는 `dialog.ask` 능력만 제공하고 도구 등록은 하지 않는다.
 *   질문은 사용자 응답을 기다리므로 `user_interaction` 부류를 달아 서브에이전트에서 막을 수 있게 한다(L1.agents.spec §4.6)
 * - `dialog.commands` 능력의 동작 명령 등록부를 `holder`에 채운다(cap-work의 `/plan`, `/tasks`)
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
    requires: [{ id: DialogCommands.id, range: `^${DialogCommands.version}` }],
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
      if (isCommandRegistry(commands)) holder.current = commands;
      else
        logger.warn("dialog.command_registry_missing", {
          effect: "/plan and /tasks are not registered",
        });
      g.onDispose(() => {
        holder.current = undefined;
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
