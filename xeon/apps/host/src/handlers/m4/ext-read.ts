import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type WireError,
  type WireHandlers,
  type WireMethodName,
  type WireParams,
  type WireResult,
} from "@fresnel/contracts/wire";
import {
  wireErrorOfWrite,
  type HostErrorMappers,
  type ProfileWriteFailure,
} from "./profile-test-run.ts";

// 확장 읽기 wire(`spec-deltas/t-wa.md` §1). 처리기는 포트가 돌려준 값을 그대로 옮기고 오류만 wire 오류로 바꾼다.
// 값을 새로 계산하지 않는다(§2 1번). 계산(층 합치기, 출처 판정, 엣지 만들기)은 `assembly/m4/ext-read-port.ts`가 한다.

/** 포트가 돌려주는 거절. 처리기가 wire 오류로 옮긴다 */
type ExtReadError =
  | { readonly kind: "unknown_extension"; readonly name: string }
  | { readonly kind: "unknown_group"; readonly id: string }
  | { readonly kind: "unknown_thread"; readonly threadId: string }
  | { readonly kind: "unknown_setting"; readonly key: string }
  /** 안전 모드에서 `ext.reenable`, `ext.reload`를 거부한다(§2 2번 [제안]) */
  | { readonly kind: "safe_mode_active" }
  /** `managed` 범위가 잠근 확장은 자동 끔을 풀 수 없다 */
  | { readonly kind: "managed_locked"; readonly name: string }
  /** 그런 이름의 훅이 없다 */
  | { readonly kind: "unknown_hook"; readonly hook: string }
  /** 순서 설정 쓰기가 실패했다. 키는 `x.operations.hookOrder`다 */
  | { readonly kind: "write_failed"; readonly key: string; readonly failure: ProfileWriteFailure };

export type ExtReadResult<T> = Result<T, ExtReadError>;

type PortCall<M extends WireMethodName> = (
  params: WireParams<M>,
  signal: AbortSignal,
) => Promise<ExtReadResult<WireResult<M>>>;

/** 처리기가 쓰는 포트. 메서드 하나가 wire 메서드 하나다 */
export interface ExtReadPort {
  readonly list: PortCall<"ext.list">;
  readonly get: PortCall<"ext.get">;
  readonly reenable: PortCall<"ext.reenable">;
  readonly disableConfirm: PortCall<"ext.disableConfirm">;
  readonly reload: PortCall<"ext.reload">;
  readonly health: PortCall<"ext.health">;
  readonly timings: PortCall<"ext.timings">;
  readonly bindings: PortCall<"ext.bindings">;
  readonly groupList: PortCall<"group.list">;
  readonly groupMetrics: PortCall<"group.metrics">;
  readonly groupPromotion: PortCall<"group.promotion">;
  readonly groupDriveLock: PortCall<"group.driveLock">;
  readonly hooks: PortCall<"hooks.list">;
  readonly settingExplain: PortCall<"settings.explain">;
  readonly orderGet: PortCall<"hooks.order.get">;
  readonly orderSet: PortCall<"hooks.order.set">;
  readonly orderReset: PortCall<"hooks.order.reset">;
  readonly orderPreview: PortCall<"hooks.order.preview">;
  /** 저장 쓰기 실패를 wire 오류로 옮기는 조립의 함수들(`ProfileTestRunPort.errors`와 같은 것) */
  readonly errors: HostErrorMappers;
}

export type ExtReadMethods =
  | "ext.list"
  | "ext.get"
  | "ext.reenable"
  | "ext.disableConfirm"
  | "ext.reload"
  | "ext.health"
  | "ext.timings"
  | "ext.bindings"
  | "group.list"
  | "group.metrics"
  | "group.promotion"
  | "group.driveLock"
  | "hooks.list"
  | "settings.explain"
  | "hooks.order.get"
  | "hooks.order.set"
  | "hooks.order.reset"
  | "hooks.order.preview";

function wireErrorOf(
  error: ExtReadError,
  errors: HostErrorMappers,
  where: WireMethodName,
): WireError {
  switch (error.kind) {
    case "unknown_extension":
      return wireError("extension.notFound", { details: { name: error.name } });
    case "unknown_group":
      return wireError("group.notFound", { details: { id: error.id } });
    case "unknown_thread":
      return wireError("thread.notFound", { details: { threadId: error.threadId } });
    case "unknown_setting":
      return wireError("settings.unknownKey", { details: { key: error.key } });
    case "safe_mode_active":
      return wireError("extension.safeModeActive");
    case "managed_locked":
      return wireError("settings.locked", {
        details: { key: `ext.${error.name}.enabled`, lockedBy: "managed" },
      });
    case "unknown_hook":
      return wireError("hooks.notFound", { details: { hook: error.hook } });
    case "write_failed":
      return wireErrorOfWrite(error.key, error.failure, errors, where);
    default:
      return assertNever(error, "ExtReadError");
  }
}

async function unwrap<T>(
  call: Promise<ExtReadResult<T>>,
  errors: HostErrorMappers,
  where: WireMethodName,
): Promise<T> {
  const result = await call;
  if (!result.ok) throw wireErrorOf(result.error, errors, where);
  return result.value;
}

export function createExtReadHandlers(port: ExtReadPort): Pick<WireHandlers, ExtReadMethods> {
  const settle = <T>(where: ExtReadMethods, call: Promise<ExtReadResult<T>>): Promise<T> =>
    unwrap(call, port.errors, where);
  return {
    "ext.list": (params, context) => settle("ext.list", port.list(params, context.signal)),
    "ext.get": (params, context) => settle("ext.get", port.get(params, context.signal)),
    "ext.reenable": (params, context) =>
      settle("ext.reenable", port.reenable(params, context.signal)),
    "ext.disableConfirm": (params, context) =>
      settle("ext.disableConfirm", port.disableConfirm(params, context.signal)),
    "ext.reload": (params, context) => settle("ext.reload", port.reload(params, context.signal)),
    "ext.health": (params, context) => settle("ext.health", port.health(params, context.signal)),
    "ext.timings": (params, context) => settle("ext.timings", port.timings(params, context.signal)),
    "ext.bindings": (params, context) =>
      settle("ext.bindings", port.bindings(params, context.signal)),
    "group.list": (params, context) => settle("group.list", port.groupList(params, context.signal)),
    "group.metrics": (params, context) =>
      settle("group.metrics", port.groupMetrics(params, context.signal)),
    "group.promotion": (params, context) =>
      settle("group.promotion", port.groupPromotion(params, context.signal)),
    "group.driveLock": (params, context) =>
      settle("group.driveLock", port.groupDriveLock(params, context.signal)),
    "hooks.list": (params, context) => settle("hooks.list", port.hooks(params, context.signal)),
    "settings.explain": (params, context) =>
      settle("settings.explain", port.settingExplain(params, context.signal)),
    "hooks.order.get": (params, context) =>
      settle("hooks.order.get", port.orderGet(params, context.signal)),
    "hooks.order.set": (params, context) =>
      settle("hooks.order.set", port.orderSet(params, context.signal)),
    "hooks.order.reset": (params, context) =>
      settle("hooks.order.reset", port.orderReset(params, context.signal)),
    "hooks.order.preview": (params, context) =>
      settle("hooks.order.preview", port.orderPreview(params, context.signal)),
  };
}
